# One image for every sensorium role; `sensorium <role>` picks one (bin/sensorium).
# Bun runs the TypeScript sources directly, so there is no build step.
FROM oven/bun:1.3.13-alpine

WORKDIR /app

# Manifests first, so a source change does not reinstall the dependencies.
COPY package.json bun.lock ./
COPY apps/ingest/package.json apps/ingest/
COPY apps/mcp/package.json apps/mcp/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/typescript-config/package.json packages/typescript-config/
RUN bun install --frozen-lockfile --production

COPY . .
RUN ln -s /app/bin/sensorium /usr/local/bin/sensorium

USER bun
EXPOSE 8787 8788
ENTRYPOINT ["sensorium"]
CMD ["ingest"]
