# GitHub App Setup (M5 — Connect publishing)

To publish packages to GitHub, Alembic uses a **GitHub App** — separate from
the GitHub OAuth sign-in (which is identity only). The App gets scoped,
per-repository access via short-lived installation tokens, so educators can
verify Alembic touches only their Alembic materials. ~15 minutes, one time.

Why an App (not the OAuth token): a GitHub App installed on a personal account
creates repositories via the **generate-from-template** endpoint, so we set up
two template repositories first.

---

## 1. Create the two template repositories

Create two repositories on your GitHub account and mark each as a **template**:

1. **`alembic-public-template`** — copy in the files from
   [`templates/public-repo/`](../templates/public-repo/): `README.md`,
   `.gitignore`, and the self-contained build config (`.alembic/build/` +
   `.github/workflows/build-site.yml`) that lets the repo rebuild its site
   independently of Alembic.
2. **`alembic-private-template`** — copy in the files from
   [`templates/private-repo/`](../templates/private-repo/).

For each: repo **Settings → General → check "Template repository."**
(The public one can be public; the private one can be private — generate
copies content either way.)

## 2. Create the GitHub App

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**:

- **GitHub App name:** something globally unique, e.g. `alembic-dev-<yourname>`
- **Homepage URL:** `http://localhost:3000`
- **Callback URL:** `http://localhost:3000/api/github/installed`
- **Setup URL (after installation):** `http://localhost:3000/api/github/installed`
  and check **"Redirect on update."**
- **Webhook:** uncheck **Active** (not needed for v0.1).
- **Repository permissions:**
  - **Administration:** Read & write (create repositories from templates)
  - **Contents:** Read & write (commits, file reads, restore)
  - **Pages:** Read & write (publish the student website to GitHub Pages)
  - **Metadata:** Read-only (default)
- **Where can this app be installed?** "Any account" (or "Only on this account" for dev).

Create the app, then on its page note the **App ID**, and under
**Private keys → Generate a private key** download the `.pem` file.

> **Changing permissions later:** if you edit the App's permissions after it's
> installed (e.g. adding **Pages: write**), GitHub holds the change as a
> *pending request* — the existing installation keeps its old scopes until you
> **accept the update**: Settings → Applications → Installed GitHub Apps → your
> Alembic app → review and approve the new permissions. Until you do, calls
> needing the new scope (like enabling Pages) will fail.

## 3. Install the App on your account

From the App's page → **Install App** → install on your account, choosing
**All repositories** (simplest for dev: lets the App read the templates and
access the new repos it creates).

After installing you'll be redirected to
`http://localhost:3000/api/github/installed?installation_id=…&setup_action=install`,
which Alembic uses to remember your installation. (If the dev server isn't
running yet, just install now and click **Connect publishing** in the app
later — it will reuse the installation.)

## 4. Local environment

Add to `apps/web/.env.local`:

```
GITHUB_APP_ID=<App ID from step 2>
GITHUB_APP_SLUG=<the app's URL slug, e.g. alembic-dev-yourname>
# The private key PEM, with literal newlines replaced by \n, on one line:
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n…\n-----END RSA PRIVATE KEY-----\n"
# Template repos from step 1 (owner is your GitHub username):
GITHUB_TEMPLATE_OWNER=<your-github-username>
GITHUB_PUBLIC_TEMPLATE=alembic-public-template
GITHUB_PRIVATE_TEMPLATE=alembic-private-template
```

To turn the `.pem` into a single-line value:

```bash
awk 'BEGIN{ORS="\\n"} {print}' path/to/key.pem
```

Restart `pnpm dev:web` after editing `.env.local`.

## 5. Verify

In a package's editor, **Connect publishing** (or open
`/api/github/installed` after installing). Then **Publish to GitHub** creates
the paired repos and pushes your content. The advanced panel shows the real
repo names and commits.
