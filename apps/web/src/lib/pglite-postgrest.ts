/**
 * Test-only: a tiny PostgREST-shaped client over the PGlite harness, so app
 * code written against `SupabaseClient` (the registry store, the sandbox
 * store, the permalink access check) runs UNCHANGED against the real
 * migrations, as one API role. Only the query-builder calls that code uses
 * are supported: `from(t).select(cols, {count}).eq/neq/in/gt/order/limit/
 * maybeSingle/single`, `from(t).update(patch).eq(…).select(cols)` (owner
 * decision 2: the guarded accessibility record), and `rpc(name, args)`.
 * Never imported by app code.
 */
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { asRole } from "./discovery-pglite";

type Role = "anon" | "authenticated" | "service_role";
type Result = { data: unknown; error: { message: string } | null; count?: number | null };

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`pglite-postgrest: bad identifier ${s}`);
  return `"${s}"`;
};

/** PostgREST answers JSON: timestamps arrive as ISO strings, not Dates. */
function jsonRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
}

class Query implements PromiseLike<Result> {
  private readonly where: string[] = [];
  private readonly params: unknown[] = [];
  private cols = "*";
  private count = false;
  private orderBy: string | null = null;
  private lim: number | null = null;
  private mode: "many" | "maybe" | "single" = "many";
  private readonly sets: string[] = [];

  constructor(
    private readonly run: <T>(fn: () => Promise<T>) => Promise<T>,
    private readonly db: PGlite,
    private readonly table: string,
  ) {}

  /** UPDATE … SET patch (call before the filters); `.select(cols)` returns the updated rows. */
  update(patch: Record<string, unknown>) {
    for (const [k, v] of Object.entries(patch)) {
      this.params.push(v !== null && typeof v === "object" ? JSON.stringify(v) : v);
      this.sets.push(`${ident(k)} = $${this.params.length}`);
    }
    return this;
  }
  select(cols = "*", opts?: { count?: "exact" }) {
    this.cols = cols
      .split(",")
      .map((c) => c.trim())
      .map((c) => (c === "*" ? "*" : ident(c)))
      .join(", ");
    this.count = opts?.count === "exact";
    return this;
  }
  private op(col: string, sql: string, value: unknown) {
    this.params.push(value);
    this.where.push(`${ident(col)} ${sql.replace("?", `$${this.params.length}`)}`);
    return this;
  }
  eq(col: string, v: unknown) {
    return this.op(col, "= ?", v);
  }
  neq(col: string, v: unknown) {
    return this.op(col, "is distinct from ?", v);
  }
  gt(col: string, v: unknown) {
    return this.op(col, "> ?", v);
  }
  in(col: string, vs: unknown[]) {
    return this.op(col, "= any (?)", vs);
  }
  order(col: string) {
    this.orderBy = ident(col);
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }

  private async exec(): Promise<Result> {
    const where = this.where.length ? ` where ${this.where.join(" and ")}` : "";
    const sql = this.sets.length
      ? `update public.${ident(this.table)} set ${this.sets.join(", ")}${where} returning ${this.cols}`
      : `select ${this.cols} from public.${ident(this.table)}${where}` +
      (this.orderBy ? ` order by ${this.orderBy}` : "") +
      (this.lim !== null ? ` limit ${this.lim}` : "");
    try {
      return await this.run(async () => {
        const rows = (await this.db.query<Record<string, unknown>>(sql, this.params)).rows.map(jsonRow);
        let count: number | null = null;
        if (this.count) {
          const c = await this.db.query<{ n: number }>(
            `select count(*)::int as n from public.${ident(this.table)}${where}`,
            this.params,
          );
          count = c.rows[0]!.n;
        }
        if (this.mode === "many") return { data: rows, error: null, count };
        if (rows.length > 1) return { data: null, error: { message: "multiple rows" } };
        if (rows.length === 0 && this.mode === "single") return { data: null, error: { message: "no rows" } };
        return { data: rows[0] ?? null, error: null };
      });
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  }

  then<A = Result, B = never>(
    ok?: ((v: Result) => A | PromiseLike<A>) | null,
    bad?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.exec().then(ok, bad);
  }
}

/** A `SupabaseClient`-shaped handle over `db`, every call as `role`. */
export function pgliteClient(db: PGlite, role: Role, userId?: string): SupabaseClient {
  const run = <T>(fn: () => Promise<T>) => asRole(db, role, fn, userId);
  const client = {
    from: (table: string) => new Query(run, db, table),
    rpc: async (name: string, args: Record<string, unknown> = {}): Promise<Result> => {
      const keys = Object.keys(args);
      const values = keys.map((k) => {
        const v = args[k];
        // jsonb arguments (objects, arrays of objects) travel as JSON text.
        if (v !== null && typeof v === "object" && !(Array.isArray(v) && v.every((x) => typeof x !== "object"))) {
          return JSON.stringify(v);
        }
        return v;
      });
      const call = `public.${ident(name)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ")})`;
      try {
        return await run(async () => {
          const { rows, fields } = await db.query<Record<string, unknown>>(`select * from ${call}`, values);
          // setof scalar → array of values; void → null.
          if (fields.length === 1) {
            const col = fields[0]!.name;
            if (col === name && rows.length === 1 && rows[0]![col] === "") return { data: null, error: null };
            return { data: rows.map((r) => r[col]), error: null };
          }
          return { data: rows, error: null };
        });
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
  };
  return client as unknown as SupabaseClient;
}
