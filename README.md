# Alembic

An open educational resource (OER) ecosystem for STEM. Raw, messy course
materials go in; refined, reusable open educational resources come out —
educators organize knowledge and pedagogy while the platform handles
structure, versioning, publication, provenance, and reuse on GitHub-backed
infrastructure.

**Status: pre-release (v0.1 in development).** See
[docs/goal.md](docs/goal.md) for the product vision,
[docs/Roadmap.md](docs/Roadmap.md) for the phased plan, and
[docs/InitialReleasePlan.md](docs/InitialReleasePlan.md) for the current
milestone plan.

## Repository layout

```
apps/
  web/                  Next.js app (authoring workspace, API routes)
  worker/               container worker: site builds, Pages publication
packages/
  package-contract/     package schema, block identity, two-repo invariant (pure TS)
  renderer/             orz-markdown wrapper: preview, student pages, artifacts
  github-bridge/        the only code that talks to GitHub
  ai-assist/            provider-swappable AI interface (dev provider: Gemini)
  research-events/      research event taxonomy + logger
docs/                   product vision, roadmap, plans
```

## Development

Requires Node ≥ 22 and pnpm.

```bash
pnpm install
pnpm typecheck    # all workspaces
pnpm test         # all workspaces
pnpm dev:web      # Next.js dev server
```

Environment variables (local only, never committed): copy `.env.example` to
`apps/web/.env.local` and fill in values.
