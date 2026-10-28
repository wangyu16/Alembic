/**
 * A14 helper: move a 0.x course into one v3 working tree (R31, manual move).
 *
 *   pnpm --filter @alembic/web exec tsx scripts/move-course-v3.ts \
 *     --public <clone of the -oer repo> --private <clone of the -private repo> --out <new folder> [--write]
 *
 * Without --write it only reports the plan. With --write it fills --out (which
 * must not exist or be empty); it never touches the source folders. Review the
 * report, then commit --out to the new course's working repo by hand.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { addHeader, findCollisions, planFile, type MoveAction } from "../src/lib/course-move";

type Kit = {
  extract(html: string): { text: string; kind: string; legacy?: { notes: string[] } } | null;
  readDocument(text: string): { lints?: Array<{ level: string; code: string; message: string }> };
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function walk(root: string): string[] {
  const out: string[] = [];
  const go = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const s = statSync(p);
      if (s.isSymbolicLink()) continue;
      if (s.isDirectory()) { if (e !== ".git" && e !== "node_modules") go(p); } else out.push(relative(root, p).split(sep).join("/"));
    }
  };
  go(root);
  return out.sort();
}

async function main() {
  const pub = arg("public"), priv = arg("private"), outDir = arg("out");
  const write = process.argv.includes("--write");
  if (!pub || !outDir) {
    console.error("usage: move-course-v3.ts --public <dir> [--private <dir>] --out <dir> [--write]");
    process.exit(2);
  }
  if (write && existsSync(outDir) && readdirSync(outDir).length > 0) {
    console.error(`--out ${outDir} is not empty; refusing to write.`);
    process.exit(2);
  }
  const kits: Record<string, Kit> = {
    md: (await import("orz-mdhtml-browser")) as unknown as Kit,
    slides: (await import("orz-slides-browser")) as unknown as Kit,
    paged: (await import("orz-paged-browser")) as unknown as Kit,
  };
  const planned: Array<MoveAction & { root: string }> = [
    ...walk(pub).map((p) => ({ ...planFile("public", p), root: pub })),
    ...(priv ? walk(priv).map((p) => ({ ...planFile("private", p), root: priv })) : []),
  ];
  const collisions = findCollisions(planned);
  const report: string[] = [];
  const counts = { copy: 0, header: 0, extract: 0, skip: 0, attention: 0 };
  const put = (to: string, data: string | Buffer) => {
    if (!write) return;
    const p = join(outDir, to);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
  };
  const lintsOf = (kind: string, text: string) =>
    (kits[kind]!.readDocument(text).lints ?? []).filter((l) => l.level === "error").map((l) => `${l.code}: ${l.message}`);

  for (const a of planned) {
    counts[a.kind]++;
    if (a.kind === "skip") { report.push(`skip     ${a.from} — ${a.reason}`); continue; }
    if (collisions.some((c) => c.to === a.to)) { counts.attention++; report.push(`CONFLICT ${a.from} → ${a.to} (another file goes there too; not written)`); continue; }
    const src = join(a.root, a.from);
    if (a.kind === "copy") { put(a.to, readFileSync(src)); continue; }
    const text = readFileSync(src, "utf8");
    if (a.kind === "header") {
      const kind = a.to.endsWith(".slides.md") ? "slides" : "md";
      const out = addHeader(text, {});
      const errs = lintsOf(kind, out);
      if (errs.length) { counts.attention++; report.push(`CHECK    ${a.to}: ${errs.join("; ")}`); }
      if (a.to !== a.from) report.push(`rename   ${a.from} → ${a.to}`);
      put(a.to, out);
      continue;
    }
    const ex = kits[a.carrier]!.extract(text);
    if (!ex) { counts.attention++; report.push(`CHECK    ${a.from}: not a readable ${a.carrier} file; copied unchanged`); put(a.from, text); continue; }
    for (const n of ex.legacy?.notes ?? []) report.push(`note     ${a.from}: ${n}`);
    const errs = lintsOf(a.carrier, ex.text);
    if (errs.length) { counts.attention++; report.push(`CHECK    ${a.to}: ${errs.join("; ")}`); }
    report.push(`text     ${a.from} → ${a.to}`);
    put(a.to, ex.text);
  }
  console.log(report.join("\n"));
  console.log(`\n${write ? "Wrote" : "Would write"} ${counts.copy + counts.header + counts.extract - counts.attention} files ` +
    `(copied ${counts.copy}, headers ${counts.header}, converted ${counts.extract}); skipped ${counts.skip}; ${counts.attention} need a look (CHECK / CONFLICT).`);
  if (!write) console.log("Nothing written. Add --write to fill the output folder.");
}

void main();
