-- 0062: Contact form with automatic sorting (operator digest).
--
-- Visitors (signed in or not) write in through /contact. The web server checks
-- the form, rate-limits it (per network and per email, lib/rate-limit.ts) and
-- files it through contact_submit, which adds a database backstop (per network
-- per day, and overall per hour). The worker sorts new messages with a
-- low-cost AI model (contact_triage_take / contact_triage_apply), under a hard
-- daily cap counted here; a message the AI can't sort stays 'new' and is shown
-- unsorted. The operator reads and closes messages on /admin/messages
-- (contact_list / contact_mark, operator only: profiles.is_admin, as 0059).
--
-- Only a keyed hash of the visitor's network is kept (for the limits), never
-- the address. Service role only: anon and authenticated can neither read nor
-- write these tables or call these functions.
--
-- READ-ONLY PRE-CHECK: none (new tables and functions only).
-- DEPLOY ORDER: after 0061 and 0023 (rate_limit_hit); before the web app that
-- serves /contact and the worker with the contact-triage schedule (both cope
-- with the functions missing: the form says it can't take messages right now,
-- the schedule logs a failure).

create table public.contact_messages (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  name              text not null check (length(btrim(name)) between 1 and 120),
  email             text not null check (length(email) between 3 and 200 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  user_id           uuid references public.profiles (id) on delete set null,
  topic             text not null check (topic in ('using', 'problem', 'workshops', 'institution', 'other')),
  message           text not null check (length(btrim(message)) between 1 and 4000),
  page              text check (page is null or length(page) <= 300),
  net_hash          text not null check (net_hash ~ '^[0-9a-f]{64}$'),
  status            text not null default 'new' check (status in ('new', 'sorted', 'handled', 'spam')),
  category          text check (category is null or category in ('how-to', 'bug', 'workshop', 'institution', 'account', 'feedback', 'other')),
  urgency           text check (urgency is null or urgency in ('low', 'normal', 'high')),
  summary           text check (summary is null or (length(summary) <= 300 and summary !~ '[[:cntrl:]]')),
  sorted_at         timestamptz,
  handled_at        timestamptz,
  handled_note      text check (handled_note is null or length(handled_note) <= 1000),
  -- The worker's claim on a message while the AI sorts it, and how often it tried (at most 3).
  triage_claimed_at timestamptz,
  triage_attempts   int not null default 0 check (triage_attempts between 0 and 3)
);
create index contact_messages_status on public.contact_messages (status, created_at desc);
create index contact_messages_net on public.contact_messages (net_hash, created_at);
alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from anon, authenticated;

-- AI sorting calls per UTC day (the hard daily cap).
create table public.contact_triage_days (
  day   date primary key,
  calls int not null default 0 check (calls >= 0)
);
alter table public.contact_triage_days enable row level security;
revoke all on public.contact_triage_days from anon, authenticated;

-- File a message (the web server, after its own checks). 'ok', or 'busy' past the backstop caps.
create function public.contact_submit(p_name text, p_email text, p_user uuid, p_topic text,
                                      p_message text, p_page text, p_net_hash text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.contact_messages
       where net_hash = p_net_hash and created_at > now() - interval '1 day') >= 30 then
    return 'busy';
  end if;
  if public.rate_limit_hit('contact:all', 3600) > 300 then return 'busy'; end if;
  insert into public.contact_messages (name, email, user_id, topic, message, page, net_hash)
  values (btrim(p_name), btrim(p_email), p_user, p_topic, btrim(p_message), nullif(btrim(coalesce(p_page, '')), ''), p_net_hash);
  return 'ok';
end $$;

-- Take up to p_limit new messages to sort, within today's cap (never more than 1000 a day,
-- whatever the caller asks). Each taken message counts one call; a message whose sorting
-- failed is taken again after 10 minutes, at most 3 times; after that it stays 'new'.
create function public.contact_triage_take(p_limit int, p_daily_cap int)
returns table (id uuid, topic text, message text)
language plpgsql security definer set search_path = '' as $$
declare
  v_day  date := (now() at time zone 'utc')::date;
  v_used int;
  v_n    int;
  v_got  int;
begin
  insert into public.contact_triage_days (day) values (v_day) on conflict (day) do nothing;
  select d.calls into v_used from public.contact_triage_days d where d.day = v_day for update;
  v_n := least(greatest(coalesce(p_limit, 0), 0), 20,
               greatest(least(coalesce(p_daily_cap, 0), 1000) - v_used, 0));
  if v_n = 0 then return; end if;
  return query
    with picked as (
      select m.id from public.contact_messages m
       where m.status = 'new' and m.triage_attempts < 3
         and (m.triage_claimed_at is null or m.triage_claimed_at < now() - interval '10 minutes')
       order by m.created_at
       limit v_n
       for update skip locked
    )
    update public.contact_messages m
       set triage_claimed_at = now(), triage_attempts = m.triage_attempts + 1
      from picked where m.id = picked.id
    returning m.id, m.topic, m.message;
  get diagnostics v_got = row_count;
  update public.contact_triage_days set calls = calls + v_got where day = v_day;
end $$;

-- Write the AI's sorting back (only the four fields; only while the message is still 'new').
create function public.contact_triage_apply(p_id uuid, p_category text, p_urgency text, p_summary text, p_spam boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.contact_messages
     set status = case when p_spam then 'spam' else 'sorted' end,
         category = p_category, urgency = p_urgency, summary = p_summary,
         sorted_at = now(), triage_claimed_at = null
   where id = p_id and status = 'new';
  return found;
end $$;

-- The operator's digest: open (new + sorted), handled or spam; newest first.
create function public.contact_list(p_actor uuid, p_view text)
returns table (id uuid, created_at timestamptz, name text, email text, signed_in boolean, topic text,
               message text, page text, status text, category text, urgency text, summary text,
               handled_at timestamptz, handled_note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce((select pr.is_admin from public.profiles pr where pr.id = p_actor), false) then
    raise exception 'Only the operator reads contact messages' using errcode = '42501';
  end if;
  return query
    select m.id, m.created_at, m.name, m.email, m.user_id is not null, m.topic, m.message, m.page,
           m.status, m.category, m.urgency, m.summary, m.handled_at, m.handled_note
      from public.contact_messages m
     where case p_view when 'handled' then m.status = 'handled'
                       when 'spam' then m.status = 'spam'
                       else m.status in ('new', 'sorted') end
     order by m.created_at desc
     limit 1000;
end $$;

-- The operator closes a message ('handled', with an optional note), marks it spam, or reopens it.
create function public.contact_mark(p_actor uuid, p_id uuid, p_status text, p_note text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select pr.is_admin from public.profiles pr where pr.id = p_actor), false) then
    raise exception 'Only the operator changes contact messages' using errcode = '42501';
  end if;
  if p_status not in ('handled', 'spam', 'open') then raise exception 'bad status' using errcode = '22023'; end if;
  update public.contact_messages
     set status = case p_status when 'open' then case when category is null then 'new' else 'sorted' end else p_status end,
         handled_at = case when p_status = 'handled' then now() else null end,
         handled_note = case when p_status = 'handled' then nullif(left(btrim(coalesce(p_note, '')), 1000), '') else null end
   where id = p_id;
  return found;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'contact_submit(text, text, uuid, text, text, text, text)', 'contact_triage_take(int, int)',
    'contact_triage_apply(uuid, text, text, text, boolean)', 'contact_list(uuid, text)',
    'contact_mark(uuid, uuid, text, text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
