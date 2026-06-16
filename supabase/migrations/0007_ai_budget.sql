-- M16 budgets: sum a caller's recent token usage for per-user budget gating.
-- Mirrors recent_ai_invocation_count (SECURITY DEFINER so the caller sees only
-- their own total without exposing governance-controlled rows).

create function public.recent_ai_token_usage(window_seconds integer)
returns bigint
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(
           sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)),
           0
         )::bigint
  from public.ai_invocations
  where user_id = (select auth.uid())
    and created_at > now() - make_interval(secs => window_seconds);
$$;
