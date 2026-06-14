-- AI governance log (M3). Platform-side record of model calls for debugging
-- and research under data-governance rules — never a package document, never
-- committed to a repository. Doubles as the source for per-user rate limiting.

create table public.ai_invocations (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  package_id text references public.packages (id) on delete set null,
  kind text not null,            -- 'draft-section' | 'worksheet' | ...
  provider text not null,        -- 'gemini' | ...
  model text not null,
  prompt text,
  output text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);

create index ai_invocations_user_time_idx
  on public.ai_invocations (user_id, created_at);

alter table public.ai_invocations enable row level security;

-- Users may record their own invocations, but never read them back: raw
-- prompts/outputs are governance-controlled (admin/service-role export only).
create policy "insert own invocations" on public.ai_invocations
  for insert with check ((select auth.uid()) = user_id);

-- Rate limiting needs a count without exposing rows. A SECURITY DEFINER
-- function returns only the caller's recent count, bypassing the no-select rule.
create function public.recent_ai_invocation_count(window_seconds integer)
returns integer
language sql
security definer
set search_path = ''
stable
as $$
  select count(*)::integer
  from public.ai_invocations
  where user_id = (select auth.uid())
    and created_at > now() - make_interval(secs => window_seconds);
$$;
