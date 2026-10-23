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
  worker/               Fly worker: generates the self-editing .md.html /
                        .slides.html / .paged.html files (Node-only generators)
packages/
  package-contract/     package schema, block identity, two-repo invariant (pure TS)
  package-ops/          UI-independent package operations; the validated write path
  renderer/             orz-markdown wrapper: preview, student pages, course site
  carriers/             carrier codec + kind registry (pure TS)
  generators/           worker-side generation through orz-mdhtml/-slides/-paged
  editor-kit/           host-agnostic editor-module interface
  github-bridge/        the only code that talks to GitHub
  ai-assist/            provider-swappable AI interface (AIProvider)
  ai-operations/        typed catalog of AI operations (pure metadata)
  a11y/                 accessibility checks over rendered HTML (pure TS)
  research-events/      research event taxonomy + logger
templates/              files for the public/private template repositories
docs/                   product vision, roadmap, plans, specs
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

## License

[MIT](LICENSE) © 2026 Yu Wang
