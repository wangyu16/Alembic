/**
 * Hand-ins that wait for a typing person (agent-runtime §4.1, §14.5). A person is "typing" in a file while their editor
 * saved it (a `sync` row with an actor) in the last 2 minutes. A hand-in touching such a file waits as `pending`; this
 * pass queues it once nobody has typed in its files for 2 minutes, or after 30 minutes at most (then the version rule
 * decides, with the typist's version on top). Records-only hand-ins never wait.
 */
import { SqlQueueStore, type SqlClient } from "./sql-queue-store";

export const TYPING_QUIET_MINUTES = 2;
export const MAX_WAIT_MINUTES = 30;

/** Is a person typing in any of these files of the course now? */
export async function someoneTyping(sql: SqlClient, packageId: string, paths: readonly string[]): Promise<boolean> {
  if (!paths.length) return false;
  const { rows } = await sql.query<{ n: number }>(
    `select count(*)::int as n from public.write_queue q
      where q.package_id = $1 and q.kind = 'sync' and q.actor_id is not null and q.created_at > now() - make_interval(mins => $3)
        and exists (select 1 from jsonb_array_elements(q.payload->'files') f where f->>'path' = any ($2::text[]))`,
    [packageId, paths, TYPING_QUIET_MINUTES],
  );
  return (rows[0]?.n ?? 0) > 0;
}

/** Queue the pending hand-ins whose files are quiet (or that waited long enough). Returns how many were queued. */
export async function promotePending(sql: SqlClient, limit = 20): Promise<number> {
  const { rows } = await sql.query<{ id: string; package_id: string; invoker_id: string; payload: unknown; paths: string[]; old: boolean; dep: string | null }>(
    `select c.id, c.package_id, c.invoker_id::text, c.pending_payload as payload, coalesce(c.pending_paths, '{}') as paths,
            c.created_at < now() - make_interval(mins => $1) as old, d.queue_row_id::text as dep
       from public.agent_changesets c left join public.agent_changesets d on d.id = c.depends_on
      where c.status = 'pending' and c.pending_payload is not null order by c.created_at limit $2`,
    [MAX_WAIT_MINUTES, limit],
  );
  let n = 0;
  for (const r of rows) {
    // Never ahead of what it depends on: a hand-in after a pending one waits until that one is queued.
    const dep = (await sql.query<{ status: string; q: string | null }>(
      `select d.status, d.queue_row_id::text as q from public.agent_changesets c join public.agent_changesets d on d.id = c.depends_on where c.id = $1`, [r.id])).rows[0];
    if (dep?.status === "pending") continue;
    r.dep = dep?.q ?? null;
    if (!r.old && (await someoneTyping(sql, r.package_id, r.paths))) continue;
    const rowId = await new SqlQueueStore(sql).insert({
      packageId: r.package_id, kind: "changeset", idem: r.id, invokerId: r.invoker_id,
      payload: r.payload as never, dependsOn: r.dep,
    });
    await sql.query(`update public.agent_changesets set status = 'queued', queue_row_id = $2::uuid, pending_payload = null, updated_at = now() where id = $1 and status = 'pending'`, [r.id, rowId]);
    n++;
  }
  return n;
}
