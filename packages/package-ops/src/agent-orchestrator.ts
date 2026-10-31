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
import { createHash } from "node:crypto";
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
sudo nft delete table inet alembic_${user} 2>/dev/null || true
sudo nft -f - <<EOF
table inet alembic_${user} {
  chain out {
    type filter hook output priority 0; policy accept;
    meta skuid $U oif lo accept
    meta skuid $U udp dport 53 accept
    meta skuid $U tcp dport 53 accept
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
A=(-s -m 60 -H "x-alembic-sandbox: $ALEMBIC_SANDBOX" -H "x-alembic-job: $ALEMBIC_JOB")
case "$1" in
  read)    curl "\${A[@]}" --get --data-urlencode "path=$2" "$ALEMBIC_HOST/api/agent/file" ;;
  handin)  curl "\${A[@]}" -H "content-type: application/json" --data-binary "@$2" "$ALEMBIC_HOST/api/agent/changesets" ;;
  status)  curl "\${A[@]}" "$ALEMBIC_HOST/api/agent/changesets/$2" ;;
  changes) curl "\${A[@]}" --get --data-urlencode "since=$2" "$ALEMBIC_HOST/api/agent/changes" ;;
  event)   jq -nc --arg k "$2" --arg t "$3" '{kind:$k,payload:{text:$t}}' | curl "\${A[@]}" -H "content-type: application/json" --data-binary @- "$ALEMBIC_HOST/api/agent/events" ;;
  *) echo "usage: alembic read <path> | handin <file.json> | status <changesetId> | changes [<commit>] | event <progress|message|handover-note> <text>"; exit 2 ;;
esac
echo`;

/** What the harness is told about its one tool (a type package adds its own skills, §16). */
export const HARNESS_GUIDE = `You are a course assistant working on one course through the command \`alembic\` (run it with Bash):
- \`alembic read <path>\` prints JSON {path, head, version, text}
- \`alembic handin <file.json>\` hands in a change. The JSON is {"changesetId": "<8-64 chars of A-Za-z0-9_->", "files": [{"path": "...", "baseVersion": "<the version from read>", "text": "<the whole new text>"}]}; build it with jq so the text is escaped.
- \`alembic status <changesetId>\` shows what became of it
- \`alembic event progress "<text>"\` tells the person what you are doing
You never write to the course any other way. Keep each file's header block exactly as it is.
`;

/** Files of a job, written as root and handed to the course user, then the harness started in the background. */
export function launchScript(user: string, job: string, maxMinutes: number): string {
  const dir = `/home/${user}/jobs/${job}`;
  return `set -euo pipefail
D=${dir}
sudo mkdir -p $D
sudo tee $D/run.sh >/dev/null <<'EOF'
#!/bin/bash
cd "$(dirname "$0")"
. "$HOME/.alembic-env"
export ANTHROPIC_BASE_URL="$ALEMBIC_HOST/api/agent/ai" ANTHROPIC_API_KEY=sandbox
export ANTHROPIC_CUSTOM_HEADERS="x-alembic-sandbox: $ALEMBIC_SANDBOX
x-alembic-job: $ALEMBIC_JOB"
export ANTHROPIC_MODEL=claude-sonnet-5 ANTHROPIC_SMALL_FAST_MODEL=claude-haiku-4-5 CLAUDE_CODE_MAX_OUTPUT_TOKENS=8000
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1 CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1
timeout ${Math.round(maxMinutes * 60)} claude -p "$(cat task.txt)" --allowedTools "Bash(alembic:*),Bash(jq:*),Bash(cat:*),Write,Read" --output-format json > result.json 2> harness.err
echo $? > exit.code
EOF
sudo chmod 755 $D/run.sh
. /run/instabox/secrets/env
printf 'export ALEMBIC_SANDBOX=%s\\nexport ALEMBIC_JOB=%s\\nexport ALEMBIC_HOST=%s\\n' "$ALEMBIC_SANDBOX_KEY" ${q(job)} "$ALEMBIC_HOST_URL" | sudo tee /home/${user}/.alembic-env >/dev/null
sudo chmod 600 /home/${user}/.alembic-env
sudo chown -R ${user}:${user} /home/${user}
sudo -u ${user} -H setsid nohup bash $D/run.sh >/dev/null 2>&1 < /dev/null &
echo started`;
}

type JobRow = { id: string; session_id: string; package_id: string; invoker_id: string; task: string; budget_credits: string; payer: string; started_at: string; ai_job_id: string | null; course_user: string | null };

async function finishJob(c: OrchestratorConfig, j: Pick<JobRow, "id" | "session_id" | "ai_job_id">, status: "done" | "failed" | "cancelled", summary: string, note?: Record<string, unknown>): Promise<void> {
  const { sql } = c;
  if (note) {
    const text = JSON.stringify(note);
    await sql.query(`insert into public.agent_session_events (session_id, job_id, kind, payload) values ($1, $2, 'handover-note', $3::text::jsonb)`,
      [j.session_id, j.id, text.length > 60_000 ? JSON.stringify({ ...note, result: String(note["result"] ?? "").slice(0, 50_000) }) : text]);
  }
  if (j.ai_job_id) {
    await sql.query(`select public.gateway_revoke_job($1::uuid)`, [j.ai_job_id]);
    await sql.query(`update public.ai_jobs set status = 'done' where id = $1::uuid and status = 'running'`, [j.ai_job_id]);
    await sql.query(`select public.ledger_release($1::uuid) where exists (select 1 from public.holds where job_id = $1::uuid and status = 'open')`, [j.ai_job_id]);
  }
  await sql.query(
    `update public.agent_jobs set status = $2, summary = $3, ended_at = now(), gateway_key_sealed = null,
            spent_credits = coalesce((select captured from public.holds h where h.job_id = agent_jobs.ai_job_id), 0)
      where id = $1`, [j.id, status, summary.slice(0, 4000)]);
  await sql.query(`update public.agent_sessions set state = 'idle', updated_at = now() where id = $1 and state = 'running'`, [j.session_id]);
}

/** Claim and start one waiting job, if the sandbox has room. */
async function startOne(c: OrchestratorConfig): Promise<string | null> {
  const { sql, sandbox } = c;
  const claimed = await sql.query<JobRow>(
    `with room as (
       select b.max_jobs - (select count(*) from public.agent_jobs j join public.agent_sessions s on s.id = j.session_id
                             where j.status = 'running' and s.sandbox_ref = b.ref) as free
         from public.agent_sandboxes b where b.ref = $1 and b.retired_at is null)
     update public.agent_jobs j set status = 'running'
      where j.id = (select j2.id from public.agent_jobs j2 join public.agent_sessions s2 on s2.id = j2.session_id
                     where j2.status = 'starting' and (s2.sandbox_ref is null or s2.sandbox_ref = $1)
                       and (select free from room) > 0
                     order by j2.started_at limit 1 for update of j2 skip locked)
      returning j.id, j.session_id, j.package_id, j.invoker_id::text, j.task, j.budget_credits::text, j.payer, j.started_at::text, j.ai_job_id::text, j.course_user`,
    [sandbox.ref],
  );
  const j = claimed.rows[0];
  if (!j) return null;
  try {
    await sql.query(`update public.agent_sessions set sandbox_ref = $2, state = 'running', updated_at = now() where id = $1`, [j.session_id, sandbox.ref]);
    if (j.payer !== "invoker") throw new Error("automatic jobs paid by the course come later");
    const acct = (await sql.query<{ a: string }>(`select public.ledger_user_account($1::uuid)::text as a`, [j.invoker_id])).rows[0]!.a;
    const ai = (await sql.query<{ id: string }>(
      `insert into public.ai_jobs (package_id, payer_account_id, invoker_id, kind) values ($1, $2::uuid, $3::uuid, 'request') returning id::text`,
      [j.package_id, acct, j.invoker_id])).rows[0]!.id;
    await sql.query(`update public.agent_jobs set ai_job_id = $2::uuid where id = $1`, [j.id, ai]);
    j.ai_job_id = ai;
    await sql.query(`select public.ledger_hold($1::uuid, $2::uuid, $3::numeric)`, [j.invoker_id, ai, j.budget_credits]);
    const key = c.keys[0]!;
    const gw = await mintGatewayKey(sql, ai, c.models, (c.maxMinutes ?? 30) + 10);
    const user = courseUser(j.package_id);
    await sql.query(`update public.agent_jobs set gateway_key_sealed = $2, course_user = $3, signing_kid = $4 where id = $1`, [j.id, sealForJob(gw, j.id, key), user, key.kid]);
    const prep = await sandbox.exec({ cmd: prepareScript(user, c.host), timeoutSeconds: 300 });
    if (prep.exitCode !== 0) throw new Error(`the sandbox could not be prepared (${prep.stderr.slice(-300)})`);
    const files = await sandbox.exec({ cmd: `sudo mkdir -p /home/${user}/jobs/${j.id} && sudo tee /home/${user}/jobs/${j.id}/task.txt >/dev/null && sudo tee /home/${user}/jobs/${j.id}/CLAUDE.md >/dev/null <<'EOF'\n${HARNESS_GUIDE}EOF`, stdin: j.task, timeoutSeconds: 60 });
    if (files.exitCode !== 0) throw new Error("the job's files could not be written");
    const run = await sandbox.exec({ cmd: `export ALEMBIC_HOST_URL=${q(c.host)}\n${launchScript(user, j.id, c.maxMinutes ?? 30)}`, timeoutSeconds: 120 });
    if (run.exitCode !== 0 || !run.stdout.includes("started")) throw new Error(`the assistant could not be started (${run.stderr.slice(-300)})`);
    await sql.query(`insert into public.agent_session_events (session_id, job_id, kind, payload) values ($1, $2, 'progress', '{"text":"The assistant started."}'::jsonb)`, [j.session_id, j.id]);
    c.log?.(`agent job ${j.id} started for ${j.package_id}`);
    return j.id;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    c.log?.(`agent job ${j.id} failed to start: ${why}`);
    await finishJob(c, j, "failed", /credit/i.test(why) ? "Not enough credit for this job." : `Couldn't start: ${why}`.slice(0, 500));
    return null;
  }
}

/** Look at the jobs running in this sandbox: record finished ones, stop overdue ones. */
async function checkRunning(c: OrchestratorConfig): Promise<number> {
  const { sql, sandbox } = c;
  const running = await sql.query<JobRow & { minutes: number; status: string }>(
    `select j.id, j.session_id, j.package_id, j.ai_job_id::text, j.course_user, j.status, extract(epoch from now() - j.started_at) / 60 as minutes
       from public.agent_jobs j join public.agent_sessions s on s.id = j.session_id
      where s.sandbox_ref = $1 and j.course_user is not null
        and (j.status = 'running' or (j.status = 'cancelled' and j.ended_at is null))`,
    [sandbox.ref],
  );
  let finished = 0;
  for (const j of running.rows) {
    if (j.status === "cancelled") {
      // Stopped by a person: every endpoint already refuses it; end its process and settle its credit.
      await sandbox.exec({ cmd: `sudo pkill -u ${j.course_user} || true`, timeoutSeconds: 30 });
      await finishJob(c, j, "cancelled", "Stopped by a person.");
      finished++;
      continue;
    }
    const dir = `/home/${j.course_user}/jobs/${j.id}`;
    const look = await sandbox.exec({ cmd: `sudo cat ${dir}/exit.code 2>/dev/null || echo running; echo ---; sudo head -c 200000 ${dir}/result.json 2>/dev/null; echo; echo ---; sudo tail -c 2000 ${dir}/harness.err 2>/dev/null`, timeoutSeconds: 60 });
    const [code, result, err] = look.stdout.split("\n---\n");
    if ((code ?? "").trim() === "running") {
      if (Number(j.minutes) > (c.maxMinutes ?? 30) + 5) {
        await sandbox.exec({ cmd: `sudo pkill -u ${j.course_user} || true`, timeoutSeconds: 30 });
        await finishJob(c, j, "failed", "Stopped: the job ran past its time limit.");
        finished++;
      }
      continue;
    }
    let parsed: { result?: string; is_error?: boolean; num_turns?: number; total_cost_usd?: number } = {};
    try { parsed = JSON.parse((result ?? "").trim() || "{}"); } catch { /* the harness wrote no result */ }
    const ok = (code ?? "").trim() === "0" && parsed.is_error !== true;
    await finishJob(c, j, ok ? "done" : "failed", ok ? (parsed.result ?? "Done.") : `The assistant stopped: ${(parsed.result ?? err ?? "").toString().slice(0, 400)}`,
      { result: parsed.result ?? null, turns: parsed.num_turns ?? null, exit: (code ?? "").trim() });
    c.log?.(`agent job ${j.id} ${ok ? "done" : "failed"}`);
    finished++;
  }
  return finished;
}

/** One pass of the orchestrator. */
export async function orchestratorPass(c: OrchestratorConfig): Promise<{ started: string | null; finished: number }> {
  const finished = await checkRunning(c);
  const started = await startOne(c);
  return { started, finished };
}
