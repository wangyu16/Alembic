-- 0048: GitHub webhook deliveries (workspace v3, B1 Door C receiver).
--
-- The receiver verifies GitHub's signature, keeps only ids from the payload
-- (contents are re-fetched later as the App), and records one row per
-- delivery. The worker's Door C sweep processes rows in order. Service role
-- only; nothing here is readable by members.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: any (new table).

create table public.github_events (
  delivery_id     text primary key,          -- X-GitHub-Delivery (GitHub retries reuse it)
  event           text not null,             -- X-GitHub-Event
  installation_id bigint,
  repo_id         bigint,
  repo_full_name  text,
  ref             text,
  before_sha      text,
  after_sha       text,
  forced          boolean not null default false,
  pusher_login    text,
  commit_ids      text[] not null default '{}',
  received_at     timestamptz not null default now(),
  processed_at    timestamptz
);
create index github_events_pending on public.github_events (received_at) where processed_at is null;
alter table public.github_events enable row level security;
revoke all on public.github_events from anon, authenticated;
