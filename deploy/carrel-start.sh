#!/bin/sh
# carrel-deployd (from land) runs this from the release directory on every
# deploy and rollback. It points the Compose stack in /opt/sensorium-zyx at
# the image in VERSION, reports ready once ingest and mcp are healthy, then
# follows their logs. The unit needs Type=notify and NotifyAccess=all.
set -eu

version=$(cat VERSION)
# The release carries the stack's compose.yaml, so the repo is its source.
# compose.override.yaml stays the machine's own.
if [ -f compose.yaml ]; then
  cp compose.yaml /opt/sensorium-zyx/compose.yaml.new
  mv /opt/sensorium-zyx/compose.yaml.new /opt/sensorium-zyx/compose.yaml
fi
cd /opt/sensorium-zyx

tmp=$(mktemp .env.XXXXXX)
sed "s/^SENSORIUM_VERSION=.*/SENSORIUM_VERSION=$version/" .env >"$tmp"
chmod 600 "$tmp"
mv "$tmp" .env

# Another stack on the VM may pull at the same moment, and containerd then
# fails a commit now and then; a second try gets it.
for try in 1 2 3; do
  docker compose pull --quiet migrate ingest mcp retention && break
  [ "$try" = 3 ] && exit 1
  sleep 2
done
docker compose up -d --wait ingest mcp retention
systemd-notify --ready
exec docker compose logs -f --since 1s ingest mcp
