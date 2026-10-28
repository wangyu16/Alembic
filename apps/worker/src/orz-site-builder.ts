/**
 * orz-site on the worker (A12). The build runs in a CHILD process with its
 * own memory limit and a time limit (review round 2, H-A): one course's
 * build can't exhaust the worker that commits every course's work. The child
 * loads orz-site and the installed carriers from the worker's own
 * node_modules (they read their shells from disk, so they aren't bundled).
 */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { SiteBuilder } from "./site-build-loop";

/** Output limits (checked in the child before anything is written). */
export const SITE_OUT = { maxFiles: 4000, maxFileBytes: 15 * 1024 * 1024, maxTotalBytes: 60 * 1024 * 1024 };
const CHILD_HEAP_MB = 256;
const CHILD_TIMEOUT_MS = 120_000;

/**
 * The config a course's website is built with: the course's own
 * `orz-site.json` or orz-site's defaults (titled with the course), with what
 * the worker never allows forced: no network includes, pages that load the
 * engine from the CDN (never inlined into every page).
 */
export function siteConfig(own: unknown, title: string | null, defaults: Record<string, unknown>): Record<string, unknown> {
  const base = own && typeof own === "object" && !Array.isArray(own) ? { ...(own as Record<string, unknown>) } : { ...defaults };
  if (!own && title) base["index"] = { ...((defaults["index"] as Record<string, unknown> | undefined) ?? {}), title: title.slice(0, 200) };
  const includes = base["includes"] && typeof base["includes"] === "object" ? (base["includes"] as Record<string, unknown>) : {};
  return { ...base, delivery: "cdn", inline: [], includes: { ...includes, network: false } };
}

/** The builder as run inside the child: orz-site in this process. */
export async function inProcessBuilder(): Promise<SiteBuilder> {
  const site = await import("orz-site/node");
  const { carriers } = await site.loadCarriers();
  const versions = await site.installedVersions();
  return {
    async build(files, o) {
      const config = siteConfig(o.ownConfig, o.title, { ...site.defaultConfig(), carriers: versions } as unknown as Record<string, unknown>);
      const r = await site.buildSite(files, config, { carriers, baseUrl: o.baseUrl, offline: true });
      return {
        ok: r.ok,
        files: r.files,
        errors: r.report.errors.map((f) => `${f.path ? `${f.path}${f.line ? `:${f.line}` : ""}: ` : ""}${f.message}`),
        warnings: r.report.warnings.length,
      };
    },
  };
}

/** The builder the worker uses: each build in a fresh child process (`script` = the bundled site-child.mjs). */
export function childProcessBuilder(script: string): SiteBuilder {
  return {
    async build(files, o) {
      const dir = await mkdtemp(join(tmpdir(), "alembic-site-"));
      try {
        for (const [path, bytes] of files) {
          const at = join(dir, "in", path);
          if (relative(join(dir, "in"), at).startsWith("..")) throw new Error(`bad path ${path}`);
          await mkdir(dirname(at), { recursive: true });
          await writeFile(at, bytes);
        }
        await writeFile(join(dir, "job.json"), JSON.stringify(o));
        const code = await new Promise<number | null>((resolve) => {
          const child = spawn(process.execPath, [`--max-old-space-size=${CHILD_HEAP_MB}`, script, dir], { stdio: ["ignore", "ignore", "pipe"] });
          let err = "";
          child.stderr.on("data", (d: Buffer) => { if (err.length < 2000) err += d.toString(); });
          const t = setTimeout(() => child.kill("SIGKILL"), CHILD_TIMEOUT_MS);
          child.on("close", (c) => { clearTimeout(t); if (c !== 0 && err) console.error(`[alembic-worker] site child: ${err.slice(0, 500)}`); resolve(c); });
        });
        if (code !== 0) return { ok: false, files: new Map(), errors: ["The website build ran out of time or memory"], warnings: 0 };
        const result = JSON.parse(await readFile(join(dir, "result.json"), "utf8")) as { ok: boolean; errors: string[]; warnings: number };
        const out = new Map<string, Uint8Array>();
        if (result.ok) {
          const root = join(dir, "out");
          for (const rel of await listFiles(root)) out.set(rel, await readFile(join(root, rel)));
        }
        return { ...result, files: out };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(root, rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}
