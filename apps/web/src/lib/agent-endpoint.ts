import "server-only";
/**
 * The agent endpoints (agent-runtime-v3 §2, §4, §11, §14, §15; C4 step 2b). Every request carries the agent token
 * (added by the sandbox's outbound layer, never seen by the agent); it is refused unless the token's job is the
 * session's running job for the same course and the person who asked is still an editor. The agent gets no route of
 * its own around the write path: its changes are queued as `changeset` rows and committed by the course committer,
 * which checks them again (K1.34–K1.37).
 */
import { createHash } from "node:crypto";
import {
  appliedAppend, openForJob, parseEvent, parseHandIn, sandboxKeyHash, SqlQueueStore, verifyAgentToken, HANDIN_LIMITS,
  type AgentClaims, type AgentKey, type HandIn, type RowFile, type SqlClient,
} from "@alembic/package-ops";
import { fileKind, isServerOnlyPath, normalizePath, type Role } from "@alembic/package-contract";
import { directDb } from "@/lib/db";
import { courseRepo } from "@/lib/course-v3";

export type AgentCtx = { claims: AgentClaims; invoker: Role; rightsCap: "co-author" | null; sessionState: string; sql: SqlClient };
export type Reply = { status: number; body: Record<string, unknown> };
const fail = (status: number, reason: string): Reply => ({ status, body: { error: reason } });
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const RANK: Record<string, number> = { owner: 3, deputy: 2, "co-author": 1 };

/** The agent keys: `ALEMBIC_AGENT_KEYS="kid:base64secret,kid2:base64secret"` (rotation: several at once). */
export function agentKeys(): AgentKey[] {
  return (process.env["ALEMBIC_AGENT_KEYS"] ?? "").split(",").map((p) => p.trim()).filter(Boolean).flatMap((p) => {
    const at = p.indexOf(":");
    if (at <= 0) return [];
    const secret = Buffer.from(p.slice(at + 1), "base64");
    return secret.length >= 32 ? [{ kid: p.slice(0, at), secret: new Uint8Array(secret) }] : [];
  });
}

/**
 * The job a sandbox acts for (agent-runtime §18): the sandbox's own key (put in by its provider's outbound proxy; the
 * agent holds only a placeholder) and the job it names, which must be running in that sandbox. Returns the job's
 * claims and its sealed gateway key, or null.
 */
export async function sandboxJob(req: Request, sql: SqlClient): Promise<{ claims: AgentClaims; sealed: string | null } | null> {
  const key = req.headers.get("x-alembic-sandbox") ?? "";
  const job = req.headers.get("x-alembic-job") ?? "";
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(key) || !/^aj-[a-z0-9]{12}$/.test(job)) return null;
  const { rows } = await sql.query<{ package_id: string; session_id: string; invoker_id: string | null; sealed: string | null }>(
    `select j.package_id, j.session_id, j.invoker_id::text as invoker_id, j.gateway_key_sealed as sealed
       from public.agent_jobs j
       join public.agent_sessions s on s.id = j.session_id and s.package_id = j.package_id
       join public.agent_sandboxes b on b.ref = s.sandbox_ref and b.retired_at is null
      where j.id = $1 and j.status = 'running' and b.key_hash = $2`,
    [job, sandboxKeyHash(key)],
  );
  const r = rows[0];
  if (!r || !r.invoker_id) return null;
  return { claims: { package_id: r.package_id, session_id: r.session_id, job_id: job, invoker_id: r.invoker_id }, sealed: r.sealed };
}

/**
 * The job's context, or a refusal: from a sandbox (its key and a running job of its own, §18), or from an agent
 * token (§2). A Supabase login token is never accepted here (other key and audience).
 */
export async function agentAuth(req: Request): Promise<{ ok: true; ctx: AgentCtx } | { ok: false; reply: Reply }> {
  const sql = directDb();
  const keys = agentKeys();
  if (!sql || !keys.length) return { ok: false, reply: fail(503, "the assistant isn't available here") };
  let c: AgentClaims;
  if (req.headers.get("x-alembic-sandbox")) {
    const sb = await sandboxJob(req, sql);
    if (!sb) return { ok: false, reply: fail(401, "this sandbox has no such running job") };
    c = sb.claims;
  } else {
    const m = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(req.headers.get("authorization") ?? "");
    if (!m) return { ok: false, reply: fail(401, "no agent token") };
    const v = verifyAgentToken(m[1]!, keys);
    if (!v.ok) return { ok: false, reply: fail(401, `agent token: ${v.reason}`) };
    c = v.claims;
  }
  const { rows } = await sql.query<{ status: string; rights_cap: string | null; invoker_id: string | null; state: string }>(
    `select j.status, j.rights_cap, j.invoker_id::text as invoker_id, s.state
       from public.agent_jobs j join public.agent_sessions s on s.id = j.session_id
      where j.id = $1 and j.session_id = $2 and j.package_id = $3 and s.package_id = $3`,
    [c.job_id, c.session_id, c.package_id],
  );
  const j = rows[0];
  if (!j || j.status !== "running" || j.invoker_id !== c.invoker_id) return { ok: false, reply: fail(403, "this job isn't running") };
  let invoker: Role = await new SqlQueueStore(sql).roleOf(c.package_id, c.invoker_id);
  if (j.rights_cap === "co-author" && (RANK[invoker] ?? 0) > RANK["co-author"]!) invoker = "co-author";
  if (!(invoker in RANK)) return { ok: false, reply: fail(403, "the person who asked can't edit this course any more") };
  return { ok: true, ctx: { claims: c, invoker, rightsCap: j.rights_cap === "co-author" ? "co-author" : null, sessionState: j.state, sql } };
}

type Registry = { id: string; package_id: string; job_id: string; status: string; queue_row_id: string | null; reason: string | null };

async function setStatus(sql: SqlClient, id: string, status: string, reason: string | null = null, queueRow: string | null = null): Promise<void> {
  await sql.query(`update public.agent_changesets set status = $2, reason = $3, queue_row_id = coalesce($4::uuid, queue_row_id), updated_at = now() where id = $1`, [id, status, reason?.slice(0, 500) ?? null, queueRow]);
}

/** `POST /api/agent/changesets` */
export async function handIn(ctx: AgentCtx, raw: unknown): Promise<Reply> {
  const { sql, claims } = ctx;
  const parsed = parseHandIn(raw, ctx.invoker);
  if (!parsed.ok) return fail(400, parsed.reason);
  const h: HandIn = parsed.value;

  // One record from first receipt (R-12): a repeat answers with what happened the first time.
  const ins = await sql.query<Registry>(
    `insert into public.agent_changesets (id, package_id, job_id, invoker_id, status, files, record_bytes)
     values ($1, $2, $3, $4::uuid, 'pending', $5, $6) on conflict (id) do nothing returning id`,
    [h.changesetId, claims.package_id, claims.job_id, claims.invoker_id, h.files.length + h.appends.length, h.recordBytes],
  );
  if (!ins.rows.length) {
    const { rows } = await sql.query<Registry>(`select id, package_id, job_id, status, queue_row_id::text, reason from public.agent_changesets where id = $1`, [h.changesetId]);
    const r = rows[0];
    if (!r || r.package_id !== claims.package_id || r.job_id !== claims.job_id) return fail(409, "that changesetId is in use");
    return { status: 200, body: { changesetId: r.id, status: r.status, ...(r.reason ? { reason: r.reason } : {}), repeat: true } };
  }
  const refuse = async (reason: string): Promise<Reply> => { await setStatus(sql, h.changesetId, "refused", reason); return { status: 409, body: { changesetId: h.changesetId, status: "refused", reason } }; };

  if (ctx.sessionState === "paused:owner" || ctx.sessionState === "paused:handout") return refuse("the assistant is paused for this course");

  // The question digest (§14.1, §15 M5): raised at receipt, deduped by changesetId; a new digest replaces the
  // unanswered questions of the old one; over 20 open question items the questions are refused, never queued.
  if (h.questions.length) {
    const open = await sql.query<{ n: number }>(
      `select count(*)::int as n from public.needs_you where package_id = $1 and kind = 'question' and origin = 'agent' and state in ('waiting','shown') and $2::uuid = any (addressed_to) and coalesce(payload->>'digest','') <> 'true'`,
      [claims.package_id, claims.invoker_id],
    );
    if ((open.rows[0]?.n ?? 0) + 1 > HANDIN_LIMITS.openQuestions) return refuse("too many open questions for this person; wait for answers");
    await sql.query(
      `update public.needs_you set state = 'superseded' where package_id = $1 and kind = 'question' and origin = 'agent' and state in ('waiting','shown') and $2::uuid = any (addressed_to) and payload->>'digest' = 'true'`,
      [claims.package_id, claims.invoker_id],
    );
    await sql.query(
      `select public.needs_you_raise($1, 'question', 'agent', $2, $3::text::jsonb, null, null, false, array[$4::uuid], false)`,
      [claims.package_id, `digest:${h.changesetId}`, JSON.stringify({ digest: true, changesetId: h.changesetId, jobId: claims.job_id, sessionId: claims.session_id, questions: h.questions }), claims.invoker_id],
    );
  }

  // Course operations are proposals (§11.2): one approve item each, for the owner and deputy (the licence: the owner).
  if (h.courseOps.length) {
    const leads = await sql.query<{ user_id: string; role: string }>(
      // The owner and the current deputies (a deputy is a co-author with a running `deputy_until`).
      `select owner_id::text as user_id, 'owner' as role from public.packages where id = $1
       union select user_id::text, case when role = 'owner' then 'owner' else 'deputy' end from public.course_members
        where package_id = $1 and (role = 'owner' or (deputy_until is not null and deputy_until > now()))`,
      [claims.package_id],
    );
    for (const [k, op] of h.courseOps.entries()) {
      const to = leads.rows.filter((l) => op.op !== "setLicense" || l.role === "owner").map((l) => l.user_id);
      await sql.query(
        `select public.needs_you_raise($1, 'approve', 'platform', $2, $3::text::jsonb, null, null, false, $4::uuid[], false)`,
        [claims.package_id, `agent-op:${h.changesetId}:${k}`, JSON.stringify({ from: "assistant", action: op, changesetId: h.changesetId, invokerId: claims.invoker_id }), to],
      );
    }
  }

  const files: RowFile[] = [...h.files];
  if (h.appends.length) {
    const course = await courseRepo(claims.package_id);
    if (!course) return refuse("the course's files can't be reached now; try again");
    const head = await course.repo.head();
    for (const a of h.appends) {
      const current = await course.repo.readFile(head, a.path);
      const text = appliedAppend(current, current === null ? null : sha(current), a);
      if (text === null) return refuse(`${a.path}: the log changed since it was read; read it again`);
      files.push({ path: a.path, baseVersion: a.baseVersion, text });
    }
  }

  if (!files.length) {
    await setStatus(sql, h.changesetId, h.courseOps.length ? "proposed" : "done");
    return { status: 202, body: { changesetId: h.changesetId, status: h.courseOps.length ? "proposed" : "done" } };
  }

  let dependsOnRow: string | null = null;
  if (h.dependsOn) {
    const { rows } = await sql.query<Registry>(`select id, package_id, job_id, status, queue_row_id::text, reason from public.agent_changesets where id = $1`, [h.dependsOn]);
    const d = rows[0];
    if (!d || d.package_id !== claims.package_id) return refuse("hand in the change this one depends on first");
    if (d.status === "refused" || d.status === "failed") return refuse("the change this one depends on didn't land");
    dependsOnRow = d.queue_row_id;
    if (!dependsOnRow && d.status !== "done" && d.status !== "proposed") return refuse("hand in the change this one depends on first");
  }
  const rowId = await new SqlQueueStore(sql).insert({
    packageId: claims.package_id, kind: "changeset", idem: h.changesetId, invokerId: claims.invoker_id,
    payload: { files, ...(ctx.rightsCap ? { rightsCap: ctx.rightsCap } : {}), summary: "Changes by the assistant" },
    dependsOn: dependsOnRow,
  });
  await sql.query(`update public.agent_changesets set depends_on = $2 where id = $1`, [h.changesetId, h.dependsOn]);
  await setStatus(sql, h.changesetId, "queued", null, rowId);
  return { status: 202, body: { changesetId: h.changesetId, status: "queued" } };
}

/** `GET /api/agent/changesets/:id`: only this job's (R-9); the queue's outcome is copied into the registry. */
export async function changesetStatus(ctx: AgentCtx, id: string): Promise<Reply> {
  const { rows } = await ctx.sql.query<Registry & { q_status: string | null; q_result: { reason?: string } | null; q_error: string | null }>(
    `select c.id, c.package_id, c.job_id, c.status, c.queue_row_id::text, c.reason, q.status as q_status, q.result as q_result, q.last_error as q_error
       from public.agent_changesets c left join public.write_queue q on q.id = c.queue_row_id
      where c.id = $1 and c.job_id = $2 and c.package_id = $3`,
    [id, ctx.claims.job_id, ctx.claims.package_id],
  );
  const r = rows[0];
  if (!r) return fail(404, "no such changeset in this job");
  let status = r.status, reason = r.reason;
  if (r.status === "queued" && r.q_status && ["done", "refused", "failed", "bounced"].includes(r.q_status)) {
    status = r.q_status === "bounced" ? "refused" : r.q_status;
    reason = r.q_result?.reason ?? r.q_error ?? null;
    await setStatus(ctx.sql, r.id, status, reason);
  }
  return { status: 200, body: { changesetId: r.id, status, ...(reason ? { reason } : {}) } };
}

/** `POST /api/agent/events` (§4.4): closed kinds, ≤ 64 KiB, at most 120 a minute per session; the server numbers them. */
export async function postEvent(ctx: AgentCtx, raw: unknown): Promise<Reply> {
  const e = parseEvent(raw);
  if (!e.ok) return fail(400, e.reason);
  const { rows } = await ctx.sql.query<{ n: number }>(`select count(*)::int as n from public.agent_session_events where session_id = $1 and at > now() - interval '1 minute'`, [ctx.claims.session_id]);
  if ((rows[0]?.n ?? 0) >= 120) return fail(429, "at most 120 events a minute");
  const ins = await ctx.sql.query<{ seq: string }>(
    `insert into public.agent_session_events (session_id, job_id, kind, payload) values ($1, $2, $3, $4::text::jsonb) returning seq::text`,
    [ctx.claims.session_id, ctx.claims.job_id, e.value.kind, JSON.stringify(e.value.payload)],
  );
  return { status: 201, body: { seq: Number(ins.rows[0]!.seq) } };
}

/** May the agent read this file? Everything a member reads, except what only the server holds (source pointers, notes). */
function readable(path: string): boolean {
  return !isServerOnlyPath(path) && !path.startsWith("private/sources/");
}

/**
 * `GET /api/agent/file?path=`: the head's text of a file, with its version; the version is remembered with the
 * commit, so a later hand-in made from it can be combined with others' edits (the committer's merge base).
 */
export async function readFile(ctx: AgentCtx, rawPath: string): Promise<Reply> {
  let path: string;
  try { path = normalizePath(rawPath); } catch { return fail(400, "not a path"); }
  if (!readable(path)) return fail(403, "the assistant can't read this file");
  const course = await courseRepo(ctx.claims.package_id);
  if (!course) return fail(503, "the course's files can't be reached now; try again");
  const head = await course.repo.head();
  if (fileKind(path) !== "text") return fail(415, "not a text file");
  const text = await course.repo.readFile(head, path);
  if (text === null) return fail(404, "no such file");
  const version = sha(text);
  await ctx.sql.query(`insert into public.doc_versions (package_id, path, version, commit_sha) values ($1, $2, $3, $4) on conflict do nothing`, [ctx.claims.package_id, path, version, head]);
  return { status: 200, body: { path, head, version, text } };
}

/**
 * `GET /api/agent/changes?since=<commit>` (R.24, §15 M6): the files changed since a commit of the course's own
 * history (at most 300; more → read the files), and the answers to this session's questions.
 */
export async function catchUp(ctx: AgentCtx, since: string | null): Promise<Reply> {
  const course = await courseRepo(ctx.claims.package_id);
  if (!course) return fail(503, "the course's files can't be reached now; try again");
  const head = await course.repo.head();
  let files: Array<{ path: string; status: string }> | "too-much" = [];
  if (since) {
    if (!/^[0-9a-f]{40}$/.test(since) || !(await course.client.isAncestor({ owner: course.owner, repo: course.name }, since, head))) return fail(400, "since: a commit of this course's history");
    try {
      files = (await course.client.compareCommits({ owner: course.owner, repo: course.name }, since, head)).filter((f) => readable(f.path));
    } catch {
      files = "too-much";
    }
    if (Array.isArray(files) && files.length > 300) files = "too-much";
  }
  const answers = await ctx.sql.query<{ id: string; payload: Record<string, unknown>; answer: unknown; answered_at: string }>(
    `select id::text, payload, answer, answered_at::text from public.needs_you
      where package_id = $1 and kind = 'question' and origin = 'agent' and state = 'answered' and payload->>'sessionId' = $2
      order by answered_at desc limit 50`,
    [ctx.claims.package_id, ctx.claims.session_id],
  );
  return {
    status: 200,
    body: {
      head,
      ...(files === "too-much" ? { tooMuch: "too much changed: read the files" } : { files }),
      answers: answers.rows.map((a) => ({ item: a.id, changesetId: a.payload["changesetId"] ?? null, answer: a.answer, at: a.answered_at })),
    },
  };
}

/** The gateway key for an AI call from a sandbox (§18): opened from the job's sealed copy; never handed to the agent. */
export async function sandboxGatewayKey(req: Request): Promise<string | null> {
  const sql = directDb();
  if (!sql) return null;
  const sb = await sandboxJob(req, sql);
  return sb?.sealed ? openForJob(sb.sealed, sb.claims.job_id, agentKeys()) : null;
}
