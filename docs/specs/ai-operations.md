# AI Operations — systematic AI calling

**Status:** direction locked (owner decision, 2026-07-08); first pass landed.
**Package:** [`@alembic/ai-operations`](../../packages/ai-operations) ·
**Client:** the workspace AI assistant menu (`edit/studio-shell.tsx`).

## Why

AI calling was ad-hoc: each action hand-wired which model to use, which review
tier it lands in, what event to log, and which prompt/rules to follow. Five
**separate** catalogs each knew one facet of an operation, and their string keys
did **not** line up:

| Facet | Catalog | Example keys |
| --- | --- | --- |
| Model routing | `DEFAULT_ROUTING.byTask` (`ai-assist/routing.ts`) | `spelling-grammar`, `worksheet`, `a11y-fix` |
| Risk tier / audit / apply | `CHANGE_KINDS` + `BASE_TIER` (`package-contract/change-tiers.ts`) | `editor-ai-edit`, `draft-section`, `assessment-edit` |
| Lifecycle events | `EVENT_TYPES` (`research-events`) | `ai.edit.requested`, `ai.draft.requested` |
| Access | `Capability` + `resolveEntitlements` (`apps/web/lib/entitlements.ts`) | `ai` |
| Page scope | `StudioCategory` (`edit/studio-shell.tsx`) | `content`, `concept-map`, `course` |

The routing key `spelling-grammar` persists as change-kind `editor-ai-edit`; the
routing key `worksheet` persists as `generate-artifact`; `assessment-item` →
`assessment-edit`. Every call site re-derived that mapping by hand.

## The registry

One typed **`AIOperation`** row is the single source of truth that bridges all
five facets, so every invocation follows the same specific rules:

```ts
AIOperation {
  id            // stable kebab-case; the menu sends it, the server dispatches on it
  title         // menu label
  summary       // one-line help / tooltip
  appliesTo     // OperationCategory[] | "*"   → which pages offer it
  mode          // "edit" | "generate" | "analyze"
  surface       // "assistant" (in the menu) | "panel" (its own UI, registered here)
  routingKind   // → ai-assist DEFAULT_ROUTING.byTask   (which model)
  changeKind    // → package-contract BASE_TIER         (tier, audit, apply path)
  event         // → research-events EVENT_TYPES         (what is logged)
  skill         // → skills/ai-operations/<id>           (the authoritative RULES)
  entitlement   // "ai"                                  (access)
  instruction?  // edit-mode only: the compiled form of the skill's rules
  gate?(ctx)    // availability (true | reason string)
  status        // "available" | "planned"
}
```

The catalog lives in [`registry.ts`](../../packages/ai-operations/src/registry.ts);
resolvers are `operationsForCategory(category)` and `operationById(id)`. A test
(`registry.test.ts`) pins that every `routingKind`/`changeKind`/`event`/category
is valid in its source catalog, so the registry can never drift out of the five
catalogs it bridges.

### Modes

- **`edit`** — rewrite the current file. Runs the op's `instruction` through
  `proposeEditAction` → before/after diff → apply. The three universal aids
  (`check-spelling-grammar`, `improve-language`, `check-accessibility`) are edit
  ops offered on every page (`appliesTo: "*"`).
- **`generate`** — produce new content. `runGenerateOperationAction` dispatches
  by op id, composes `PLATFORM_SCOPE`, routes by `routingKind`, and returns a
  proposed draft the educator reviews then applies. `generate-concept-map` is
  declared+gated, `planned` — its target is the "Course concept map" section
  (`metadata/course.md`, free-form; 2026-07-09 owner decision). `draft-description`
  (drafting the course description from title+chapters) was removed the same
  day: the course description is now a plain, manually-authored field
  (≤200 words) in the "Course details" card, not a generated document.
- **`analyze`** — report only, no write (e.g. a future accessibility audit).

### Rules: skill-primary + platform supplement

An operation's rules come in two layers:

1. **Skill (authoritative, portable).** `skills/ai-operations/<id>/SKILL.md` —
   prose + examples, the one place the behaviour is edited, and the same rules an
   agent applies on any platform (cross-platform reusable). For `edit` ops the
   registry carries `instruction`: the **compiled** (distilled) form of the skill
   the runtime sends. The skill is authoritative; keep `instruction` and the
   runtime system prompt (`ai-assist/prompts.ts`) in sync with it.

2. **Platform supplement (focus).** `PLATFORM_SCOPE` (`platform.ts`) is composed
   ahead of every operation's system framing at runtime. It keeps the model
   task-scoped: **Alembic's AI is invoked for well-defined course-material
   building operations on provided content — not an open-ended chatbot or
   tutor.** Do exactly the requested operation, nothing else; no chat, no
   meta-commentary; stay within the course material; return only the result.

   *Open questions about the course content* are deliberately out of scope for
   these operations. They may become their own operation later (an
   `analyze`/answer mode); decide then.

Runtime system prompt = `PLATFORM_SCOPE` + the operation's own framing; the
operation's specific rules arrive as its `instruction`. Composition happens in
`proposeEditAction` (edit ops today): it resolves the op by id, uses its
authoritative server-side `instruction` + `routingKind`, and passes
`PLATFORM_SCOPE` to `editFile`.

### Page scope

`OperationCategory` = the workspace `StudioCategory` union plus `course`. The
workspace maps its `StudioCategory | "course"` onto it 1:1. Scoping lives in the
durable package so the agent/worker offer the same operations the menu does.

## Execution

The workspace AI-assistant menu is a **thin client**: it renders
`operationsForCategory(category)`, disables `planned`/gated ops, and for an
available `edit` op sends its **id** through `proposeEditAction` → diff → apply
(the one validated write path). The server resolves the op's authoritative,
skill-compiled `instruction` + `routingKind`, composes `PLATFORM_SCOPE`, and runs
it. Access, rate limit, token budget, model routing, and `ai_invocations` logging
are all enforced once, at `governedProvider` — unchanged.

## Adding an operation

1. Add a row to `AI_OPERATIONS` (`registry.ts`) — pick its `routingKind`,
   `changeKind`, `event`, `appliesTo`, `mode`, `entitlement`, `gate?`.
2. Add `skills/ai-operations/<id>/SKILL.md` with the authoritative rules.
3. For `edit` ops, set `instruction` (compiled from the skill). For new
   capabilities, add the durable function in `@alembic/ai-assist` and (if new)
   its `routingKind`/`changeKind`/`event` to their source catalogs.
4. The test pins the cross-catalog validity automatically.

No parallel mechanism — extend these existing seams only (architecture rule 9).

## First pass (landed) and follow-ups

**Landed:** the package + registry + cross-catalog test; the menu is
registry-driven; the three universal edit aids are available everywhere;
`generate-concept-map` is declared on the course page, gated (needs every chapter
concept map, or a provided draft) and marked `planned`; the example skill
`check-spelling-grammar`.

**Follow-ups (tracked in [Status.md](../Status.md)):**

- **Migrate the remaining generative actions** to declare + dispatch through the
  registry as `surface: "panel"` ops (invoked from their own UI, but reading
  routing/change/event/skill from the row + composing `PLATFORM_SCOPE`):
  `draftSectionAction`, `generateQuestions`,
  `suggestA11yFixAction`/`suggestStructureAltText`, the coherence agent.
  *(`course-metadata`/`draft-description` — and the `generateCourseDescription`
  function/`COURSE_METADATA_SYSTEM` prompt it was the only caller of — were
  removed entirely 2026-07-09: the course description became a plain,
  manually-authored field, so there was nothing left for it to draft.
  `generateWorksheetAction` — the pre-authored-practice worksheet generator
  this bullet used to also name — was removed 2026-07-09 as dead code,
  superseded by the authored `practice` space.)*
- **Route edit-op persistence through `changeKind`/tier** rather than the current
  direct `saveFileAction` after the diff, so `editor-ai-edit`/`a11y-fix` land in
  the Tier-2 review queue where the tier says they should.
- **Wire `generate`/`analyze` ops** (concept-map generation from chapter concept
  maps or an uploaded draft; accessibility audit).
- **Author the remaining skills** — one per operation — and keep `instruction` +
  `ai-assist/prompts.ts` compiled from them.
- **Hosted-editor AI** (paged only — study guide and slides are done): the
  self-contained files' in-file editors get the assistant + selection AI via
  the **[`orz-host-ai@1`](orz-host-ai.md)** bridge (editor-kit host client +
  the orz repos + a coordinated republish). **Live** for study guide
  (orz-mdhtml@0.7.1) and slides (orz-slides@0.6.1) since 2026-07-08/09 —
  Alembic's host half maps requests onto this registry, so hosted-editor AI
  flows through the same ops + `PLATFORM_SCOPE` + governance. Paged has no
  in-file editor yet, so the bridge has nothing to attach to there. *(The
  plain-text editors — concept map, assessment guide, private — have
  selection AI already, in-app.)*
- **Promote `OperationCategory`** to the shared source the workspace
  `StudioCategory` imports, removing the 1:1 duplication.
