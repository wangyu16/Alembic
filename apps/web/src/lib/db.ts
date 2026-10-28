import "server-only";
import postgres from "postgres";
import type { SqlClient } from "@alembic/package-ops";

/**
 * A direct Postgres connection for the v3 write path (service-level SQL the
 * REST API can't express: enqueueSync, doc_versions). Present only where
 * DATABASE_URL is set (the testing VM); elsewhere v3 features stay off.
 */
let sql: ReturnType<typeof postgres> | null = null;

export function directDb(): SqlClient | null {
  const url = process.env["DATABASE_URL"];
  if (!url) return null;
  sql ??= postgres(url, { ssl: "require", max: 3, idle_timeout: 30, prepare: false, onnotice: () => {} });
  const s = sql;
  return { query: async <T,>(text: string, params?: unknown[]) => ({ rows: (await s.unsafe(text, (params ?? []) as never[])) as unknown as T[] }) };
}

/** v3 courses are switched on per deployment (the testing VM sets it). */
export const v3Enabled = (): boolean => process.env["ALEMBIC_V3_COURSES"] === "1" && directDb() !== null;
