-- Security loop r1, finding M1 (audit L4c, 2026-10-23): research events are
-- written by the server only.
--
-- DEPLOY ORDER: deploy the code FIRST (the server-side writer,
-- apps/web/src/lib/events.ts — every research_events insert goes through the
-- service client with the per-type detail allowlist), THEN apply this
-- migration. Before it is applied, client-session inserts keep working (the
-- old code path, and anyone signed in could still insert arbitrary events for
-- themselves); after it, only the server (service role) writes events. If it
-- were applied before the code, every signed-in user's events would be
-- refused and silently dropped (logging never breaks a workflow) until the
-- code ships.
--
-- Until now the "insert own events" policy (0001, tightened in 0018) let any
-- signed-in user insert any event type with any detail for themselves. The
-- table keeps RLS enabled with NO policy, and the API roles lose the insert
-- grant, so neither a browser session nor an anonymous visitor can insert.
-- The service role bypasses RLS and keeps its grants. Additive otherwise: no
-- column, data or other policy changes.

drop policy if exists "insert own events" on public.research_events;

revoke insert on public.research_events from anon, authenticated;

comment on table public.research_events is
  'Append-only research instrumentation. Written only by the server (service role) through the detail allowlist (security loop r1, M1); no API-role insert/select.';
