/**
 * The agent orchestrator's pass (C4 step 3b) with instabox as the sandbox (testing; production: Fly, §16). Commands
 * go through instabox's REST API with an API key that can only run commands in the sandbox (machines:*); the
 * sandbox's own key for Alembic is an instabox Secret the worker never sees.
 */
import { orchestratorPass, type AgentKey, type SandboxExec, type SqlClient } from "@alembic/package-ops";

export function instaboxSandbox(apiKey: string, machineId: string, base = "https://api.instabox.sh"): SandboxExec {
  const call = async (path: string, body: unknown, timeoutMs: number) => {
    const r = await fetch(`${base}/v1/machines/${machineId}${path}`, {
      method: "POST", headers: { "x-api-key": apiKey, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`instabox ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json() as Promise<Record<string, unknown>>;
  };
  return {
    ref: `instabox:${machineId}`,
    async exec({ cmd, stdin, timeoutSeconds = 60 }) {
      await call("/wake", {}, 60_000).catch(() => {}); // an idle-paused sandbox comes back first
      const t = Math.min(Math.max(timeoutSeconds, 1), 600);
      const r = await call("/exec", { cmd, ...(stdin !== undefined ? { stdin } : {}), timeoutSeconds: t, noHistory: true }, (t + 30) * 1000);
      return { exitCode: Number(r["exitCode"] ?? 1), stdout: String(r["stdout"] ?? ""), stderr: String(r["stderr"] ?? "") };
    },
  };
}

export function agentKeysFromEnv(v: string | undefined): AgentKey[] {
  return (v ?? "").split(",").map((p) => p.trim()).filter(Boolean).flatMap((p) => {
    const at = p.indexOf(":");
    const secret = at > 0 ? Buffer.from(p.slice(at + 1), "base64") : Buffer.alloc(0);
    return secret.length >= 32 ? [{ kid: p.slice(0, at), secret: new Uint8Array(secret) }] : [];
  });
}

export async function agentPass(d: { sql: SqlClient; sandbox: SandboxExec; keys: AgentKey[]; host: string; log: (m: string) => void }): Promise<void> {
  await orchestratorPass({ sql: d.sql, sandbox: d.sandbox, keys: d.keys, host: d.host, models: ["claude-sonnet-5", "claude-haiku-4-5"], maxMinutes: 30, log: d.log });
}
