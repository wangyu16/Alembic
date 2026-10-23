/**
 * D-39 adversarial (worker tier): a study guide, deck or handout containing a
 * file-include directive must not pull a server file into the generated file.
 * The 0.x carriers render with orz-markdown 1.x, which resolved such paths
 * from `process.cwd()`; `./no-file-includes` replaces that reader.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { md } from "orz-markdown";
import { generateSelfContained, type SelfContainedKind } from "./index";

const MARKER = "SECRET_7a2e44_TRACK0_D39_WORKER";
let dir = "";
let abs = "";
let rel = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "alembic-d39w-"));
  abs = join(dir, "secret.md");
  writeFileSync(abs, `${MARKER}\n`);
  rel = relative(process.cwd(), abs);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const directives = () => [
  `{{md ${abs}}}`,
  `{{markdown ${abs}}}`,
  `{{md-include ${abs}}}`,
  `{{md ${rel}}}`,
  `{{md-include ${rel}}}`,
];

describe("D-39 (worker): generators resolve no file include", () => {
  it("[P5.0.1.b] the probe is real: the file exists and the relative path climbs with ../", () => {
    expect(existsSync(abs)).toBe(true);
    expect(rel.startsWith("..")).toBe(true);
  });

  it("[P5.0.1.b] the shared kit-1.x md renders file includes as nothing", () => {
    for (const d of directives()) expect(md.render(d)).not.toContain(MARKER);
  });

  for (const kind of ["md", "slides", "paged"] as SelfContainedKind[]) {
    it(`[P5.0.1.b] ${kind}: the generated file never contains the file's content`, async () => {
      for (const d of directives()) {
        const markdown = kind === "slides" ? `# Slide\n\n${d}\n` : `# Title\n\n${d}\n`;
        const html = await generateSelfContained({ kind, markdown, title: "T" });
        expect(html).not.toContain(MARKER);
      }
    });
  }

  it("[P5.0.1.b] does not read /etc/hosts either", () => {
    if (!existsSync("/etc/hosts")) return;
    expect(md.render("{{md /etc/hosts}}")).not.toMatch(/localhost/i);
  });
});
