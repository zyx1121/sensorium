# collector

Two ways to get OTLP into sensorium — pick per producer.

## Mode 1: OTel Collector in front (recommended)

Producer's SDK exports normally (OTLP/gRPC or HTTP, whatever it defaults to)
to a standard `otelcol` binary running `config.yaml` in this directory. The
Collector re-exports OTLP/HTTP **JSON** to `apps/ingest`, with the project's
bearer token attached via `SENSORIUM_INGEST_TOKEN`.

Use this when: the producer's SDK doesn't easily support OTLP/HTTP+JSON
directly, you want batching/retry, or you want to fan the same telemetry out
to more than one backend later.

```sh
export SENSORIUM_INGEST_TOKEN=sk_...   # from `bun run db:register-project <name>`
otelcol --config collector/config.yaml
# producer points OTLP exporter at localhost:4317 (grpc) or :4318 (http)
```

## Mode 2: direct ingest

Producer's SDK is configured to export OTLP/HTTP with JSON encoding straight
to `apps/ingest` (`https://sensorium.zyx.tw/v1/{logs,traces,metrics}`), with
`Authorization: Bearer <project-token>` set on the exporter itself.

Use this when: the producer is a small service and running/operating a
Collector sidecar isn't worth it. Most OTel SDKs support JSON encoding
directly (e.g. `@opentelemetry/exporter-*-otlp-http` with
`OTEL_EXPORTER_OTLP_PROTOCOL=http/json`).

## What v0 does not support

`apps/ingest` only accepts `Content-Type: application/json` (OTLP/JSON).
Protobuf (`application/x-protobuf`) is rejected with 415 — if a producer only
speaks protobuf, put a Collector in front (Mode 1); the Collector's
`otlphttp` exporter can re-encode to JSON regardless of what it received.
