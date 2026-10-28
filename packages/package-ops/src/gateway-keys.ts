/**
 * Mint an AI gateway key for one job (C2): a random token for the caller,
 * only its sha256 stored. The gateway accepts it while the job runs and its
 * hold has credit left, for the listed models, until it expires.
 */
import { createHash, randomBytes } from "node:crypto";
import type { SqlClient } from "./sql-queue-store";

export async function mintGatewayKey(sql: SqlClient, jobId: string, models: string[], minutes = 60): Promise<string> {
  if (models.length === 0) throw new Error("a key needs at least one model");
  const token = `agk_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  await sql.query(`insert into public.gateway_keys (key_hash, job_id, models, expires_at) values ($1, $2, $3, now() + make_interval(mins => $4))`,
    [hash, jobId, models, Math.max(1, Math.min(minutes, 24 * 60))]);
  return token;
}
