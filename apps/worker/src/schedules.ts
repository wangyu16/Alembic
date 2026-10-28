/**
 * Periodic jobs (A15). Each one calls a service-role SQL function that is
 * idempotent and takes its own row locks, so two workers running the same
 * schedule at once are safe; one worker never overlaps itself.
 *
 * Off unless SUPABASE_URL and SUPABASE_SECRET_KEY are set (the worker's
 * generation endpoint doesn't need them).
 */

export interface Schedule {
  name: string;
  everyMs: number;
  /** A service-role SQL function with no required arguments… */
  rpc?: string;
  /** …or a job of its own (it gets the same rpc). */
  run?: (rpc: Rpc) => Promise<unknown>;
}

export const SCHEDULES: readonly Schedule[] = [
  // Holds of ended or idle jobs (ledger-v3 §3.4, L-16).
  { name: "ledger-orphan-sweep", everyMs: 5 * 60_000, rpc: "ledger_sweep_orphans" },
  // Ended months' course allowances back to their owners (§3.3, §9.7).
  { name: "ledger-month-end", everyMs: 60 * 60_000, rpc: "ledger_month_end" },
  // Granted credit past its date, recorded as expired (§1, L.2).
  { name: "ledger-expire-lots", everyMs: 60 * 60_000, rpc: "ledger_expire_lots" },
];

export type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Call a Postgres function through Supabase's REST API (no client library). */
export function postgrestRpc(url: string, serviceKey: string, fetchImpl: typeof fetch = fetch): Rpc {
  const base = url.replace(/\/+$/, "");
  return async (fn, args = {}) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new Error(`bad function name ${fn}`);
    const res = await fetchImpl(`${base}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`${fn} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? null : await res.json();
  };
}

export interface Timers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** Start every schedule; returns a stop function. Each tick is awaited, never overlapped. */
export function startSchedules(
  rpc: Rpc,
  opts: { schedules?: readonly Schedule[]; timers?: Timers; log?: (msg: string) => void } = {},
): { stop(): void; tick(name: string): Promise<void> } {
  const schedules = opts.schedules ?? SCHEDULES;
  const timers: Timers = opts.timers ?? {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  };
  const log = opts.log ?? ((m: string) => console.log(`[alembic-worker] ${m}`));
  const running = new Set<string>();

  const tick = async (name: string) => {
    const s = schedules.find((x) => x.name === name);
    if (!s || running.has(name)) return;
    running.add(name);
    try {
      const out = s.run ? await s.run(rpc) : s.rpc ? await rpc(s.rpc) : null;
      if (typeof out === "number" && out > 0) log(`${name}: ${out}`);
    } catch (e) {
      log(`${name} failed: ${(e as Error).message}`);
    } finally {
      running.delete(name);
    }
  };
  const handles = schedules.map((s) => timers.setInterval(() => void tick(s.name), s.everyMs));
  return { stop: () => handles.forEach((h) => timers.clearInterval(h)), tick };
}
