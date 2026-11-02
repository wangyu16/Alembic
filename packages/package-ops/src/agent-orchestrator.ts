/**
 * The agent job orchestrator (agent-runtime-v3 §1, §16–§18; C4 step 3b). One pass, stateless (a restarted worker
 * picks up where it was): start one waiting job if the sandbox has room, then look at every job running in it.
 *
 * Starting a job: its ledger job and hold (the estimate), a gateway key (sealed for the server; the agent never holds
 * it), the course's own Linux user in the sandbox (home 700, outbound only to the Alembic host), the harness's files,
 * and the harness started in the background under a time limit. Looking at a job: when the harness has finished, its
 * result becomes the job's hand-over note, the key is revoked and the hold released; past the time limit it is
 * stopped. The harness is a type package's command (§16); the first one is Claude Code headless.
 */
import { createHash, randomBytes } from "node:crypto";
import { mintGatewayKey } from "./gateway-keys";
import { sealForJob } from "./agent-seal";
import type { AgentKey } from "./agent-token";
import type { SqlClient } from "./sql-queue-store";

/** A command in the sandbox, run by its login user (who has sudo). */
export interface SandboxExec {
  ref: string;
  exec(i: { cmd: string; stdin?: string; timeoutSeconds?: number }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface OrchestratorConfig {
  sql: SqlClient;
  sandbox: SandboxExec;
  keys: AgentKey[];
  /** e.g. https://alembic-test.orz.how */
  host: string;
  /** The harness's models (the gateway key allows only these). */
  models: string[];
  /** Wall-clock limit per job. */
  maxMinutes?: number;
  /** This worker (the sandbox lease: one worker acts on a sandbox at a time). */
  holder?: string;
  log?: (m: string) => void;
}

/** The course's Linux user: stable per course, a valid name. */
export const courseUser = (packageId: string) => `c${createHash("sha256").update(packageId).digest("hex").slice(0, 12)}`;
const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

/** Root setup of a course user (idempotent): the user, its home, its egress rule (DNS + the host's addresses on 443). */
export function prepareScript(user: string, host: string): string {
  const name = new URL(host).hostname;
  return `set -euo pipefail
id ${user} >/dev/null 2>&1 || sudo useradd -m -s /bin/bash ${user}
sudo chmod 700 /home/${user}
command -v nft >/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nftables jq >/dev/null
IPS=$(getent ahostsv4 ${q(name)} | awk '{print $1}' | sort -u | paste -sd, -)
[ -n "$IPS" ] || { echo "cannot resolve ${name}" >&2; exit 3; }
U=$(id -u ${user})
# DNS only to the sandbox's own resolvers (a resolver on loopback is covered by the loopback rule).
NS=$(awk '/^nameserver/{print $2}' /etc/resolv.conf | grep -E '^[0-9]+(\.[0-9]+){3}$' | grep -v '^127\.' | sort -u | paste -sd, -)
[ -n "$NS" ] || NS=127.0.0.53
# Users can't see each other's processes (attack round 2, H1: arguments and environments).
grep -qE '\bhidepid=(2|invisible)\b' /proc/mounts || sudo mount -o remount,hidepid=2 /proc
# The rule is replaced in one step: the user is never without one (attack round 2, L5).
sudo nft -f - <<EOF
table inet alembic_${user}
delete table inet alembic_${user}
table inet alembic_${user} {
  chain out {
    type filter hook output priority 0; policy accept;
    meta skuid $U oif lo udp dport 53 accept
    meta skuid $U oif lo tcp dport 53 accept
    meta skuid $U ip daddr { $NS } udp dport 53 accept
    meta skuid $U ip daddr { $NS } tcp dport 53 accept
    meta skuid $U ip daddr { $IPS } tcp dport 443 accept
    meta skuid $U counter drop
  }
}
EOF
sudo tee /usr/local/bin/alembic >/dev/null <<'EOF'
${HELPER}
EOF
sudo chmod 755 /usr/local/bin/alembic
echo ok`;
}

/** The course assistant's one way to Alembic (every request carries the sandbox key placeholder and the job). */
const HELPER = `#!/bin/bash
. "$HOME/.alembic-env"
# The job's headers come from a mode-600 file, never a command line (attack round 2, H1).
A=(-s -m 60 -K "$HOME/.alembic-curl")
case "$1" in
  read)    curl "\${A[@]}" --get --data-urlencode "path=$2" "$ALEMBIC_HOST/api/agent/file" ;;
  handin)  curl "\${A[@]}" -H "content-type: application/json" --data-binary "@$2" "$ALEMBIC_HOST/api/agent/changesets" ;;
  figure)  jq -nc --arg id "$2" --arg p "$3" --rawfile c <(base64 -w0 "$4") '{changesetId:$id,files:[{path:$p,encoding:"base64",content:$c}]}' | curl "\${A[@]}" -H "content-type: application/json" --data-binary @- "$ALEMBIC_HOST/api/agent/changesets" ;;
  status)  curl "\${A[@]}" "$ALEMBIC_HOST/api/agent/changesets/$2" ;;
  changes) curl "\${A[@]}" --get --data-urlencode "since=$2" "$ALEMBIC_HOST/api/agent/changes" ;;
  event)   jq -nc --arg k "$2" --arg t "$3" '{kind:$k,payload:{text:$t}}' | curl "\${A[@]}" -H "content-type: application/json" --data-binary @- "$ALEMBIC_HOST/api/agent/events" ;;
  *) echo "usage: alembic read <path> | handin <file.json> | figure <changesetId> <path> <file> | status <changesetId> | changes [<commit>] | event <progress|message|handover-note> <text>"; exit 2 ;;
esac
echo`;

/** What the harness is told about its one tool (a type package adds its own skills, §16). */
export const HARNESS_GUIDE = `You are a course assistant working on one course through the command \`alembic\` (run it with Bash):
- \`alembic read <path>\` prints JSON {path, head, version, text}
- \`alembic handin <file.json>\` hands in a change. The JSON is {"changesetId": "<8-64 chars of A-Za-z0-9_->", "files": [{"path": "...", "baseVersion": "<the version from read>", "text": "<the whole new text>"}]}; build it with jq so the text is escaped.
- \`alembic figure <changesetId> <course path> <local file>\` adds a picture (PNG, JPEG, GIF, WebP or a safe SVG; at most 4 MB) at that path, e.g. assets/<chapter>/figure.png; then refer to it from the page as usual
- \`alembic status <changesetId>\` shows what became of it
- \`alembic event progress "<text>"\` tells the person what you are doing
You never write to the course any other way. Keep each file's header block exactly as it is.
End with one or two plain sentences for the teacher who asked: what you changed, and in which page or chapter. Never mention changesets, statuses, versions, files' JSON or commands; the teacher sees your last message as the result.
`;

/** End everything a course user runs or has scheduled (attack round H1: nothing outlives its job). */
// Schedules first (nothing can start again), then kill(-1) as the user: the kernel signals all of that user's processes at
// once, so a process that keeps forking can't slip between listing and signalling (round 3, H1). If anything is left, it
// fails: a launch never goes on beside a survivor. The user's files outside its home go too (round 3, M1).
export const killScript = (user: string) => `sudo crontab -r -u ${user} 2>/dev/null || true; for a in $(sudo -u ${user} atq 2>/dev/null | awk '{print $1}'); do sudo atrm "$a"; done 2>/dev/null || true
for i in 1 2 3 4 5; do sudo -u ${user} /bin/bash -c 'kill -9 -1' 2>/dev/null || true; sudo pgrep -u ${user} >/dev/null || break; sleep 0.5; done
if sudo pgrep -u ${user} >/dev/null; then echo "processes of ${user} are still running" >&2; exit 4; fi
sudo find /tmp /var/tmp /dev/shm -xdev -user ${user} -delete 2>/dev/null || true`;

/**
 * A job's workspace and launch (attack round H1, H2, M2). Root never writes into the course user's home through a
 * path the user controls: it removes the old job folder and settings file (rm doesn't follow links), creates them
 * fresh, and everything inside is written AS the course user. The settings file (mode 600) holds the sandbox key's
 * placeholder, the job id and the job's own secret; another course user can't read it (home 700). The task reaches
 * the harness on stdin, never on a command line.
 */
export function launchScript(user: string, job: string, maxMinutes: number): string {
  const home = `/home/${user}`;
  const dir = `${home}/jobs/${job}`;
  const asUser = `sudo -u ${user} -H`;
  return `set -euo pipefail
${killScript(user)}
# A fresh home for every job: nothing a previous job left (settings, hooks, files) runs in this one (attack round 2, H2).
sudo find ${home} -mindepth 1 -delete
sudo chown ${user}:${user} ${home} && sudo chmod 700 ${home}
# Created by the user, never by root (round 3, H1: root following a link the user raced in).
${asUser} mkdir -m 700 ${home}/jobs ${dir} ${home}/tmp
. /run/instabox/secrets/env
# The job's secret arrives as the first line of stdin, the task after it: never in a command (attack round 2, H1).
IFS= read -r ALEMBIC_JOB_SECRET_VALUE
printf 'export ALEMBIC_SANDBOX=%s\\nexport ALEMBIC_JOB=%s\\nexport ALEMBIC_JOB_SECRET=%s\\nexport ALEMBIC_HOST=%s\\n' "$ALEMBIC_SANDBOX_KEY" ${q(job)} "$ALEMBIC_JOB_SECRET_VALUE" "$ALEMBIC_HOST_URL" | ${asUser} sh -c 'umask 077; cat > ${home}/.alembic-env'
printf 'header = "x-alembic-sandbox: %s"\\nheader = "x-alembic-job: %s"\\nheader = "x-alembic-job-secret: %s"\\n' "$ALEMBIC_SANDBOX_KEY" ${q(job)} "$ALEMBIC_JOB_SECRET_VALUE" | ${asUser} sh -c 'umask 077; cat > ${home}/.alembic-curl'
unset ALEMBIC_JOB_SECRET_VALUE
${asUser} tee ${dir}/task.txt >/dev/null
${asUser} sh -c 'cat > ${dir}/CLAUDE.md' <<'GUIDE_EOF'
${HARNESS_GUIDE}GUIDE_EOF
${asUser} sh -c 'cat > ${dir}/run.sh' <<'RUN_EOF'
#!/bin/bash
cd "$(dirname "$0")"
# Hard limits the user can't raise: processes, file size (round 3, M2, M1).
ulimit -Hu 512 -Su 512; ulimit -Hf 2097152 -Sf 2097152
export TMPDIR="$HOME/tmp"
. "$HOME/.alembic-env"
export ANTHROPIC_BASE_URL="$ALEMBIC_HOST/api/agent/ai" ANTHROPIC_API_KEY=sandbox
export ANTHROPIC_CUSTOM_HEADERS="x-alembic-sandbox: $ALEMBIC_SANDBOX
x-alembic-job: $ALEMBIC_JOB
x-alembic-job-secret: $ALEMBIC_JOB_SECRET"
# Models (owner, 2026-11-02): Haiku 5.5 by default; Sonnet 5.5 allowed when a task needs it (\`--model claude-sonnet-5-5\`).
export ANTHROPIC_MODEL=claude-haiku-5-5 ANTHROPIC_SMALL_FAST_MODEL=claude-haiku-5-5 CLAUDE_CODE_MAX_OUTPUT_TOKENS=8000
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1 CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1
timeout ${Math.round(maxMinutes * 60)} claude -p --allowedTools "Bash(alembic:*),Bash(jq:*),Bash(cat:*),Write,Read" --output-format json < task.txt > result.json 2> harness.err
echo $? > exit.code
RUN_EOF
${asUser} chmod 700 ${dir}/run.sh
${asUser} setsid nohup bash ${dir}/run.sh >/dev/null 2>&1 < /dev/null &
echo started`;
}

type JobRow = { id: string; session_id: string; package_id: string; invoker_id: string; task: string; budget_credits: string; payer: string; started_at: string; ai_job_id: string | null; course_user: string | null };

/** Plain sentences for the person (attack round L5); the details go to the worker's log only. */
const PLAIN = {
  credit: "Not enough credit for this job.",
  start: "The assistant couldn't start this time. Please try again in a few minutes.",
  stopped: "Stopped by a person.",
  overdue: "Stopped: the job ran past its time limit.",
  failed: "The assistant stopped before it finished. What it already handed in is saved.",
  removed: "Stopped: the person who asked can no longer edit this course.",
  lost: "The assistant couldn't start this time. Please try again in a few minutes.",
};

/**
 * End a job. The key is revoked at once (no further AI call can start); the hold is released later, by `settle`,
 * after any call already in flight has been charged (attack round M4: an early release turned that call into debt).
 */
async function finishJob(c: OrchestratorConfig, j: Pick<JobRow, "id" | "session_id" | "ai_job_id">, status: "done" | "failed" | "cancelled", summary: string, note?: Record<string, unknown>): Promise<void> {
  const { sql } = c;
  if (note) {
    const text = JSON.stringify(note);
    await sql.query(`insert into public.agent_session_events (session_id, job_id, kind, payload) values ($1, $2, 'handover-note', $3::text::jsonb)`,
      [j.session_id, j.id, text.length > 60_000 ? JSON.stringify({ ...note, result: String(note["result"] ?? "").slice(0, 50_000) }) : text]);
  }
  if (j.ai_job_id) await sql.query(`select public.gateway_revoke_job($1::uuid)`, [j.ai_job_id]);
  await sql.query(
    `update public.agent_jobs set status = $2, summary = $3, ended_at = now(), gateway_key_sealed = null, job_secret_hash = null where id = $1`,
    [j.id, status, summary.slice(0, 4000)]);
  await sql.query(`update public.agent_sessions set state = 'idle', updated_at = now() where id = $1 and state = 'running'`, [j.session_id]);
}

/** Release the holds of ended jobs once no call can still be running (the gateway's longest call is 10 minutes). */
async function settle(c: OrchestratorConfig): Promise<void> {
  const { sql } = c;
  const due = await sql.query<{ id: string; ai_job_id: string | null }>(
    `select id, ai_job_id::text from public.agent_jobs
      where status in ('done', 'failed', 'cancelled') and settled_at is null and ended_at < now() - interval '11 minutes' limit 20`);
  for (const j of due.rows) {
    if (j.ai_job_id) {
      await sql.query(`update public.ai_jobs set status = 'done' where id = $1::uuid and status = 'running'`, [j.ai_job_id]);
      await sql.query(`select public.ledger_release($1::uuid) where exists (select 1 from public.holds where job_id = $1::uuid and status = 'open')`, [j.ai_job_id]);
    }
    await sql.query(`update public.agent_jobs set settled_at = now(), spent_credits = coalesce((select captured from public.holds h where h.job_id = agent_jobs.ai_job_id), 0) where id = $1`, [j.id]);
  }
}

/** Claim and start one waiting job, if the sandbox has room. */
async function startOne(c: OrchestratorConfig): Promise<string | null> {
  const { sql, sandbox } = c;
  // The time limit runs from the start, not from the wait in the queue (attack round M1).
  const claimed = await sql.query<JobRow>(
    `with room as (
       select b.max_jobs - (select count(*) from public.agent_jobs j join public.agent_sessions s on s.id = j.session_id
                             where j.status = 'running' and s.sandbox_ref = b.ref) as free
         from public.agent_sandboxes b where b.ref = $1 and b.retired_at is null)
     , claimed as (
     update public.agent_jobs j set status = 'running', started_at = now()
      where j.id = (select j2.id from public.agent_jobs j2 join public.agent_sessions s2 on s2.id = j2.session_id
                     where j2.status = 'starting' and (s2.sandbox_ref is null or s2.sandbox_ref = $1)
                       and s2.state not like 'paused%'
                       and (select free from room) > 0
                     order by j2.started_at limit 1 for update of j2 skip locked)
      returning j.id, j.session_id, j.package_id, j.invoker_id::text, j.task, j.budget_credits::text, j.payer, j.started_at::text, j.ai_job_id::text, j.course_user)
     -- The session's sandbox is set in the same statement: a crash can't leave a claim recovery doesn't see (round 2, M1).
     , sess as (update public.agent_sessions s set sandbox_ref = $1, updated_at = now(),
                        state = case when s.state like 'paused%' then s.state else 'running' end
                 from claimed where s.id = claimed.session_id returning s.id)
     select * from claimed`,
    [sandbox.ref],
  );
  const j = claimed.rows[0];
  if (!j) return null;
  try {
    if (j.payer !== "invoker") throw Object.assign(new Error("automatic jobs paid by the course come later"), { plain: PLAIN.start });
    const role = (await sql.query<{ r: string | null }>(`select public.course_role_of($1, $2::uuid) as r`, [j.package_id, j.invoker_id])).rows[0]?.r;
    if (role !== "owner" && role !== "deputy" && role !== "co-author") throw Object.assign(new Error("the asker is no longer an editor"), { plain: PLAIN.removed });
    const acct = (await sql.query<{ a: string }>(`select public.ledger_user_account($1::uuid)::text as a`, [j.invoker_id])).rows[0]!.a;
    const ai = (await sql.query<{ id: string }>(
      `insert into public.ai_jobs (package_id, payer_account_id, invoker_id, kind) values ($1, $2::uuid, $3::uuid, 'request') returning id::text`,
      [j.package_id, acct, j.invoker_id])).rows[0]!.id;
    const user = courseUser(j.package_id);
    await sql.query(`update public.agent_jobs set ai_job_id = $2::uuid, course_user = $3 where id = $1`, [j.id, ai, user]);
    j.ai_job_id = ai;
    await sql.query(`select public.ledger_hold($1::uuid, $2::uuid, $3::numeric)`, [j.invoker_id, ai, j.budget_credits]);
    const key = c.keys[0]!;
    const gw = await mintGatewayKey(sql, ai, c.models, (c.maxMinutes ?? 30) + 10);
    const secret = randomBytes(32).toString("base64url");
    await sql.query(`update public.agent_jobs set gateway_key_sealed = $2, signing_kid = $3, job_secret_hash = $4 where id = $1`,
      [j.id, sealForJob(gw, j.id, key), key.kid, createHash("sha256").update(secret).digest("hex")]);
    const prep = await sandbox.exec({ cmd: prepareScript(user, c.host), timeoutSeconds: 300 });
    if (prep.exitCode !== 0) throw new Error(`prepare: ${prep.stderr.slice(-300)}`);
    // The task arrives on stdin; the script reads it into the user's task file (never on a command line).
    const script = launchScript(user, j.id, c.maxMinutes ?? 30);
    const run = await sandbox.exec({ cmd: `export ALEMBIC_HOST_URL=${q(c.host)}\n${script}`, stdin: `${secret}\n${j.task}`, timeoutSeconds: 120 });
    if (run.exitCode !== 0 || !run.stdout.includes("started")) throw new Error(`launch: ${run.stderr.slice(-300)}`);
    await sql.query(`insert into public.agent_session_events (session_id, job_id, kind, payload) values ($1, $2, 'progress', '{"text":"The assistant started."}'::jsonb)`, [j.session_id, j.id]);
    c.log?.(`agent job ${j.id} started for ${j.package_id}`);
    return j.id;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    c.log?.(`agent job ${j.id} failed to start: ${why}`);
    const plain = (e as { plain?: string }).plain ?? (/credit|balance/i.test(why) ? PLAIN.credit : PLAIN.start);
    // Whatever the launch may have started ends too (round 2, L5).
    await sandbox.exec({ cmd: killScript(courseUser(j.package_id)), timeoutSeconds: 60 }).catch(() => {});
    await finishJob(c, j, "failed", plain);
    return null;
  }
}

/** Look at the jobs of this sandbox: settle stopped ones, record finished ones, stop overdue or orphaned ones. */
async function checkRunning(c: OrchestratorConfig): Promise<number> {
  const { sql, sandbox } = c;
  const running = await sql.query<JobRow & { minutes: number; status: string; role: string | null }>(
    `select j.id, j.session_id, j.package_id, j.ai_job_id::text, j.course_user, j.status, extract(epoch from now() - j.started_at) / 60 as minutes,
            public.course_role_of(j.package_id, j.invoker_id) as role
       from public.agent_jobs j join public.agent_sessions s on s.id = j.session_id
      where (s.sandbox_ref = $1 or s.sandbox_ref is null) and (j.status = 'running' or (j.status = 'cancelled' and j.ended_at is null))`,
    [sandbox.ref],
  );
  let finished = 0;
  for (const j of running.rows) {
    // A claim that never got its sandbox user (a crash or a database error mid-start): failed after 5 minutes, so it
    // never holds the sandbox for every course (attack round H3).
    if (!j.course_user) {
      if (j.status === "cancelled" || Number(j.minutes) > 5) { await finishJob(c, j, j.status === "cancelled" ? "cancelled" : "failed", j.status === "cancelled" ? PLAIN.stopped : PLAIN.lost); finished++; }
      continue;
    }
    const end = async (status: "done" | "failed" | "cancelled", summary: string, note?: Record<string, unknown>) => {
      // Nothing outlives its job (H1): its processes, schedules, temporary files and home (round 3, M1).
      await sandbox.exec({ cmd: `set -e\n${killScript(j.course_user!)}\nsudo find /home/${j.course_user} -mindepth 1 -delete`, timeoutSeconds: 60 });
      await finishJob(c, j, status, summary, note);
      finished++;
    };
    try {
    if (j.status === "cancelled") { await end("cancelled", PLAIN.stopped); continue; }
    if (j.role !== "owner" && j.role !== "deputy" && j.role !== "co-author") { await end("cancelled", PLAIN.removed); continue; }
    // Past its time limit, a job ends whatever its files say (round 2, H1: a file that never reads can't keep it alive).
    if (Number(j.minutes) > (c.maxMinutes ?? 30) + 5) { await end("failed", PLAIN.overdue); continue; }
    const dir = `/home/${j.course_user}/jobs/${j.id}`;
    // Only regular files, read with a time limit, as the user (never through a link, a pipe or a device).
    const read = (f: string, how: string) => `timeout 10 sudo -u ${j.course_user} sh -c '[ -f ${dir}/${f} ] && [ ! -L ${dir}/${f} ] && ${how} ${dir}/${f} < /dev/null' 2>/dev/null`;
    const look = await sandbox.exec({ cmd: `echo BEGIN; ${read("exit.code", "head -c 16")} || echo running; echo ---; ${read("result.json", "head -c 200000")}; echo; echo ---; ${read("harness.err", "tail -c 2000")}; echo; echo END`, timeoutSeconds: 60 });
    // A check that didn't come back whole tells nothing (attack round L8): look again next pass.
    if (look.exitCode !== 0 || !look.stdout.startsWith("BEGIN\n") || !look.stdout.trimEnd().endsWith("END")) continue;
    const [code, result, err] = look.stdout.slice(6).split("\n---\n");
    if ((code ?? "").trim() === "running") continue;
    let parsed: { result?: string; is_error?: boolean; num_turns?: number; subtype?: string } = {};
    try { parsed = JSON.parse((result ?? "").trim() || "{}"); } catch { /* the harness wrote no result */ }
    const ok = (code ?? "").trim() === "0" && parsed.is_error !== true && typeof parsed.result === "string";
    if (!ok) c.log?.(`agent job ${j.id} failed: exit ${(code ?? "").trim()} ${JSON.stringify({ subtype: parsed.subtype ?? null, result: (parsed.result ?? "").slice(0, 300), turns: parsed.num_turns ?? null })} ${(err ?? "").slice(-300)}`);
    await end(ok ? "done" : "failed", ok ? parsed.result!.slice(0, 4000) : PLAIN.failed, { result: ok ? parsed.result : null, turns: parsed.num_turns ?? null });
    c.log?.(`agent job ${j.id} ${ok ? "done" : "failed"}`);
    } catch (e) {
      // One job's sandbox trouble never stops the pass for the others (round 2, H1).
      c.log?.(`agent job ${j.id}: check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return finished;
}

/** One worker acts on a sandbox at a time (attack round L1): a 15-minute lease (longer than a pass), renewed each pass; a worker that dies frees it when it runs out. */
async function lease(c: OrchestratorConfig): Promise<boolean> {
  if (!c.holder) throw new Error("the orchestrator needs this worker's own name (holder)");
  const holder = c.holder;
  const r = await c.sql.query<{ ref: string }>(
    `update public.agent_sandboxes set lease_holder = $2, lease_until = now() + interval '15 minutes'
      where ref = $1 and (lease_until is null or lease_until < now() or lease_holder = $2) returning ref`,
    [c.sandbox.ref, holder]);
  return r.rows.length > 0;
}

/** One pass of the orchestrator. */
export async function orchestratorPass(c: OrchestratorConfig): Promise<{ started: string | null; finished: number }> {
  if (!(await lease(c))) return { started: null, finished: 0 };
  const finished = await checkRunning(c);
  await settle(c);
  const started = await startOne(c);
  return { started, finished };
}
