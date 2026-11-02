-- 0059: Workshop codes for try mode (workspace v3, C7; design §11.5).
--
-- The operator creates a code for a workshop, with its own credit (a
-- 'cohort-pool' account holding one granted lot that expires with the code).
-- Browsers that enter the code make sample chapters paid by that pool, under
-- a per-browser daily cap and the code's own hourly cap, and skip the
-- per-network and global caps of the public demo (so 30 people on one campus
-- network can all try at once). Only the code's hash is stored. Service role
-- only; the operator acts through the admin page.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: after 0058, with 0039's
-- ledger_hold change (the pool may pay try jobs).

create table public.workshop_codes (
  id          uuid primary key default gen_random_uuid(),
  code_hash   text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  name        text not null check (length(btrim(name)) between 1 and 120),
  account_id  uuid not null unique references public.ledger_accounts (id),
  per_browser int not null default 5 check (per_browser between 1 and 50),
  per_hour    int not null default 120 check (per_hour between 1 and 1000),
  expires_at  timestamptz not null,
  created_by  uuid not null references public.profiles (id),
  created_at  timestamptz not null default now(),
  ended_at    timestamptz
);
alter table public.workshop_codes enable row level security;
revoke all on public.workshop_codes from anon, authenticated;

alter table public.try_runs add column workshop_id uuid references public.workshop_codes (id);
create index try_runs_workshop on public.try_runs (workshop_id, created_at) where workshop_id is not null;

-- Create a code (operator only): its pool, funded with granted credit that ends with the code.
create function public.workshop_create(p_actor uuid, p_name text, p_code_hash text, p_amount numeric,
                                       p_expires timestamptz, p_per_browser int default 5)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_acc uuid; v_id uuid;
begin
  if not coalesce((select is_admin from public.profiles where id = p_actor), false) then
    raise exception 'Only the operator creates workshop codes' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then raise exception 'bad amount' using errcode = '22023'; end if;
  if p_expires is null or p_expires <= now() or p_expires > now() + interval '90 days' then
    raise exception 'A workshop code lasts between now and 90 days' using errcode = '22023';
  end if;
  insert into public.ledger_accounts (kind) values ('cohort-pool') returning id into v_acc;
  insert into public.workshop_codes (code_hash, name, account_id, per_browser, expires_at, created_by)
  values (p_code_hash, btrim(p_name), v_acc, coalesce(p_per_browser, 5), p_expires, p_actor) returning id into v_id;
  perform public.ledger_new_lot(v_acc, 'granted', 'workshop:' || v_id, p_amount, p_expires, 'grant', 'workshop:' || v_id);
  return v_id;
end $$;

-- End a code early (operator only): it stops working at once; what's left of its credit stays unused.
create function public.workshop_end(p_actor uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select is_admin from public.profiles where id = p_actor), false) then
    raise exception 'Only the operator ends workshop codes' using errcode = '42501';
  end if;
  update public.workshop_codes set ended_at = now() where id = p_id and ended_at is null;
end $$;

-- The codes with their use and what's left (operator only).
create function public.workshop_list(p_actor uuid)
returns table (id uuid, name text, expires_at timestamptz, ended_at timestamptz, per_browser int,
               runs bigint, remaining numeric, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce((select pr.is_admin from public.profiles pr where pr.id = p_actor), false) then
    raise exception 'Only the operator sees workshop codes' using errcode = '42501';
  end if;
  return query
    select w.id, w.name, w.expires_at, w.ended_at, w.per_browser,
           (select count(*) from public.try_runs t where t.workshop_id = w.id),
           public.ledger_balance(w.account_id), w.created_at
      from public.workshop_codes w order by w.created_at desc limit 200;
end $$;

-- Start a sample chapter on a workshop code: the code's caps, then a 'try' job held on its pool.
create function public.try_start_workshop(p_code_hash text, p_browser text, p_network text, p_estimate numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare w public.workshop_codes; v_job uuid;
begin
  select * into w from public.workshop_codes where code_hash = p_code_hash for update;
  if not found or w.ended_at is not null or w.expires_at <= now() then
    raise exception 'That workshop code isn''t valid (or has ended)' using errcode = '22023';
  end if;
  if (select count(*) from public.try_runs where workshop_id = w.id and created_at > now() - interval '1 hour') >= w.per_hour then
    raise exception 'This workshop''s hourly limit is reached; try again shortly' using errcode = '53400';
  end if;
  if (select count(*) from public.try_runs where workshop_id = w.id and browser_hash = p_browser and created_at > now() - interval '1 day') >= w.per_browser then
    raise exception 'daily limit for this browser reached' using errcode = '53400';
  end if;
  insert into public.ai_jobs (payer_account_id, kind) values (w.account_id, 'try') returning id into v_job;
  perform public.ledger_hold(null, v_job, p_estimate);  -- 'Not enough credit' (53400) when the workshop's credit is used up
  insert into public.try_runs (job_id, browser_hash, network_hash, workshop_id) values (v_job, p_browser, p_network, w.id);
  return v_job;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'workshop_create(uuid, text, text, numeric, timestamptz, int)', 'workshop_end(uuid, uuid)', 'workshop_list(uuid)',
    'try_start_workshop(text, text, text, numeric)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
