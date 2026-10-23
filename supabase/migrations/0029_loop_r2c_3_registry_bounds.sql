-- Correctness loop r2 (round-2 audit, 2026-10-23), finding H-D1 at the
-- source (P5.A.1.o): the registry's owner-written text columns are bounded.
-- NOT APPLIED anywhere yet. Independent of 0029_loop_r2c_1 (whose projector
-- caps make any stored value harmless to discovery); this stops the storage
-- of megabyte "descriptions" in the first place.
--
-- THE HOLE. documents.description / alt_text / tags had no bound: the owner's
-- own session (RLS allows the owner to update them) could store a 1.3 MB
-- description, which then broke every discovery_rebuild() (tsvector limit).
--
-- THE FIX. CHECK constraints with the limits the app now enforces in
-- setAssetMetadataAction (package-contract REGISTRY_TEXT_LIMITS):
--   description ≤ 4,000 characters, alt_text ≤ 2,000, at most 64 tags of at
--   most 100 characters each.
-- Rows already beyond a limit are first brought within it (the text is cut
-- at the limit; extra tags dropped) so the constraints can be VALIDATED —
-- otherwise any later update of such a row (a save's registration) would be
-- refused. Count them first with the pre-check below; expect zero.
--
-- READ-ONLY PRE-CHECK (run first):
--   select count(*) filter (where char_length(description) > 4000) as long_descriptions,
--          count(*) filter (where char_length(alt_text) > 2000) as long_alt_texts,
--          count(*) filter (where cardinality(tags) > 64
--            or exists (select 1 from unnest(tags) t where char_length(t) > 100)) as long_tags
--   from public.documents;
--
-- DEPLOY ORDER: code first (the r2c setAssetMetadataAction refuses an
-- over-long value with an educator message; old code would get a generic
-- "Couldn't save"), then this. Apply after 0029_loop_r2c_2.

create or replace function public.registry_tags_bounded(p_tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(p_tags), 0) <= 64
     and not exists (select 1 from unnest(coalesce(p_tags, '{}')) t where char_length(t) > 100)
$$;
revoke all on function public.registry_tags_bounded(text[]) from public;
grant execute on function public.registry_tags_bounded(text[]) to anon, authenticated, service_role;

-- Bring stored values within the limits (the owning triggers keep their
-- columns; only these three are touched, and only on rows beyond a limit).
update public.documents
set description = left(description, 4000)
where char_length(description) > 4000;

update public.documents
set alt_text = left(alt_text, 2000)
where char_length(alt_text) > 2000;

update public.documents
set tags = (select coalesce(array_agg(left(t, 100) order by n), '{}')
            from unnest(tags) with ordinality as u(t, n) where n <= 64)
where not public.registry_tags_bounded(tags);

alter table public.documents
  drop constraint if exists documents_description_bounded,
  drop constraint if exists documents_alt_text_bounded,
  drop constraint if exists documents_tags_bounded;
alter table public.documents
  add constraint documents_description_bounded check (char_length(description) <= 4000),
  add constraint documents_alt_text_bounded check (char_length(alt_text) <= 2000),
  add constraint documents_tags_bounded check (public.registry_tags_bounded(tags));
