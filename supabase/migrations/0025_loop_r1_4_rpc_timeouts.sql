-- Security loop r1 (2026-10-23), finding L4a: the discovery RPCs are callable
-- with the public anon key directly (PostgREST), past the app's search rate
-- limit. NOT APPLIED anywhere yet.
--
-- What bounds a direct call:
--   * per-call WORK, in SQL (0022): query text cut to 200 characters, prefix
--     query to 8 tokens, pages clamped to 51 rows, keyset paging (no OFFSET),
--     facets to 50 values each;
--   * per-call TIME, the calling role's statement_timeout — pinned here.
--     Postgres arms statement_timeout when a statement starts, so a function's
--     own `set statement_timeout` would NOT bound the one-statement PostgREST
--     call that runs it; PostgREST applies the impersonated role's settings at
--     the start of each request, so the role setting does;
--   * Supabase's platform limits (outside this schema): the API gateway's
--     request limits for the project, PostgREST's max-rows, and the connection
--     pool size, which caps concurrent calls.
-- The values are Supabase's own defaults (anon 3 s, authenticated 8 s);
-- stating them here makes them part of the schema and visible in review.
-- Volume (calls per second from one client) is NOT bounded by the database;
-- the app's own search limit covers only calls made through the app.
--
-- DEPLOY ORDER: independent of the code. If an operator raised these in the
-- dashboard on purpose, re-apply the chosen values after this file.

alter role anon set statement_timeout = '3s';
alter role authenticated set statement_timeout = '8s';
