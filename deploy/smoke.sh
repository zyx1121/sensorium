#!/usr/bin/env bash
# The image as deployed: the stack from .env.example, then scripts/smoke.sh.
# ci runs it with the image loaded as ghcr.io/zyx1121/sensorium:ci.
set -euo pipefail
trap 'docker compose logs' EXIT
sed -e 's/^SENSORIUM_VERSION=.*/SENSORIUM_VERSION=ci/' \
    -e 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=ci-postgres/' \
    -e 's/^SENSORIUM_MCP_TOKEN=.*/SENSORIUM_MCP_TOKEN=ci-mcp-token/' \
    .env.example > .env
docker compose up -d
MCP_TOKEN=ci-mcp-token sh scripts/smoke.sh
