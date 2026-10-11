# sensorium

Bun and Turborepo workspace: `apps/ingest` (the OTLP/HTTP receiver), `apps/mcp` (the read-only MCP server), `packages/core` (the OTLP to row mapping) and `packages/db` (migrations and queries), shipped as one image. Read [README.md](README.md) first.

## Rules

- The ingest token alone decides the project. Never scope records by `service.namespace` or any other value a producer sends.
- The MCP server stays read-only. Do not add a tool that writes.
- Schema changes are new files in `packages/db/migrations`. Never edit an applied migration.
- Keep `metric_points` partitioned by UTC day, so retention drops whole partitions.
- Tokens never appear in logs or tool output.
- Repository documents and code comments are English.

## Where to run things

In Loki's environment, the MacBook is for editing and git only. Run `bun install`, the tests, Postgres and `docker compose` on `ssh sandbox` in a login shell (`bash -lc`).

## Verify

```sh
bun install
bun run typecheck && bun run lint && bun run test
sh scripts/smoke.sh
```

`packages/db` runs its integration tests only when you set `DATABASE_URL`. The smoke script registers a project, sends a log and reads it back over MCP.

## Deploy

The production instances run from the published image with Docker Compose. After a release, pull the new tag, run `docker compose up -d`, then call `list_projects` to verify that the MCP endpoint answers.
