/**
 * Sealing a job's gateway key for the server's own later use (agent-runtime-v3 §18): AES-256-GCM under a key derived
 * (HKDF-SHA256) from the agent signing key, with the job id as associated data, so a sealed key opens only for its
 * own job. The agent never holds it: the AI pass-through opens it and puts it into the call.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import type { AgentKey } from "./agent-token";

const sealKey = (k: AgentKey) => Buffer.from(hkdfSync("sha256", k.secret, Buffer.from(k.kid), "alembic agent gateway-key seal v1", 32));

/** `v1.<kid>.<iv>.<ciphertext+tag>` (base64url). */
export function sealForJob(value: string, jobId: string, key: AgentKey): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", sealKey(key), iv);
  c.setAAD(Buffer.from(jobId));
  const out = Buffer.concat([c.update(value, "utf8"), c.final(), c.getAuthTag()]);
  return `v1.${key.kid}.${iv.toString("base64url")}.${out.toString("base64url")}`;
}

/** The sealed value, or null if it isn't one of ours for this job (wrong job, key, or tampered). */
export function openForJob(sealed: string, jobId: string, keys: readonly AgentKey[]): string | null {
  const m = /^v1\.([A-Za-z0-9_-]{1,100})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{24,})$/.exec(sealed);
  if (!m) return null;
  const key = keys.find((k) => k.kid === m[1]);
  if (!key) return null;
  try {
    const data = Buffer.from(m[3]!, "base64url");
    const d = createDecipheriv("aes-256-gcm", sealKey(key), Buffer.from(m[2]!, "base64url"));
    d.setAAD(Buffer.from(jobId));
    d.setAuthTag(data.subarray(data.length - 16));
    return Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** sha256 of a sandbox key, as agent_sandboxes stores it. */
export const sandboxKeyHash = (key: string) => createHash("sha256").update(key, "utf8").digest("hex");
