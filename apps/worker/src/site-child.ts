/**
 * The website build's child process (A12; see orz-site-builder.ts). Reads
 * `<dir>/in/**` and `<dir>/job.json`, builds with orz-site, and writes
 * `<dir>/out/**` and `<dir>/result.json` — only when the output is within
 * the limits. Its memory and time are limited by the parent.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { inProcessBuilder, SITE_OUT } from "./orz-site-builder";

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(root, rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

async function main(dir: string) {
  const job = JSON.parse(await readFile(join(dir, "job.json"), "utf8")) as { ownConfig: unknown; title: string | null; baseUrl: string; courseIndex?: boolean };
  const files = new Map<string, Uint8Array>();
  for (const rel of await listFiles(join(dir, "in"))) files.set(rel, await readFile(join(dir, "in", rel)));
  const r = await (await inProcessBuilder()).build(files, job);
  let ok = r.ok;
  const errors = [...r.errors];
  if (ok) {
    let total = 0;
    for (const b of r.files.values()) total += b.length;
    const big = [...r.files].find(([, b]) => b.length > SITE_OUT.maxFileBytes);
    if (r.files.size > SITE_OUT.maxFiles || total > SITE_OUT.maxTotalBytes || big) {
      ok = false;
      errors.push(big ? `${big[0]}: this page would be too large for the website` : "The website would be too large; split the course or remove large files");
    }
  }
  if (ok) {
    const root = join(dir, "out");
    for (const [path, bytes] of r.files) {
      const at = join(root, path);
      if (relative(root, at).startsWith("..")) throw new Error(`bad output path ${path}`);
      await mkdir(dirname(at), { recursive: true });
      await writeFile(at, bytes);
    }
  }
  await writeFile(join(dir, "result.json"), JSON.stringify({ ok, errors: errors.slice(0, 50), warnings: r.warnings, leftOut: (r.leftOut ?? []).slice(0, 200), settingsIgnored: r.settingsIgnored === true }));
}

main(process.argv[2]!).catch(async (e) => {
  console.error((e as Error).message);
  // Say why, for the person (the parent shows it): an orz-site or file error, not "out of memory".
  await writeFile(join(process.argv[2]!, "result.json"), JSON.stringify({ ok: false, errors: [`The website build stopped: ${(e as Error).message.slice(0, 300)}`], warnings: 0 })).catch(() => {});
  process.exit(1);
});
