/**
 * D-39 adversarial: educator content must never make the SERVER read a local
 * file. orz-markdown ≤ 1.6 resolved `{{md path}}` (and its aliases) from
 * `process.cwd()` when no env was passed, so `{{md /etc/hosts}}` or
 * `{{md ../.env}}` in a study guide leaked the server's files into the
 * rendered page. Every server render entry point is attacked here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  buildMdHtml,
  buildSite,
  buildSlidesHtml,
  renderDocument,
  renderMarkdown,
  renderPlainDocument,
} from "./index";

// The marker lives only in the file's CONTENT, never in its path, so it can
// appear in the output only if the file was read.
const MARKER = "SECRET_9f3c1b_TRACK0_D39";
let dir = "";
let abs = "";
let rel = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "alembic-d39-"));
  abs = join(dir, "secret.md");
  writeFileSync(abs, `# ${MARKER}\n\n${MARKER} body\n`);
  // A `../`-style path from the server's working directory to the same file.
  rel = relative(process.cwd(), abs);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const directives = () => [
  `{{md ${abs}}}`,
  `{{markdown ${abs}}}`,
  `{{md-include ${abs}}}`,
  `{{md ${rel}}}`,
  `{{md-include ${rel}}}`,
  `{{md ./${rel}}}`,
];

describe("D-39: no server-side file includes", () => {
  it("the probe is real: the target file exists and the relative path climbs out with ../", () => {
    expect(existsSync(abs)).toBe(true);
    expect(rel.startsWith("..")).toBe(true);
  });

  it("renderMarkdown resolves no absolute or ../ file include", () => {
    for (const d of directives()) {
      expect(renderMarkdown(`Before\n\n${d}\n\nAfter`)).not.toContain(MARKER);
    }
  });

  it("renderDocument / renderPlainDocument resolve none", () => {
    for (const d of directives()) {
      expect(renderDocument("t", d)).not.toContain(MARKER);
      expect(renderPlainDocument("t", d)).not.toContain(MARKER);
    }
  });

  it("buildMdHtml / buildSlidesHtml / buildSite resolve none", () => {
    for (const d of directives()) {
      expect(buildMdHtml({ title: "t", markdown: d })).not.toContain(MARKER);
      expect(buildSlidesHtml({ title: "t", source: `# Slide\n\n${d}` })).not.toContain(MARKER);
      const files = buildSite({
        title: "t",
        studyGuideMarkdown: d,
        worksheets: [{ title: "w", slug: "w", markdown: d }],
        builtAt: "2026-10-23T00:00:00Z",
      });
      for (const f of files) expect(f.content).not.toContain(MARKER);
    }
  });

  it("does not read /etc/hosts either", () => {
    if (!existsSync("/etc/hosts")) return;
    const html = renderMarkdown("{{md /etc/hosts}}\n\n{{md-include /etc/hosts}}");
    expect(html).not.toMatch(/localhost/i);
  });
});
