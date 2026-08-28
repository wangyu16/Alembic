# Production Deployment (v0.1)

Deploy the Alembic web app to **Vercel**, backed by the existing **Supabase**
project, served at **alembic.orz.how** (DNS at Cloudflare). The worker tier is
not needed for v0.1 (site builds run in-process).

Do these in order — the production URL feeds back into the auth/App callbacks.

---

## 1. Apply all database migrations

In the Supabase SQL editor, run every file in
[`supabase/migrations/`](../supabase/migrations/) in order (if you haven't):
`0001_init` → `0002_ai_invocations` → `0003_github` → `0004_portal` →
`0005_changes` → `0006_a11y` → `0007_ai_budget` → `0008_reconcile` →
`0009_suggestions` → `0010_governance` → `0011_admin` → `0012_lifecycle` →
`0013_drop_portal_eligible` (optional cleanup) → `0014_documents` →
`0015_portal_keywords` → `0016_profile_column_grants` →
`0017_user_governance` → `0018_rls_active_user` → `0019_document_tags` →
`0020_staging_bucket`.

You may use your existing dev project, or create a separate production project
and run all migrations there (recommended for a real pilot).

### Migrations with special handling

| Migration | Note |
| --- | --- |
| `0016_profile_column_grants` | **Deploy code first.** The GitHub-install callback (`api/github/installed`) must already use the service client when this revokes the blanket profile UPDATE grant — so it also needs `SUPABASE_SECRET_KEY` set (step 2). See the security banner in [Status.md](Status.md). |
| `0017` + `0018` (user governance) | **Apply before deploying the AI gate.** `can_use_ai()` fails *closed*, so shipping the gate against a database without these stops AI for every account, owner included. |
| `0019_document_tags` | Required before relying on per-file asset tags/metadata in production. |
| `0020_staging_bucket` | **Requires owner / service-role privileges** — it inserts a row into `storage.buckets` and creates policies on `storage.objects`, which the ordinary anon/authenticated roles cannot do. Run it as the project owner in the SQL editor (or with the service-role connection), not from an app-side client. **Apply it *before* deploying the code that uses the staging bucket** (the Wave-3 zip-upload path: `api/staging-url`, `lib/staging.ts`, `api/populate-package`); without the bucket every whole-course zip upload fails at the signed-URL step. It is additive — a private `staging` bucket plus four owner-prefix RLS policies namespaced to it; no existing table, policy, or bucket changes. |

#### The `staging` bucket: 24-hour TTL is an operator responsibility

`0020` creates the platform's **only** object-storage use: a private `staging`
bucket that holds a zip (or raw source file) just long enough for the
populate/import run to consume it. It is staging, never a home — nothing durable
lives there, nothing reads from it after the run that staged it, and no
permalink ever points at it. Permanent content lives in the educator's GitHub
repositories; trial content lives in `sandbox_files`.

**Supabase Storage has no automatic bucket TTL**, so the 24-hour lifetime is a
contract the code and an operator sweep uphold together:

1. The populate/import path deletes each staged object as soon as it has been
   consumed successfully (`deleteStagingObject`, `apps/web/src/lib/staging.ts`).
2. A failed or abandoned run leaves an orphan. **Set up an operator or cron
   sweep that deletes every object in the `staging` bucket older than 24
   hours** (service role; it bypasses RLS). Nothing in the product may depend on
   a staged object surviving that long.
3. Anything still present after 24h is garbage by definition, not data loss —
   the educator still has their original file.

Access is owner-scoped: an object's name must begin with the uploader's user id,
and the `is_active_user()` ban backstop from `0018` applies to reads as well as
writes. There is no anonymous URL for a staged object; every read goes through a
signed URL.

The whole-course zip limit is **50 MB** (`MAX_PACKAGE_ZIP_BYTES`), a stated
product limit — the bytes bypass the Vercel function body entirely by going
straight to this bucket via a signed URL.

## 2. Deploy the web app to Vercel

1. **Vercel → Add New → Project → import the `wangyu16/Alembic` repo.**
2. **Root Directory:** `apps/web`. Vercel detects the pnpm workspace and
   installs from the repo root automatically; workspace packages are consumed
   as source via `transpilePackages`, so no build of the packages is needed.
3. **Framework preset:** Next.js (auto-detected). Leave build/output defaults.
4. **Node.js version:** 22.x (Project Settings → General).
5. Add the **Environment Variables** (Production) below, then **Deploy**.

### Environment variables (Vercel → Settings → Environment Variables)

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL        = https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY   = <publishable/anon key>
SUPABASE_SECRET_KEY             = <service-role/secret key>   # admin module + research export (M35/M36)

# AI — set EITHER Gemini-direct (b-blank) OR the gateway block. See .env.example for the full recipe.
GEMINI_API_KEY                  = <Gemini key>                # dev/testing default
# Gateway (self-hosted LiteLLM — the chosen control plane as of 2026-08-28;
# Portkey is SUPERSEDED, see specs/worker-tier.md §1.5). The app prefers the
# gateway whenever URL + key are set. GatewayProvider is OpenAI-compatible, so
# this is a config-only swap.
AI_GATEWAY_URL                  = https://<your-litellm-host>/v1
AI_GATEWAY_API_KEY              = <portkey-api-key>
AI_MODEL_DEFAULT                = @<provider-slug>/gemini-2.5-flash
AI_MODEL_STRONG                 = @<provider-slug>/gemini-2.5-pro
# Optional governance:
AI_TOKEN_BUDGET                 = <tokens per window, e.g. 2000000>   # per-user budget (M16; needs 0007)
RESEARCH_EXPORT_SALT            = <random secret>            # stable pseudonyms in the research export (M34)

# GitHub App (publishing)
GITHUB_APP_ID                   = <App ID>
GITHUB_APP_SLUG                 = <app slug>
GITHUB_APP_PRIVATE_KEY          = <PEM with literal \n, one line>
GITHUB_TEMPLATE_OWNER           = <github username/org owning the templates>
GITHUB_PUBLIC_TEMPLATE          = alembic-public-template
GITHUB_PRIVATE_TEMPLATE         = alembic-private-template
```

Notes:
- **`SUPABASE_SECRET_KEY`** is the only way `/admin` (the research/ops module)
  works — without it the page shows a "needs the service key" notice. It is the
  service-role key; it is used *exclusively* behind `requireAdmin` (never on an
  educator path) — see [specs/data-handling-review.md](specs/data-handling-review.md).
- **`RESEARCH_EXPORT_SALT`** keeps de-identified pseudonyms stable across
  exports; if unset it falls back to the secret key (still one-way, but rotates
  if you rotate the key). Set a dedicated random value for the pilot.
- **AI gateway vs. Gemini-direct:** the app prefers the gateway whenever
  `AI_GATEWAY_URL` + `AI_GATEWAY_API_KEY` are present; otherwise it uses
  `GEMINI_API_KEY`. For the pilot, route through the gateway (governance +
  budgets). **The gateway is self-hosted LiteLLM** on the owner's VPS as of
  2026-08-28 — **Portkey is superseded** (acquired by Palo Alto Networks); see
  [specs/worker-tier.md](specs/worker-tier.md) §1.5 and
  [specs/ai-architecture.md](specs/ai-architecture.md).

The first deploy will use the default `*.vercel.app` URL; the custom domain is
step 3.

## 3. Custom domain: alembic.orz.how (Cloudflare DNS)

1. **Vercel → Project → Settings → Domains → Add** `alembic.orz.how`. Vercel
   shows the DNS target.
2. **Cloudflare → orz.how → DNS → Add record:**
   - Type **CNAME**, Name `alembic`, Target `cname.vercel-dns.com`
     (use the exact target Vercel shows).
   - **Proxy status: DNS only** (grey cloud) — let Vercel handle TLS/CDN.
3. Wait for Vercel to verify and issue the certificate.

## 4. Point auth + GitHub App at the production URL

- **Supabase → Authentication → URL Configuration:**
  - **Site URL:** `https://alembic.orz.how`
  - **Redirect URLs:** add `https://alembic.orz.how/**`
  - (Keep `http://localhost:3000/**` for local dev.)
  - The GitHub OAuth app's callback (in the Supabase GitHub provider) stays the
    `https://<project-ref>.supabase.co/auth/v1/callback` URL — unchanged.

- **GitHub App → Settings:**
  - **Callback URL** and **Setup URL:** `https://alembic.orz.how/api/github/installed`
    (add alongside or replace the localhost ones).
  - **Homepage URL:** `https://alembic.orz.how`.

## 5. Smoke-test production

At `https://alembic.orz.how`:

1. Sign in with GitHub → land in the workspace.
2. Create a package, edit a section, save.
3. Draft with AI; generate a worksheet.
4. Connect publishing → Publish to GitHub → Publish website → open the live
   site link.
5. List on index → confirm it shows on `/portal`.
6. Verify the published public repo's history has **no** `private-instructor`
   paths (the core invariant) — e.g. `gh api repos/<you>/<pkg>-oer/git/trees/main?recursive=1`.

## 6. Enable the admin / research module

`/admin` (study readiness, research export, AI-usage dashboard, participant &
report management) is gated by `profiles.is_admin`. After you've signed in at
least once (so your `profiles` row exists), flag yourself in the Supabase SQL
editor:

```sql
update profiles set is_admin = true where github_username = '<your-gh-handle>';
```

Then open `https://alembic.orz.how/admin`. If it reports the service key is
missing, `SUPABASE_SECRET_KEY` isn't set (step 2).

For the full operator + live-verification + pilot sequence, follow
[PilotReadiness.md](PilotReadiness.md).

## Notes & deferrals (v0.1)

- **Worker tier / job queue:** deferred. Site builds run in-process in the
  Next server. If packages grow large or builds slow, move `buildSite` +
  `publishToBranch` into the container worker behind a queue (see the roadmap).
- **Secrets:** never commit real keys; they live only in Vercel env (prod) and
  `apps/web/.env.local` (local).
- **CI:** GitHub Actions runs typecheck + tests + web build on every push;
  keep it green before deploying.
