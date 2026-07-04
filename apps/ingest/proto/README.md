# vendored OTLP proto definitions

Verbatim copies of the canonical `.proto` files from
[`open-telemetry/opentelemetry-proto`](https://github.com/open-telemetry/opentelemetry-proto),
pinned to release tag **v1.10.0** (commit `ca839c51f706f5d53bfb46f06c3e90c3af3a52c6`).
Only the files needed to decode `Export{Logs,Trace,Metrics}ServiceRequest` are
included (their transitive imports: `common/v1`, `resource/v1`,
`{logs,trace,metrics}/v1`, `collector/{logs,trace,metrics}/v1`).

Loaded at runtime by `../src/otlp-protobuf.ts` via `protobufjs`. To refresh
against a newer opentelemetry-proto release, re-fetch the same file list from
the new tag and re-run `bun test` / the ingest unit tests — a wire-incompatible
change would show up as a decode/mapping mismatch.

Not modified from upstream except this README.
