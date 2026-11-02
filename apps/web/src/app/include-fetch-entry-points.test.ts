/**
 * Security loop r1, finding M5 — the class (P5.S.6.b): no entry point that a
 * visitor can reach WITHOUT a session may make the server resolve remote
 * includes or fetch a URL the caller chose.
 *
 * Static inventory over `src/`:
 *  - "fetchers" are the server modules that fetch on someone's behalf: any
 *    module importing orz-markdown's `prepareSources`, or calling `fetch(`
 *    (client components — `"use client"` — fetch from the browser and are not
 *    server fetchers);
 *  - "entry points" are what a request can hit: route handlers (`route.ts`),
 *    server-action modules (`"use server"`), and server-rendered pages /
 *    layouts;
 *  - an entry point "reaches" a fetcher through the import graph (`@/…` and
 *    relative imports, transitively).
 *
 * Every reaching entry point must be session-gated (it checks
 * `auth.getUser()` / a `requireUser`/`requireAdmin` helper and refuses
 * without a user), or be listed in `JUSTIFIED` with the reason its fetch is
 * not caller-chosen. The inventory itself is pinned, so a new path to a
 * fetcher fails here until someone has looked at it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const FILES = walk(SRC);
const text = new Map(FILES.map((f) => [f, readFileSync(f, "utf8")]));
const rel = (f: string) => relative(SRC, f).split("\\").join("/");

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (text.has(cand)) return cand;
  }
  return null;
}

const IMPORT = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const imports = new Map<string, string[]>();
for (const [f, src] of text) {
  const deps: string[] = [];
  for (const m of src.matchAll(IMPORT)) {
    const r = resolveImport(f, m[1] ?? m[2]!);
    if (r) deps.push(r);
  }
  imports.set(f, deps);
}

const isClient = (src: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(src);
const isServerActions = (src: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(src);

const FETCHERS = FILES.filter((f) => {
  const src = text.get(f)!;
  if (isClient(src)) return false;
  return /\bprepareSources\b/.test(src) || /(?<![\w.])fetch\(/.test(src);
});

const reaches = new Map<string, boolean>();
function reachesFetcher(f: string, seen = new Set<string>()): boolean {
  if (reaches.has(f)) return reaches.get(f)!;
  if (FETCHERS.includes(f)) return true;
  if (seen.has(f)) return false;
  seen.add(f);
  const r = (imports.get(f) ?? []).some((d) => !isClient(text.get(d)!) && reachesFetcher(d, seen));
  reaches.set(f, r);
  return r;
}

const ENTRY_POINTS = FILES.filter((f) => {
  const src = text.get(f)!;
  if (isClient(src)) return false;
  return /\/(route|page|layout)\.tsx?$/.test(f) || isServerActions(src);
});

const REACHING = ENTRY_POINTS.filter((f) => reachesFetcher(f)).map(rel).sort();

/** A session gate: the user is looked up and its absence refused. */
const DIRECT_GATE = /auth\.getUser\(\)[\s\S]*?if\s*\(\s*!user\s*\)/;

/**
 * The exported functions of an entry point (each one is callable on its own:
 * an HTTP method of a route, or a server action) and whether each is gated —
 * directly, or through a local `requireUser()` whose own body is a direct
 * gate, or `requireAdmin()` from `lib/admin.ts`.
 */
function exportsOf(src: string): Array<{ name: string; gated: boolean }> {
  const localRequireUser = /async function requireUser\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
  const requireUserGates = DIRECT_GATE.test(localRequireUser);
  const parts = src.split(/^export (?=(?:async )?function )/m).slice(1);
  return parts.map((part) => {
    const name = /function\s+(\w+)/.exec(part)?.[1] ?? "?";
    // Only up to the next top-level declaration.
    const body = part.split(/\n(?=(?:export |async function |function |const |let ))/)[0]!;
    const gated =
      DIRECT_GATE.test(body) ||
      (requireUserGates && /\brequireUser\(\)/.test(body)) ||
      /\brequireAdmin\(\)/.test(body);
    return { name, gated };
  });
}

/**
 * Entry points that reach a fetcher without a session, and why that is safe.
 * Keep this short; every entry must say why the fetched URL is not chosen by
 * the caller.
 */
const JUSTIFIED: Record<string, string> = {
  // Try mode (C7, owner ruling R28) is for visitors without an account. Its server fetches go to
  // fixed hosts only: Wikipedia's API (the topic is a search term; redirects refused) and the
  // operator's own AI gateway. No URL comes from the caller; caps and same-origin checks apply.
  "app/api/try/route.ts": "anonymous by design; fetches fixed hosts only (Wikipedia API, the AI gateway)",
  // The course assistant's AI calls (C4, agent-runtime §17–§18): the caller is a sandbox, not a signed-in person. The one
  // fetch goes to the operator's own gateway (a fixed URL from the settings, never from the request), which refuses any
  // call without a valid per-job key; from a sandbox, that key is the job's own, opened only for a running job there.
  "app/api/agent/ai/v1/messages/route.ts": "a sandbox, not a person; fetches the operator's gateway only, which needs a per-job key",
};

describe("entry points that make the server fetch (security loop r1, M5)", () => {
  it("[P5.S.6.b] every entry point reaching an include resolver or server fetch requires a session", () => {
    expect(FETCHERS.map(rel)).toContain("lib/resolve-includes.ts");
    const ungated = REACHING.filter((f) => !(f in JUSTIFIED)).flatMap((f) =>
      exportsOf(text.get(join(SRC, f))!)
        .filter((e) => !e.gated)
        .map((e) => `${f} :: ${e.name}`),
    );
    expect(ungated).toEqual([]);
    // Each reaching entry point exports at least one callable, all checked.
    for (const f of REACHING) expect(exportsOf(text.get(join(SRC, f))!).length, f).toBeGreaterThan(0);
  });

  it("[P5.S.6.b] the inventory of such entry points is pinned (a new one needs review)", () => {
    expect(REACHING).toEqual([
      "app/api/agent/ai/v1/messages/route.ts",
      "app/api/preview/route.ts",
      "app/api/try/route.ts",
      "app/workspace/[packageId]/collection-actions.ts",
      "app/workspace/[packageId]/export/lms/route.ts",
      "app/workspace/[packageId]/export/study-guide/route.ts",
      "app/workspace/[packageId]/github-actions.ts",
      "app/workspace/[packageId]/hosted-actions.ts",
      "app/workspace/[packageId]/include-actions.ts",
      "app/workspace/[packageId]/site-actions.ts",
    ]);
  });

  it("[P5.S.6.b] the gate check tells a gated export from an ungated one (self-check)", () => {
    const gatedSrc = `export async function POST() {\n  const { data: { user } } = await supabase.auth.getUser();\n  if (!user) return new Response(null, { status: 401 });\n  return go();\n}\n`;
    const openSrc = `export async function POST(request: Request) {\n  return go(await request.text());\n}\n`;
    const viaHelper = `async function requireUser() {\n  const { data: { user } } = await s.auth.getUser();\n  if (!user) redirect("/signin");\n  return user;\n}\nexport async function a() {\n  await requireUser();\n}\nexport async function b() {\n  return 1;\n}\n`;
    expect(exportsOf(gatedSrc)).toEqual([{ name: "POST", gated: true }]);
    expect(exportsOf(openSrc)).toEqual([{ name: "POST", gated: false }]);
    expect(exportsOf(viaHelper)).toEqual([
      { name: "a", gated: true },
      { name: "b", gated: false },
    ]);
  });

  it("[P5.S.6.b] the scan sees through the import graph (self-check)", () => {
    // `/api/preview` reaches `resolve-includes` directly; the export route
    // only through `lib/export.ts` → `lib/worker-client.ts`.
    expect(REACHING).toContain("app/api/preview/route.ts");
    expect(REACHING).toContain("app/workspace/[packageId]/export/study-guide/route.ts");
    // The public permalink route serves registered files by id — it reads
    // the bytes through github-bridge, never a caller-chosen URL.
    expect(REACHING).not.toContain("app/d/[docId]/route.ts");
  });
});
