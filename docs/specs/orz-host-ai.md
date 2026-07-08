# `orz-host-ai@1` — an AI bridge for the self-contained editors

**Status:** host + orz-mdhtml file half **implemented + published**
(`orz-mdhtml@0.6.0` / `orz-mdhtml-browser@0.6.0`, 2026-07-08); Alembic's
`generators` dep bumped to `^0.6.0`. **Pending: redeploy the Fly worker** (it
generates the `.md.html` editing surface) to go live. Slides/paged file half
deferred.
**Mirrors:** [`orz-host-save@1`](../../packages/editor-kit/src/host-save-client.ts)
(the save bridge). **Related:** [ai-operations.md](ai-operations.md).

## Motivation

The plain-text editors (course description, concept map, assessment guide,
private) get an in-editor AI assistant + selection AI directly, because Alembic
owns their `<textarea>`. The **study guide, slides, and paged** documents are
edited inside the self-contained file's **own** editor, hosted in a sandboxed
iframe (`hosted-carrier.ts`). Alembic can't reach into that iframe to add an AI
button — and shouldn't: the point of the self-contained files is that the editor
lives *in the file*.

So the AI assistant for those must be **built into the orz in-file editors**,
with the actual AI call **delegated to whatever host is showing the file** over a
small postMessage protocol — exactly how saving already works (`orz-host-save@1`:
the file owns the Save button, the host owns persistence). That way:

- The `.md.html` / `.slides.html` / `.paged.html` editors gain an AI assistant
  **once, upstream**, and it works in any host.
- **Other users** who embed these files can plug in *their own* AI by
  implementing the host half — Alembic is just one host.
- Alembic's host half is **thin**: it maps a request onto the existing AI
  operations registry (`proposeEditAction` → routing + `PLATFORM_SCOPE` + tiers).

## Division of responsibility

| Concern | Owner |
| --- | --- |
| Selection detection, the AI button/menu, showing the diff, applying the result into the document | **the in-file editor** (orz-mdhtml / orz-slides / orz-paged) |
| Which operations are offered, running the model, governance (entitlement, budget, routing, logging), review tier | **the host** (Alembic, or any embedder) |

The file never calls a model or knows a provider; the host never touches the
file's editing surface. Same contract as save.

## The protocol (`orz-host-ai@1`)

postMessage between the host page and the file's iframe, versioned like the save
protocol (`protocol: "orz-host-ai"`, `version: 1`).

**Capability advertisement** — folded into the existing hello handshake so a
file learns whether its host can do AI, and which operations to show. If the host
never advertises AI, the file simply doesn't render the assistant (graceful on
pre-bridge or AI-less hosts):

```
host → file : orz-host-hello  { …, ai: { operations: [ { id, title, selection } ] } }
```

**Request / result** — initiated by the file when the educator invokes an op:

```
file → host : orz-host-ai-request  { requestId, op, text, selection?: {…} }
host → file : orz-host-ai-result   { requestId, ok, proposed?, rationale?, error? }
```

- `op` — an operation id the host advertised (e.g. `check-spelling-grammar`,
  `improve-language`). Unknown id → `ok: false`.
- `text` — the content to operate on: the selected passage, or the whole
  document when there's no selection.
- `selection: true` semantics — the host frames the model to return only the
  improved passage (Alembic reuses `editFile`'s `passage` mode).
- `proposed` — the replacement text the file diffs and, on approval, splices
  back in.

Requests are correlated by `requestId` (multiple in flight allowed); the host
enforces its own rate limit / budget and may reject with `ok: false`.

## Alignment with editor-kit

editor-kit already carries the AI seam: `EditorContext.requestAI(prompt,
selection) → Promise<AIProposal>` and `AIProposal`. The bridge is the **transport
for hosted (iframe) modules**: `createHostAIClient` (host half) receives
`orz-host-ai-request`, calls the host's `requestAI`/registry, and posts back
`orz-host-ai-result` — the sibling of `createHostSaveClient`. Same-origin
modules (Ketcher/Plotly) can call `requestAI` directly and skip the transport.

## Implementation status

- ✅ **editor-kit** — `createHostAIClient` + 8 unit tests; `EditorContext` gains
  `aiOperations` + `runAIOperation`.
- ✅ **Alembic host** — `hosted-carrier` builds the AI client; the hosted
  study-guide editor advertises the registry's selection-capable ops and routes
  `runAIOperation` → `proposeEditAction` (registry op + `PLATFORM_SCOPE`).
- ✅ **orz-mdhtml file half** — `assets/app.js` in-file assistant + `PROTOCOL.md`
  (`orz-host-ai@1`); verified valid + embedded in generated `.md.html`.
- 🔄 **Release:** ✅ published `orz-mdhtml@0.6.0` + `orz-mdhtml-browser@0.6.0`;
  ✅ bumped Alembic's `orz-mdhtml` dep to `^0.6.0` (typecheck + generators tests +
  web build green). ⬜ **redeploy the Fly worker** (owner) — it generates the
  `.md.html` editing surface; until then the worker still embeds the old app.js.
  Then the bridge lights up end-to-end.
- ⬜ **orz-slides / orz-paged file half** — deferred (Alembic treats slides/paged
  as derived views today; wire when they become independently authored).

## Implementation plan (original — for reference)

1. **editor-kit** — `createHostAIClient` (mirror of `createHostSaveClient`):
   hello advertises `ai.operations`; handles `orz-host-ai-request` → host
   handler → `orz-host-ai-result`. Unit-tested like the save client.
2. **orz-mdhtml / orz-slides / orz-paged** — the in-file editors gain the
   assistant: on selection show the copper "Improve selection" affordance;
   render the host-advertised operations; send a request; show the returned
   diff; apply on approve. Gated on the host advertising `ai`. Published, with
   the browser subpackages bumped (like the delivery release).
3. **Alembic host** (`hosted-carrier.ts`) — construct the AI client alongside
   the save client; advertise the registry's selection-capable ops
   (`operationsForCategory(category).filter(o => o.selection)`); implement the
   handler as `proposeEditAction(packageId, text, { operationId: op, selection })`
   — so hosted-editor AI flows through the **same** registry + `PLATFORM_SCOPE`
   + governance + tiers as everything else.
4. **Docs** — a `PROTOCOL.md` entry upstream (next to the save protocol) so
   third-party hosts can implement the host half.

## Notes / decisions to make at build time

- **One protocol or fold into save's hello?** Leaning: reuse the save hello for
  capability advertisement (one handshake), but a distinct `orz-host-ai-*`
  message family for requests, so a host can support save without AI or vice
  versa.
- **Apply path.** The file applies the approved result into its own source, then
  saves through the existing `orz-host-save@1` path — so the AI result still
  lands via Alembic's validated write path + block-ID checks. No new write path.
- **Trust.** Same sandbox posture as save (`allow-same-origin` only because
  Alembic generates the file from the educator's own source). Untrusted-document
  hosting would need a separate content origin — unchanged by this bridge.
