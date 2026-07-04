# Alembic worker tier — self-contained file generation service.
# Build context is the REPO ROOT (pnpm monorepo): `fly deploy` is run from the
# root with `--config apps/worker/fly.toml`. Runs the worker via tsx (workspace
# packages are consumed as TS source), so no build step is needed.

FROM node:22-slim

# corepack ships pnpm; pin to the repo's version (root package.json packageManager)
RUN corepack enable
WORKDIR /app

# Copy the whole monorepo (node_modules/.next/etc. excluded via .dockerignore).
# pnpm needs the full workspace graph to resolve workspace:* deps.
COPY . .

# Install only the worker and its dependency subtree (incl. dev deps for tsx).
# --frozen-lockfile: reproducible; fails if the lockfile is stale.
RUN pnpm install --filter @alembic/worker... --frozen-lockfile

ENV NODE_ENV=production
ENV WORKER_PORT=8080
EXPOSE 8080

CMD ["pnpm", "--filter", "@alembic/worker", "start"]
