# AI operation skills

One skill per **AI operation** in the [`@alembic/ai-operations`](../../packages/ai-operations)
registry. A skill is the **authoritative rules** for its operation — portable
prose + examples, the one place the behaviour is specified, and the same rules an
agent applies on any platform.

Naming: `skills/ai-operations/<operation-id>/SKILL.md`, where `<operation-id>`
matches the registry row's `id` (and the row's `skill` field). Adding an
operation = one registry row + one skill here (+ a durable `@alembic/ai-assist`
function if the capability is new). See
[docs/specs/ai-operations.md](../../docs/specs/ai-operations.md).

For `edit`-mode operations the registry also stores `instruction` — the
**compiled** (distilled) form of the skill that the runtime propose flow sends.
The skill is authoritative; keep `instruction` and the runtime system prompt in
`ai-assist/prompts.ts` in sync with it.

Distinct from the carrier-authoring skills (`../authoring-*`), which describe
file *formats*, not AI *operations*.

## Operations

- [check-spelling-grammar](check-spelling-grammar/SKILL.md) — correctness-only pass (worked example / template)
- [enrich-formatting](enrich-formatting/SKILL.md) — orz-markdown callouts/columns/tabs/TOC where they aid readability
- [suggest-slide-layout](suggest-slide-layout/SKILL.md) — orz-slides layout grammar (markers, regions, notes)
- [suggest-page-settings](suggest-page-settings/SKILL.md) — orz-paged template + page config
- `improve-language` — clarity & flow, meaning preserved *(skill pending)*
- `check-accessibility` — alt text, heading order, link text, table headers *(skill pending)*
- `generate-concept-map` — course concept map from chapter maps or a draft *(planned)*

The format ops (`enrich-formatting`, `suggest-slide-layout`, `suggest-page-settings`)
distill their format's **upstream** authoring skill (orz-markdown-skills,
orz-slides-skills, orz-paged-skills) into the runtime instruction; those upstream
skills are the authoritative full grammar.
