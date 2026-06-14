# Local Setup — Supabase + GitHub sign-in (M1)

What you need to run Alembic locally: a Supabase project (Postgres + Auth) and
a GitHub OAuth app for sign-in. Do these once. ~10 minutes.

The order matters: create the Supabase project first (you need its URL to
register the GitHub OAuth app), then GitHub, then wire them together.

---

## 1. Create the Supabase project

1. https://supabase.com/dashboard → **New project**. Pick a name (e.g.
   `alembic-dev`), a strong database password, and a region near you.
2. Wait for it to provision (~2 min).
3. Open **Project Settings → Data API** (or **API**) and note two values:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon / public key** (newer projects call it the **publishable key**) —
     the *public* key, safe to ship to the browser. **Not** the secret/service key.

The part of the URL before `.supabase.co` (here `abcdefgh`) is your
**project ref** — you need it in step 2.

## 2. Create the GitHub OAuth app (identity only)

1. https://github.com/settings/developers → **OAuth Apps** → **New OAuth App**.
2. Fill in:
   - **Application name:** `Alembic (dev)`
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:**
     `https://<project-ref>.supabase.co/auth/v1/callback`
     (use your real project ref from step 1)
3. **Register application**, then **Generate a new client secret**.
4. Note the **Client ID** and **Client secret**.

> This is sign-in identity only — no repository scopes. Repository access comes
> later (M5) through a separate GitHub *App*, not this OAuth app.

## 3. Wire GitHub into Supabase Auth

1. Supabase dashboard → **Authentication → Sign In / Providers → GitHub**.
2. Enable it; paste the **Client ID** and **Client secret** from step 2. Save.
3. **Authentication → URL Configuration:**
   - **Site URL:** `http://localhost:3000`
   - **Redirect URLs:** add `http://localhost:3000/**`
     (this allows the `/auth/callback` return after sign-in)

## 4. Apply the database schema

1. Supabase dashboard → **SQL Editor → New query**.
2. Paste the entire contents of
   [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql)
   and **Run**.
3. Confirm in **Table Editor** that these tables exist: `profiles`,
   `packages`, `sandbox_files`, `research_events`.

## 5. Local environment file

Create `apps/web/.env.local` (gitignored) with the values from step 1:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
```

(The AI key, `GEMINI_API_KEY`, isn't needed until M3.)

## 6. Run it

```bash
pnpm dev:web
```

Open http://localhost:3000 → **Sign in** → **Continue with GitHub**. After
authorizing, you land in the workspace. Create a package, open the editor,
add a section, watch the live preview, and save.

### Quick checks if something's off

- **"Supabase is not configured"** → `.env.local` missing or the dev server
  wasn't restarted after creating it.
- **Redirect/`redirect_uri` mismatch after GitHub** → the OAuth callback URL
  (step 2) must be the `…supabase.co/auth/v1/callback` URL, and Supabase's
  Redirect URLs (step 3) must include `http://localhost:3000/**`.
- **Signed in but the workspace is empty / RLS errors** → confirm the
  migration ran and `on_auth_user_created` created a row in `profiles`.
