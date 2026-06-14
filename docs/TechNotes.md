# Technical Notes & Gotchas

Durable record of non-obvious technical decisions and side effects, so future
work doesn't rediscover them the hard way. Newest first.

---

## Auth-aware global nav makes all routes dynamic (2026-06-11)

**What:** `SiteHeader` (rendered in the root `app/layout.tsx`) calls
`supabase.auth.getUser()`, which reads the session cookie. Reading cookies in
the root layout opts **every route** into dynamic rendering — the build output
shows all routes as `ƒ (Dynamic)` (server-rendered on demand), including the
home page and `/signin`, which were previously `○ (Static)`.

**Why we accepted it:** a correct signed-in/out nav across the whole app is
worth more than static prerendering at v0.1, where there are no
high-traffic public pages yet.

**Revisit when:** public, cacheable pages need static prerendering / CDN
caching — most likely the landing page and the future **portal/discovery**
pages (Phase 6). Options at that point, roughly in order of preference:
1. Move the auth check out of the root layout into the authenticated segment
   layout(s) only (e.g. a `(app)` route group), leaving public pages static.
2. Make the header a client component that fetches auth state after hydration
   (trade-off: a brief flash of the signed-out nav).
3. Use Partial Prerendering to keep the static shell and stream the nav.
