# Local Mode & Entitlements

**Status:** design spec (authoritative for M17). Aligns with [goal.md](../goal.md),
the [package contract](package-contract-v1.md), and
[carriers-and-assets.md](carriers-and-assets.md). Reinforces the no-lock-in
principle and introduces the seam future monetization plugs into.

## 1. Purpose & principles

A **light, local, anonymous** way to use Alembic's editing: a student (or any
visitor) opens a supported file from their computer — in **v1**, Markdown or a
`.md.html` study guide (or a new note) — edits it and saves it back to disk. No
account, no cloud, no GitHub. (Opening other carriers — `.ketcher.svg`,
`.plot.svg`, `.slides.html` — for editing in the studio is **v2**; their editors
must first be made storage-agnostic.)

This is **not a new idea** — it's already in [goal.md](../goal.md):

- goal.md (Downloadable artifacts) states the exact use case: *"a student should
  be able to download a public chapter study guide, open the `.md.html` file in
  a compatible editor such as VS Code, and keep a private annotated copy with
  personal notes."* Local mode is Alembic **being that compatible editor.**
- goal.md **§11 (AI Credit & Sustainability Model)**: *"the software can remain
  open source while AI inference remains an operating cost… support multiple
  future credit models without changing its core architecture"* — and the AI
  provider + billing layer must be **modular.** The entitlement seam (§2) is
  that hook.

Product principle (restated from goal.md §11):

> **Content is OER and open. The *service* — running the platform and the AI —
> costs money.** Local editing is free and anonymous today. Hosted AI, cloud
> storage, and accounts arrive later as a **paid service.** The job *now* is to
> make those additions cheap to build, not to build them.

So this spec is two things: a near-term **local studio**, and the **entitlement
seam** that makes accounts / paid AI / cloud sync a configuration change rather
than a refactor.

## 2. The core model: capabilities → entitlements (the flexibility seam)

Do **not** branch the app on "student vs educator." Model a small set of
**capabilities**, and resolve which ones an identity has in **one place**:

```ts
type Capability =
  | "localFile"     // open/edit/save files on the user's disk
  | "ai"            // AI assist (draft, alt-text, …) — metered, costs money
  | "cloudProject"  // packages saved server-side (rebuildable projection)
  | "github"        // connect publishing
  | "publish"       // build + publish a site
  | "portal";       // list on the public index

interface Identity {
  kind: "anonymous" | "user";
  userId?: string;
  plan?: string;          // future: "free" | "edu" | "pro" | …
}

function resolveEntitlements(id: Identity): Set<Capability>;
// today:
//   anonymous            → { localFile }
//   user (current cloud) → all of the above
// future:
//   user + plan          → plan-derived subset (e.g. free = no `ai`; pro = `ai`)
```

Everything consumes entitlements; nothing consumes "mode":

- **UI** gates panels/buttons on entitlements (hide Publish/Portal/Connect-GitHub
  for anonymous; hide AI when `ai` absent).
- **Server** enforces them for real (client gating is UX only). Anonymous
  requests simply cannot reach cloud/AI endpoints.
- **Billing, when it comes,** implements only `plan → entitlements` + a billing
  provider. No feature code changes. This single resolver is the monetization
  seam.

## 3. Storage behind `PackageStore`

Storage is already an interface (`SupabaseSandboxStore`, `MemoryPackageStore`).
Local mode adds one adapter:

- **`LocalPackageStore`** — File System Access API. v1 operates on a single
  file handle; v2 on a picked directory handle (a whole local package).
- **Cloud** stays `SupabaseSandboxStore`. **Future sync** is a third adapter or
  a sync layer over the local one — no change to consumers.

The editor, a11y, preview, and the carrier/asset pipeline all consume
`PackageStore` and are storage-agnostic.

## 4. Operations interface (the one real refactor)

Today the editor calls **server actions** (`saveStudyGuideAction`, …) that run
on the server against the cloud store. Local mode runs the *same* pure logic in
the **browser** against `LocalPackageStore`. Decouple via an injected interface:

```ts
interface PackageOps {
  loadStudyGuide(path?): Promise<StudyGuideDoc>;
  saveStudyGuide(doc): Promise<…>;
  listAssets(): Promise<AssetInfo[]>;
  writeAsset(input): Promise<…>;
  // …the operations the editor already uses
}
```

- **Cloud impl** → thin wrappers over the existing server actions.
- **Local impl** → direct calls into `@alembic/package-ops` against the local
  store, in the browser.

The editor depends on `PackageOps`, not on server actions directly. This
finishes the "editor UI is a replaceable client" decoupling (CLAUDE.md rule 3).

## 5. Carriers make the single-file studio nearly free

Because a carrier is self-contained (rendered payload + embedded source +
markers), v1 needs almost nothing beyond what exists:

1. Open: File System Access `showOpenFilePicker` → read file → `extractSource`
   (from `@alembic/carriers`) → route to the right editor by kind.
2. Edit: a Markdown editor with live preview (v1). The carrier editors (Ketcher,
   plot, slides) join in v2 once they take a storage-agnostic save callback.
3. Save: `embedSource` → `showSaveFilePicker` (write back to the same handle).

A "new note" is just an empty `.md.html` carrier. No package, no account, no
network.

## 6. Identity & AI

- **Anonymous now.** No login for local editing. Today's identity model is
  **GitHub OAuth** (goal.md "Identity & GitHub model") — the signed-in educator,
  whom the resolver treats as full-capability. Local mode adds an `anonymous`
  identity (`{localFile}`). An `AuthProvider` interface (the goal.md Workspace/
  Auth module) has only the `anonymous` + existing-GitHub paths today; a future
  Google/OIDC **student** identity drops in without touching feature code.
- **AI is an entitlement** (`ai`), **absent for anonymous → off in local mode.**
  The AI surfaces simply don't render, and the server refuses AI calls without
  the entitlement. Three distinct layers compose (don't conflate them):
  **entitlement** = *may this identity use AI at all* (here); **gateway/credits**
  (M16, ai-architecture.md §11) = *who pays, which model, what quota*;
  **Tiers 1–3** (M10) = *what approval applies to a change*. `AIProvider` stays
  provider-swappable; future paid AI for light users = M16 gateway + the `ai`
  entitlement granted by a plan.
- **Privacy is a feature:** local files never touch the server. (When AI is
  later enabled for paid users, only the relevant snippet is sent, under the
  existing tiers.)

## 7. Honest costs & risks

1. **Operations-interface refactor** (§4) — the main work; healthy decoupling.
2. **Client-capability audit** — confirm the browser path has **no Node-only
   deps**. Likely offender: content hashing (`hashContent`) if it uses
   `node:crypto`; swap to Web Crypto / an isomorphic hash. `renderer`,
   `carriers`, and the Ketcher iframe are already browser-clean.
3. **File System Access support** — strong in Chromium; **fallback** for
   Firefox/Safari to download (`<a download>`) + upload (`<input type=file>`),
   so local mode works everywhere, degrading gracefully.
4. **Server-side enforcement** — entitlement checks must be authoritative on the
   server for cloud/AI; never trust client gating.

## 8. Relationship to invariants

- **No-lock-in** — strongly reinforced: portable files, no account, no platform
  dependency. Local mode is the principle made literal.
- **Two-repo invariant** — not exercised locally (no repos), but the
  public/private separation is preserved if/when a local project later syncs to
  the cloud/GitHub.
- **AI provider-swappable** — unchanged; AI is gated by entitlement, not rewired.
- **Repos/cloud are source of truth** *for cloud packages*; local files are the
  user's own source of truth, owned by them.

## 9. Staged plan (each stage shippable)

1. **v1 — single-file Markdown studio** (anonymous, no AI): open/edit/save a
   `.md`/`.md.html` (carrier source extracted client-side); "new note"; Markdown
   editor + live preview; FSA `showSaveFilePicker` + download fallback. **Shipped.**
2. **v1.5 — carrier editing in the studio**: open/edit `.ketcher.svg`/`.plot.svg`/
   `.slides.html` once their editors take a storage-agnostic save callback.
3. **v2 — local project**: `LocalPackageStore` over a directory handle; edit a
   whole package locally (chapters, `materials/`, manifest) via the local
   `PackageOps`.
4. **v3 — identity + entitlements + paid AI**: `AuthProvider` (Google),
   `resolveEntitlements` with plans, AI for entitled users, metering/quotas.
5. **v4 — cloud sync** for signed-in light users.

## 10. Milestone mapping

See [Status.md](../Status.md) **M17 — Local mode & entitlements**:
- **M17.0** ✅ entitlement seam: `Capability`/`Identity`/`resolveEntitlements`
  (`lib/entitlements.ts`). `AuthProvider` (Google) + app-wide server-side
  enforcement land with paid AI (v3 / M16).
- **M17.1** ⏸ `PackageOps` interface + `LocalPackageStore` (FSA) — v2 (local projects).
- **M17.2** ✅ single-file Markdown studio (`/studio`: `.md`/`.md.html`, new note,
  preview, FSA + download fallback). Carrier editing → v1.5.
- **M17.3** 🔄 client-capability audit — carriers codec is browser-clean; full
  audit (Web Crypto hashing) with local projects (v2).
- *(later)* v1.5 carrier editing, v2 local projects, v3 paid AI, v4 cloud sync.

*Exit (v1):* ✅ a visitor opens a `.md.html` or Markdown file from disk, edits
it, and saves it back — no account, no cloud, no AI. Carrier (structure/plot/
slide) editing in the studio and local *projects* are the next iterations.
