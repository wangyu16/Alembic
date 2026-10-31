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
/** Rebuilds after leaving out failing pages (each round leaves out at least one page or the settings). */
const MAX_BUILD_ROUNDS = 4; // each round is a whole build inside the child's time limit (round 1 audit L2)

/**
 * The config a course's website is built with: the course's own
 * `orz-site.json` or orz-site's defaults (titled with the course), with what
 * the worker never allows forced: no network includes, pages that load the
 * engine from the CDN (never inlined into every page).
 */
export function siteConfig(own: unknown, title: string | null, defaults: Record<string, unknown>, o: { courseIndex?: boolean } = {}): Record<string, unknown> {
  const base = own && typeof own === "object" && !Array.isArray(own) ? { ...(own as Record<string, unknown>) } : { ...defaults };
  if (!own && title) base["index"] = { ...((defaults["index"] as Record<string, unknown> | undefined) ?? {}), title: title.slice(0, 200) };
  // Alembic wrote the course's own front page (index.md + index.html): orz-site's generated index stays off.
  if (!own && o.courseIndex) base["index"] = { ...((base["index"] as Record<string, unknown> | undefined) ?? {}), mode: "off" };
  const includes = base["includes"] && typeof base["includes"] === "object" ? (base["includes"] as Record<string, unknown>) : {};
  const links = base["links"] && typeof base["links"] === "object" ? (base["links"] as Record<string, unknown>) : {};
  // A link or include to a page that isn't published never stops the website (family SITE-TYPE-CONTRACT §8).
  return { ...base, delivery: "cdn", inline: [], links: { ...links, missing: "warn" }, includes: { ...includes, network: false, missing: "warn" } };
}

/**
 * What of the public tree becomes website input: everything but the course's
 * own files that aren't pages (the public manifest, the site settings), which
 * are read here for the title and the course's own settings.
 */
export function siteInputFiles(files: Map<string, Uint8Array>): { files: Map<string, Uint8Array>; ownConfig: unknown; title: string | null; ownIndex: boolean; indexFallback?: string; settingsIgnored?: true } {
  const decode = (b: Uint8Array | undefined) => (b ? (JSON.parse(new TextDecoder().decode(b)) as unknown) : null);
  // The course's own site settings: invalid ones are ignored and Alembic's defaults used (SITE-TYPE-CONTRACT §5).
  let ownConfig: unknown = null;
  let settingsIgnored = false;
  try { ownConfig = decode(files.get("orz-site.json")); } catch { settingsIgnored = true; }
  const manifest = decode(files.get("alembic.json")) as { title?: unknown; description?: unknown; chapters?: unknown } | null;
  const title = typeof manifest?.title === "string" && manifest.title.trim() ? manifest.title.trim() : null;
  const out = new Map(files);
  out.delete("orz-site.json");
  out.delete("alembic.json");
  // The course's own index, from its chapters in order (RC.16), unless the course has its own site settings or index.
  const ownIndex = ownConfig !== null || out.has("index.md") || out.has("index.html");
  if (!ownIndex && manifest) {
    const home = files.get("home.md");
    out.set("index.md", new TextEncoder().encode(courseIndexText(manifest, [...out.keys()], home ? new TextDecoder().decode(home) : null)));
    out.set("index.html", new TextEncoder().encode('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=index.md.html"><title>Course</title><a href="index.md.html">Open the course</a>\n'));
  }
  // A plain front page to fall back on if the home page's content can't be built (round 1 audit L1).
  const indexFallback = !ownIndex && manifest ? courseIndexText({ ...manifest, terms: undefined, currentTerm: undefined }, [...out.keys()], null) : undefined;
  return { files: out, ownConfig, title, ownIndex, ...(indexFallback ? { indexFallback } : {}), ...(settingsIgnored ? { settingsIgnored: true as const } : {}) };
}

const PART_LINKS: ReadonlyArray<[string, (s: string) => string]> = [
  ["Concept map", (s) => `concepts/${s}.md`], ["Study guide", (s) => `study-guide/${s}.md`], ["Slides", (s) => `slides/${s}.slides.md`],
  ["Assessment guide", (s) => `assessment-support/${s}.md`], ["Practice", (s) => `practice/${s}.md`],
];

/** The course website's front page: title, description, then each chapter in order with its parts (only those published). */
export function courseIndexText(m: { title?: unknown; description?: unknown; chapters?: unknown; terms?: unknown; currentTerm?: unknown }, paths: readonly string[], home: string | null = null): string {
  const has = new Set(paths);
  // Every value written into the generated page is text, never markup (round 1 audit H1: the page is made after
  // Publish's raw-HTML cleaning, so titles and file names must be escaped here).
  const clean = (t: string) => t.replace(/[\r\n]+/g, " ").replace(/\}\}/g, "} }").trim()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\[\]\\`*_])/g, "\\$1");
  const target = (p: string) => `<${p.split("/").map(encodeURIComponent).join("/")}>`;
  const title = typeof m.title === "string" && m.title.trim() ? clean(m.title) : "Course";
  const lines = ["{{nyml", "kind: document", "format: 1", `title: ${title}`, "}}", "", `# ${title}`, ""];
  if (typeof m.description === "string" && m.description.trim()) lines.push(clean(m.description), "");
  // The course-website add-on (course-website-addon §3): the home page's own content first, then this term's pages.
  if (home) {
    const body = home.replace(/^\{\{nyml[\s\S]*?\n\}\}\n?/, "").replace(/^\s*#\s+[^\n]*\n/, "").trim();
    if (body) lines.push(body, "");
  }
  const term = typeof m.currentTerm === "string" ? m.currentTerm : null;
  const termPages = term ? paths.filter((p) => p.startsWith(`current/${term}/`) && /\.md$/i.test(p)).sort() : [];
  if (termPages.length) {
    const terms = Array.isArray(m.terms) ? (m.terms as Array<{ slug?: unknown; title?: unknown }>) : [];
    const title = terms.find((t) => t.slug === term)?.title;
    lines.push(`## This semester${typeof title === "string" ? `: ${clean(title)}` : ""}`, "");
    for (const p of termPages) {
      const name = (p.split("/").pop() ?? p).replace(/\.(slides|paged)?\.?md$/i, "").replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
      lines.push(`- [${clean(name)}](${target(p)})`);
    }
    lines.push("");
  }
  const chapters = Array.isArray(m.chapters) ? (m.chapters as Array<{ slug?: unknown; title?: unknown }>) : [];
  const listed = chapters.filter((c) => typeof c.slug === "string" && PART_LINKS.some(([, p]) => has.has(p(c.slug as string))));
  if (listed.length) {
    lines.push("## Chapters", "");
    listed.forEach((c, k) => {
      const links = PART_LINKS.filter(([, p]) => has.has(p(c.slug as string))).map(([label, p]) => `[${label}](${target(p(c.slug as string))})`);
      lines.push(`${k + 1}. **${clean(typeof c.title === "string" ? c.title : (c.slug as string))}** — ${links.join(" · ")}`);
    });
    lines.push("");
  }
  for (const [name, p] of [["README", "README.md"], ["Course map", "concepts/course.md"]] as const) if (has.has(p)) lines.push(`[${name}](${p})  `);
  // The home page is shown above; its own page is not linked again.
  return lines.join("\n") + "\n";
}

/** The builder as run inside the child: orz-site in this process. */
export async function inProcessBuilder(): Promise<SiteBuilder> {
  const site = await import("orz-site/node");
  const { carriers } = await site.loadCarriers();
  const versions = await site.installedVersions();
  return {
    // The website never fails because of one page (family SITE-TYPE-CONTRACT §8): a page with errors is left out and
    // the site built again; an error tied to no page (the course's own site settings) means building with Alembic's
    // defaults instead. Only what no page explains stops the build.
    async build(files, o) {
      const defaults = { ...site.defaultConfig(), carriers: versions } as unknown as Record<string, unknown>;
      const input = new Map(files);
      const leftOut: string[] = [];
      let own = o.ownConfig;
      let settingsIgnored = false;
      const describe = (f: { path?: string; line?: number; message: string }) => `${f.path ? `${f.path}${f.line ? `:${f.line}` : ""}: ` : ""}${f.message}`;
      for (let round = 0; round < MAX_BUILD_ROUNDS; round++) {
        const config = siteConfig(own, o.title, defaults, { courseIndex: o.courseIndex === true });
        const r = await site.buildSite(input, config, { carriers, baseUrl: o.baseUrl, offline: true });
        if (r.ok) return { ok: true, files: r.files, errors: [], warnings: r.report.warnings.length, leftOut, settingsIgnored };
        const atFault = [...new Set(r.report.errors.map((f) => f.path).filter((p): p is string => !!p && input.has(p)))];
        // The generated front page at fault: fall back to the plain one (without the home page and term), never none.
        if (atFault.includes("index.md") && o.indexFallback && new TextDecoder().decode(input.get("index.md")) !== o.indexFallback) {
          input.set("index.md", new TextEncoder().encode(o.indexFallback));
          continue;
        }
        if (atFault.length) { for (const p of atFault) { input.delete(p); leftOut.push(p); } continue; }
        if (own && !settingsIgnored) { own = null; settingsIgnored = true; continue; }
        return { ok: false, files: new Map(), errors: r.report.errors.map(describe), warnings: r.report.warnings.length, leftOut, settingsIgnored };
      }
      return { ok: false, files: new Map(), errors: ["Too many pages couldn't be built"], warnings: 0, leftOut, settingsIgnored };
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
          // None of the worker's secrets (database, App key) reach the child (review r3 L2).
          const child = spawn(process.execPath, [`--max-old-space-size=${CHILD_HEAP_MB}`, script, dir], {
            stdio: ["ignore", "ignore", "pipe"], cwd: dir, env: { PATH: process.env["PATH"] ?? "", NODE_ENV: "production" },
          });
          let err = "";
          child.stderr.on("data", (d: Buffer) => { if (err.length < 2000) err += d.toString(); });
          const t = setTimeout(() => child.kill("SIGKILL"), CHILD_TIMEOUT_MS);
          // A child that can't start (too many processes or files) fails this build, never the worker (r3 L3).
          child.on("error", (e) => { clearTimeout(t); console.error(`[alembic-worker] site child didn't start: ${e.message}`); resolve(null); });
          child.on("close", (c) => { clearTimeout(t); if (c !== 0 && err) console.error(`[alembic-worker] site child: ${err.slice(0, 500)}`); resolve(c); });
        });
        // The child explains a failure it caught in result.json; no result means it was stopped (time, memory) (r3 L4).
        const result = await readFile(join(dir, "result.json"), "utf8").then((t) => JSON.parse(t) as { ok: boolean; errors: string[]; warnings: number; leftOut?: string[]; settingsIgnored?: boolean }).catch(() => null);
        if (!result || (code !== 0 && result.ok)) return { ok: false, files: new Map(), errors: ["The website build ran out of time or memory"], warnings: 0 };
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
