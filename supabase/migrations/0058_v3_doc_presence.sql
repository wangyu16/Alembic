-- 0058: Who else has a document open (workspace v3, A8 presence).
--
-- The editor joins a PRIVATE Realtime channel `presence:<packageId>:<path>`
-- and shares only the person's display name. Realtime Authorization checks
-- these policies on realtime.messages: only members of that course may join
-- (select) or announce themselves (insert), and only for presence. Anyone
-- else (anon, non-members, banned users: course_role is null) is refused.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: any. Skipped where the realtime
-- schema doesn't exist (local test databases).

do $$
begin
  if to_regclass('realtime.messages') is not null and to_regprocedure('realtime.topic()') is not null then
    execute $p$
      create policy "course members see document presence" on realtime.messages
        for select to authenticated
        using (
          realtime.messages.extension = 'presence'
          and split_part((select realtime.topic()), ':', 1) = 'presence'
          and (select public.course_role(split_part((select realtime.topic()), ':', 2))) is not null
        )
    $p$;
    execute $p$
      create policy "course members share document presence" on realtime.messages
        for insert to authenticated
        with check (
          realtime.messages.extension = 'presence'
          and split_part((select realtime.topic()), ':', 1) = 'presence'
          and (select public.course_role(split_part((select realtime.topic()), ':', 2))) is not null
        )
    $p$;
  end if;
end $$;
