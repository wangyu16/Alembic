# Alembic — Claude Code Instructions

Alembic is an educator-facing OER (open educational resource) authoring and
publishing platform for STEM: educators organize knowledge and pedagogy; the
platform handles structure, versioning, GitHub publication, provenance, and
reuse. Educators are NOT developers — never surface Git/developer concepts in
educator-facing UI or messages (use save, preview, publish, snapshot, restore,
adapt, cite, share).

## Key documents

- [docs/goal.md](docs/goal.md) — product vision (authoritative; do not contradict it)
- [docs/Roadmap.md](docs/Roadmap.md) — phased development plan
- [docs/InitialReleasePlan.md](docs/InitialReleasePlan.md) — v0.1 scope, milestones M0–M8
- [docs/Status.md](docs/Status.md) — sub-module status tracker. **Update it whenever a sub-module's status changes.**
- docs/specs/ — written specs (package contract, etc.)

## Commands

```bash
pnpm install          # all workspaces
pnpm typecheck        # tsc --noEmit in every workspace
pnpm test             # vitest in every workspace that has tests
pnpm dev:web          # Next.js dev server
pnpm --filter @alembic/web build   # production build (CI runs this)
```

CI (`.github/workflows/ci.yml`) runs typecheck + test + web build on Node 22.
All three must pass before any push.

## Architecture rules (non-negotiable)

1. **Two-repo invariant.** A package = paired public + private GitHub repos.
   `private-instructor` content must NEVER be staged to the public repo, even
   transiently. Enforcement lives in `packages/package-contract`
   (`assertPathAllowedInRepo`, fail-closed) and `packages/github-bridge`
   (`validateCommitPlan`). Never add a bypass, override flag, or alternate
   commit path that skips this check.
2. **`packages/package-contract` is pure** — no IO, no framework imports. It is
   the single owner of the package schema. Everything else consumes it.
3. **The editor UI is a replaceable client.** UI code calls package operations
   via `packageOps(store, packageId)` (`packages/package-ops`); it never touches
   files, Git, or schema internals directly. Every writer — UI server actions,
   the agent/worker, the local studio — goes through `packageOps` (the one
   validated write path); never add a route around it.
4. **Repos are the source of truth.** App-side DB state must always be a
   rebuildable projection of repository content.
5. **`packages/github-bridge` is the only code that talks to GitHub.**
6. **AI is provider-swappable.** Workflow code depends only on `AIProvider`
   (`packages/ai-assist`). Development-phase provider is Gemini; never
   hardcode a provider or model name outside `packages/ai-assist`.
7. **Block IDs are immutable and never reused.** AI rewrites must preserve
   them; validate with `validateBlockIds` on every save path.
8. **Publish/registration always requires explicit educator approval**
   (Tier 3). Never automate past it.
9. **Phases 3–8 land as durable logic + thin disposable client** (the
   editing/viewing UI is overhauled after v1.0). Extend via existing seams —
   carrier kind registry, `CHANGE_KINDS`+tiers, entitlement resolver,
   `research-events` enum, additive+versioned manifest — never a parallel
   mechanism; layers are closed. Durable artifacts carry typed data, not
   rendered HTML. See [docs/specs/forward-compatibility.md](docs/specs/forward-compatibility.md).

## Conventions

- TypeScript everywhere, strict mode; workspace packages are consumed as
  source (`exports` → `./src/index.ts`) and transpiled by Next/tsx/vitest.
- Intra-package relative imports are **extensionless** (`./layers`, not
  `./layers.js`) — Turbopack cannot resolve `.js`-suffixed imports to `.ts`
  source in transpiled workspace packages.
- Markdown parsing/rendering goes through `@alembic/renderer` (orz-markdown).
  Never add a second markdown parser.
- Tests live next to source (`*.test.ts`, vitest). Anything touching the
  public/private boundary needs adversarial tests, not just happy-path.
- Research events: log via `@alembic/research-events`; logging failures must
  never break an educator workflow.

## Workflow

- Commit and push to `main` (https://github.com/wangyu16/Alembic) when each
  major step completes, after typecheck + tests + build pass locally.
- Update [docs/Status.md](docs/Status.md) in the same commit as the work it tracks.
- Secrets live in `apps/web/.env.local` (gitignored); `.env.example` documents
  the required variables. Never commit real keys.
