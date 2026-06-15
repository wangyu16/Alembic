# Alembic OER package (public)

This repository holds the **public** half of an Alembic open educational
resource package: the study guide, public materials, provenance, metadata, and
the published site source. Its companion **private** repository holds
instructor notes, answer keys, and embargoed assessments.

Managed with [Alembic](https://github.com/wangyu16/Alembic), but this is a
plain Git repository — it remains usable, buildable, and adaptable without the
platform. The package manifest is `alembic.json`.

## Building the site without Alembic

This repo carries a self-contained build that depends only on the public
`orz-markdown` package (no Alembic code):

```bash
npm --prefix .alembic/build install
node .alembic/build/build-site.mjs    # → ./_site
```

A GitHub Actions workflow (`.github/workflows/build-site.yml`) does the same and
deploys to GitHub Pages. It's **manual by default** (Actions tab → "Build site"
→ Run) so it doesn't conflict with Alembic's own publishing; set
**Settings → Pages → Source = GitHub Actions** first. To make a fork
self-publishing on every push, add `push: { branches: [main] }` to the
workflow's `on:` triggers.
