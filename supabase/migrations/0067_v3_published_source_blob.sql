-- Each published file's source version (family SITE-TYPE-CONTRACT §7): the git blob id of the working-copy
-- file it was published from. The public copy holds a clean copy for SVGs and pages with raw HTML, so its
-- blob never matches the source; comparing with the source tells the Publish page exactly what changed.
-- Null for files published before this column (they compare by the public blob, as before).
alter table public.published_files add column if not exists source_blob text;
