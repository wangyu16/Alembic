-- 0056: Live editor updates (workspace v3, A8; design §7.1).
--
-- Members may read their course's document versions (path, version id,
-- commit: never the text), and new versions are published over Supabase
-- Realtime, so an open editor learns at once that a co-author's sync or an
-- edit made on GitHub has landed, then reads the text through the app.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0055.

grant select on public.doc_versions to authenticated;
create policy "members read their course's versions" on public.doc_versions
  for select to authenticated using ((select public.course_role(package_id)) is not null);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.doc_versions;
  end if;
end $$;
