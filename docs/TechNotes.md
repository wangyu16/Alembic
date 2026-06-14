# Technical Notes & Gotchas

Durable record of non-obvious technical decisions and side effects, so future
work doesn't rediscover them the hard way. Newest first.

---

## AI governed-provider failure modes (2026-06-11)

`apps/web/src/lib/ai.ts` wraps the AI provider with rate limiting + governance
logging (`ai_invocations`, migration 0002). Two deliberate behaviors:

- **Rate limit fails open.** If `recent_ai_invocation_count` errors (e.g. the
  function/table is missing), the request is **allowed**, not blocked — better
  to serve AI than to hard-fail everyone if the limiter breaks. The failure is
  logged (`console.warn`).
- **Governance logging is best-effort but not silent.** A failed
  `ai_invocations` insert does **not** break the educator's request, but it IS
  surfaced (`console.error`) — losing a prompt/output record is a
  data-governance gap we want to notice.

Consequence observed before migration 0002 was applied: AI drafting "worked"
(the model call succeeded) while logging + rate limiting silently no-op'd.
After 0002, both are active. If governance completeness ever becomes
hard-required, escalate the insert failure (queue/retry) rather than only log.

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
