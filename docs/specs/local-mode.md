# Local Mode & Entitlements

**Status:** design spec (authoritative for M17). Aligns with [goal.md](../goal.md),
the [package contract](package-contract-v1.md), and
[carriers-and-assets.md](carriers-and-assets.md). Reinforces the no-lock-in
principle and introduces the seam future monetization plugs into.

## 1. Purpose & principles

A **light, local, anonymous** way to use Alembic's editing: a student (or any
visitor) opens a supported file from their computer — a `.md.html`,
`.ketcher.svg`, `.plot.svg`, or a new note — edits it with the full editor
(including the structure editor), and saves it back to disk. No account, no
cloud, no GitHub.

Product principle (per project intent):

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
2. Edit: the existing editors (block editor, Ketcher, future plot).
3. Save: `embedSource` → `showSaveFilePicker` (write back to the same handle).

A "new note" is just an empty `.md.html` carrier. No package, no account, no
network.

## 6. Identity & AI

- **Anonymous now.** No login for local editing. An `AuthProvider` interface is
  introduced but has a single `anonymous` implementation today; Google/OIDC drop
  in later without touching feature code.
- **AI is an entitlement** (`ai`), **absent for anonymous → off in local mode.**
  The AI surfaces simply don't render, and the server refuses AI calls without
  the entitlement. `AIProvider` (provider-swappable) is unchanged; cost
  attribution continues through the existing governance log. Future paid plans
  grant `ai`; metering/quotas attach at the resolver + governance layer.
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

1. **v1 — single-file studio** (anonymous, no AI): open/edit/save one carrier;
   "new note"; full editor incl. structures; FSA + download/upload fallback.
2. **v2 — local project**: `LocalPackageStore` over a directory handle; edit a
   whole package locally (chapters, `materials/`, manifest) via the local
   `PackageOps`.
3. **v3 — identity + entitlements + paid AI**: `AuthProvider` (Google),
   `resolveEntitlements` with plans, AI for entitled users, metering/quotas.
4. **v4 — cloud sync** for signed-in light users.

## 10. Milestone mapping

See [Status.md](../Status.md) **M17 — Local mode & entitlements**:
- **M17.0** entitlement seam: `Capability`/`Identity`/`resolveEntitlements` +
  `AuthProvider` (anonymous impl) + server-side enforcement on existing
  cloud/AI endpoints (no behavior change today; everyone is anonymous-or-cloud).
- **M17.1** `PackageOps` interface + local impl over `LocalPackageStore` (FSA).
- **M17.2** single-file studio (open/edit/save carriers; new note; fallback).
- **M17.3** client-capability audit (Web Crypto hashing; browser-clean path).
- *(later)* v2 local projects, v3 paid AI, v4 cloud sync.

*Exit (v1):* a visitor opens a `.md.html` or `.ketcher.svg` from disk, edits it
(structures included), and saves it back — no account, no cloud, no AI.
