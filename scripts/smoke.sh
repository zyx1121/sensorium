#!/bin/sh
# Smoke test for a stack started with `docker compose up -d`: both roles come up
# healthy, a project registers, a log goes in over OTLP/HTTP and comes back out
# over MCP, the retention sweep has run, and / stays a 404.
#
#   MCP_TOKEN=<SENSORIUM_MCP_TOKEN> sh scripts/smoke.sh
set -eu
ingest=${INGEST_URL:-http://127.0.0.1:8787}
mcp=${MCP_URL:-http://127.0.0.1:8788}
: "${MCP_TOKEN:?set MCP_TOKEN to the stack's SENSORIUM_MCP_TOKEN}"

fail() {
	echo "smoke: $*" >&2
	exit 1
}

wait_for() {
	tries=0
	until curl -fsS -o /dev/null "$1"; do
		tries=$((tries + 1))
		[ "$tries" -lt 60 ] || fail "$1 never answered"
		sleep 2
	done
}
wait_for "$ingest/health"
wait_for "$mcp/health"

token=$(docker compose run --rm -T ingest register-project smoke | sed -n 's/.*: \(sk_[0-9a-f]*\)$/\1/p')
[ -n "$token" ] || fail "register-project printed no token"

now="$(date +%s)000000000"
log='{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"smoke"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"'"$now"'","severityText":"INFO","body":{"stringValue":"hello sensorium"}}]}]}]}'
curl -fsS -X POST "$ingest/v1/logs" -H 'content-type: application/json' -H "authorization: Bearer $token" -d "$log" |
	grep -q '"inserted":1' || fail "ingest did not insert the log"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$ingest/v1/logs" -H 'content-type: application/json' -d "$log")
[ "$code" = 401 ] || fail "ingest answered $code without a token"

rpc() {
	curl -fsS -X POST "$mcp/mcp" -H "authorization: Bearer $MCP_TOKEN" \
		-H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d "$1"
}
rpc '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' |
	grep -q '"serverInfo"' || fail "MCP initialize failed"
tools=$(rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
for tool in list_projects query_logs query_traces list_traces error_summary top_sources query_metrics search; do
	echo "$tools" | grep -q "\"name\":\"$tool\"" || fail "MCP does not list $tool"
done
since=$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)
rpc '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"query_logs","arguments":{"project":"smoke","since":"'"$since"'"}}}' |
	grep -q 'hello sensorium' || fail "query_logs did not return the log"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$mcp/mcp" -H 'content-type: application/json' -d '{}')
[ "$code" = 401 ] || fail "MCP answered $code without a token"

code=$(curl -s -o /dev/null -w '%{http_code}' "$ingest/")
[ "$code" = 404 ] || fail "/ answered $code; the landing page should be off"
docker compose logs retention | grep -q 'retention: keep metrics' || fail "the retention sweep has not run"

echo "smoke: ok"
