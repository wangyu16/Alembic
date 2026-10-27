# Carrier 1.x migration and the embedded editor (K4) — mini-spec

**Status:** draft, 2026-10-27. Module K4 (🟡) with the editor parts of A7/U1.
Survey of today's editor integration done (see §1). Published on npm and
checked today: orz-markdown 2.5.0; orz-mdhtml, orz-slides, orz-paged and
their `-browser` packages 1.1.0; orz-site 0.1.0. (Family STATUS §1 still
says "prepared" for some of these; that table is stale.)

## 1. Today (survey)

- **Generation:** the worker generates every editable `.md.html`,
  `.slides.html` and `.paged.html` with the **0.x** carriers
  (`packages/generators`, `apps/worker/src/jobs.ts`), through
  `apps/web/src/lib/worker-client.ts`.
- **Hosting:** the generated file runs in an iframe (`srcdoc`) by
  `editor-modules/hosted-carrier.ts`, talking `orz-host-save`,
  `orz-host-ai` and `orz-host-include` through `@alembic/editor-kit`.
- **Storage:** chapter documents store lean `.md`; collection files store
  rendered HTML bytes. Alembic's own `orz-carrier` island
  (`@alembic/carriers`) is a 0.x format, not FC-18.
- **Site builds and exports** call `generateSelfContainedFile`
  (`site-actions.ts`, `lib/export.ts`).
- **CSP:** none.

## 2. Target (v3, layout-3 courses; R30, R31)

| Concern | Becomes |
|---|---|
| Format | Every document is **FC-18 format 1 text** (`{{nyml kind: …}}` header). Slot files and collection text files are stored as text in the working repo; nothing stores rendered HTML. |
| Editing | The **embedded orz editor** (FC-19 `mountEditor`) from the `-browser` packages, loaded client-only in the workspace page; no iframe of a whole generated file, no worker round trip to open a document. |
| Saving | `hooks.save(text)` → device save (IndexedDB) → the sync cadence of design §7.1 → `enqueueSync` (A4). |
| Other people's changes | `applyEdits` + `flash` on the open editor when a sync lands on other blocks (design §7.1). |
| Includes, assets, uids | `hooks.fetchInclude`, `hooks.resolveAsset` / `hooks.uploadAsset`, `hooks.mintUid` (Alembic `newDocId`). |
| AI | `hooks.ai` → quick asks (C4 §7), when C2 is live; absent before that. |
| Download | `assemble(text, { delivery: "inline" })` in the browser; the FC-18 header carries the document identity and base version as host keys `x_alembic_course`, `x_alembic_path`, `x_alembic_base` (FC-18 §5 host-key rule; stripped on Replace). |
| Replace | `extract(html)` → text and kind; `readDocument(text)` → uid; then the version rule. |
| Site build | orz-site on the worker (A12), from the public repo's projected text. |
| Worker | No longer generates editable files. Keeps: orz-site builds, Publish jobs, the committer, checks. |

## 3. Steps (each shippable on the branch, behind the layout-3 switch)

1. **Dependencies.**
   - Web: `orz-mdhtml-browser`, `orz-slides-browser`, `orz-paged-browser`
     `^1.1.0`, one kit (`orz-markdown ^2.5.0`). The browser packages go in
     `transpilePackages` if needed.
   - Worker: `orz-site ^0.1.0` and the Node carriers `^1.1.0`.
   - Lockfile and worker redeploy per RULES §3.5.
2. **CSP for workspace routes** (FC-19 §8.4): a per-request nonce
   (middleware), passed to `mountEditor({ nonce })`.
   - Allowed: `script-src 'nonce-…' https://cdn.jsdelivr.net`,
     `style-src 'nonce-…'` (plus what the components document),
     `font-src` for KaTeX, `img-src 'self' blob: data:`,
     `frame-src 'self' blob:`.
   - Report-only first; then enforced.
3. **`orz-embedded` editor module** in `editor-modules/` beside the hosted
   ones:
   - client-only dynamic import;
   - one module per kind (document, slides, paged);
   - wires the hooks of §2;
   - exposes `applyRemote(text)` for synced changes.
   - Its unit tests mount against jsdom where possible; the rest is
     covered by a Playwright smoke test (under `/tmp/orz-heavy.lock`).
4. **Download and Replace** on the new path: `assemble`, `extract`,
   `editHeader`; the `x_alembic_*` host keys.
5. **Retire for layout-3 courses** (deleted at the cut-over, R31):
   `generateEditableFile`, the hosted-carrier iframe path, the
   `orz-host-*` protocol clients, `@alembic/carriers`' 0.x island,
   `packages/generators` (except anything orz-site needs).
6. **Migration helper** (A14, manual move): convert 0.x files to format 1.
   For `.md.html`, mdhtml 1.1's `upgrade(html)`; for slides, the deck
   grammar conversion; for chapter `.md`, add the FC-18 header.

## 4. Options and recommendation

| Question | Options | Recommendation |
|---|---|---|
| Collection files' storage | (a) text only, assemble on Download; (b) keep rendered bytes too | (a): one source of truth, smaller repo, matches "lean sources" |
| Where `assemble` runs for Download | browser vs server | browser (no worker, no Vercel bundle of Node carriers) |
| Paged documents | embed `orz-paged-browser` like the others, or keep a print view only | embed (the component exists); print through its own `print` event |

## 5. Risks

- **Bundle size:** slides with reveal is about 1 MB. Mitigation: the
  editors load only on the document pages, through dynamic import.
- **jsDelivr dependency:** CodeMirror loads from jsDelivr with SRI. It is
  fine online. Offline (Door F) needs the installed app to cache those
  assets: the service worker precaches the pinned URLs.
- **Tests that pin 0.x output** (generators, worker, carriers, renderer
  slides, editor-kit host clients): kept for layout-2 until the cut-over,
  then deleted with that code.
- **Realtime source for `applyRemote`:** depends on A8 (presence and
  Realtime), which is not built yet.

## 6. Claims

| Claim | What |
|---|---|
| K4.1 | an embedded editor opens a format-1 document without any worker call |
| K4.2 | `hooks.save` text reaches `enqueueSync` with the right base version |
| K4.3 | Download → edit offline → Replace round-trips identity and base, and the `x_alembic_*` keys are stripped from the stored text |
| K4.4 | CSP blocks inline scripts without the nonce, and the editors still work |
| K4.5 | a remote change to another block appears in the open editor without losing the cursor or undo history |

> **Amended 2026-10-27:** the `alembic:` namespace is written as FC-18 host
> keys `x_alembic_*`, the form FC-18 §5 reserves for hosts.
> - Done on the branch: step 1, step 3 (core) and step 4 (logic).
> - K4.1, K4.3 and K4.5 are verified: in Chrome (`apps/web/e2e/k4-smoke`),
>   and with the real kit in vitest (`download.test.ts`).
