-- Staging bucket — the ONLY object-storage use in the platform.
-- See docs/specs/storage-and-write-paths.md §2 ("Ephemeral surfaces") and §5
-- (raw materials & job artifacts).
--
-- Role: transient intake for zip/raw-material uploads (Word/PDF/PPT/zip) that
-- are too large or too binary to push through a form post. Bytes land here,
-- get consumed by the populate/import run, and are deleted. It is STAGING,
-- NEVER a home: nothing durable lives here, nothing reads from here after the
-- run that staged it, and no permalink ever points here. Permanent content
-- lives in the educator's own GitHub repositories (rule 4 / the no-lock-in
-- promise); trial content lives in `sandbox_files`.
--
-- TTL / cleanup expectation (there is no automatic bucket TTL in Supabase
-- Storage, so this is a contract the code + an operator sweep uphold):
--   1. The populate/import path deletes each staged object as soon as it has
--      been consumed successfully (`deleteStagingObject` in
--      apps/web/src/lib/staging.ts).
--   2. A failed or abandoned run leaves an orphan. An operator/cron sweep
--      removes every object in this bucket older than 24 hours — nothing in
--      the product may depend on a staged object surviving that long.
--   3. Anything still present after 24h is by definition garbage, not data
--      loss: the educator keeps their original file.
-- Recorded in the Deployment doc alongside the migration order.
--
-- Additive: this migration only inserts a bucket row and creates four
-- storage.objects policies that are namespaced to this bucket. It changes no
-- existing table, policy, or bucket.

-- ---------------------------------------------------------------------------
-- The bucket: PRIVATE (public = false). Every read goes through RLS + a signed
-- URL; there is no anonymous URL for a staged object.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('staging', 'staging', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS: a user may only touch objects under their OWN user-id prefix, i.e. the
-- object name must be `<auth.uid()>/<something>`. `storage.foldername(name)`
-- returns the path segments; `[1]` is the first folder. This mirrors the
-- owner-only style of the app tables (0014/0018) and the banned-account
-- backstop from 0018 — a banned account reaches nothing, reads included,
-- exactly as for `packages`/`sandbox_files`.
--
-- storage.objects already has RLS enabled by Supabase; policies are additive.
-- Each policy is namespaced by `bucket_id = 'staging'` so no other bucket's
-- behaviour changes.
-- ---------------------------------------------------------------------------
drop policy if exists "staging owner reads" on storage.objects;
create policy "staging owner reads" on storage.objects
  for select using (
    bucket_id = 'staging'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_active_user())
  );

drop policy if exists "staging owner uploads" on storage.objects;
create policy "staging owner uploads" on storage.objects
  for insert with check (
    bucket_id = 'staging'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_active_user())
  );

-- Update is needed for upsert-style signed uploads; the prefix check applies to
-- both the existing row and the proposed one, so an object can never be moved
-- out of (or into) another user's prefix.
drop policy if exists "staging owner updates" on storage.objects;
create policy "staging owner updates" on storage.objects
  for update
  using (
    bucket_id = 'staging'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_active_user())
  )
  with check (
    bucket_id = 'staging'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_active_user())
  );

-- Delete is the normal end of a staged object's life (step 1 above), so the
-- owner must be able to do it themselves; the operator sweep runs with the
-- service role and bypasses RLS.
drop policy if exists "staging owner deletes" on storage.objects;
create policy "staging owner deletes" on storage.objects
  for delete using (
    bucket_id = 'staging'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_active_user())
  );
