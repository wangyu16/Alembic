import { beforeAll, describe, expect, it } from "vitest";
import type { OrzKit } from "./kit";
import { assembleDownload, headerValues, readReplacement, withHostKeys } from "./download";

let kit: OrzKit;
beforeAll(async () => { kit = (await import("orz-mdhtml-browser")) as unknown as OrzKit; }, 60_000);

const TEXT = "{{nyml\nkind: document\nformat: 1\ntitle: Notes\nuid: doc-abcdefghij12\n}}\n\n# Notes\n\nBody.\n";
const META = { packageId: "pkg-1", path: "chapters/01/notes.md", baseVersion: "b".repeat(64) };
const EXPECT = { packageId: "pkg-1", path: "chapters/01/notes.md", kind: "md" };

describe("Download and Replace", () => {
  it("round-trips identity and base, and strips the host keys (K4.3)", async () => {
    const html = await assembleDownload(kit, TEXT, META);
    // Edited elsewhere: change the body inside the assembled file's text.
    const edited = kit.extract(html)!.text.replace("Body.", "Body, edited offline.");
    const reHtml = await kit.assemble(edited, { delivery: "inline" });
    const r = readReplacement(kit, reHtml, EXPECT);
    expect(r).toEqual({ ok: true, baseVersion: META.baseVersion, text: TEXT.replace("Body.", "Body, edited offline.") });
  }, 60_000);

  it("accepts the bare text too", () => {
    const r = readReplacement(kit, withHostKeys(kit, TEXT, META), EXPECT);
    expect(r.ok && r.text).toBe(TEXT);
  });

  it("refuses another course's or another file's download", () => {
    expect(readReplacement(kit, withHostKeys(kit, TEXT, { ...META, packageId: "pkg-2" }), EXPECT)).toEqual({ ok: false, reason: "other-course" });
    expect(readReplacement(kit, withHostKeys(kit, TEXT, { ...META, path: "chapters/02/x.md" }), EXPECT)).toEqual({ ok: false, reason: "other-file" });
    expect(readReplacement(kit, "<!doctype html><p>hello</p>", EXPECT)).toEqual({ ok: false, reason: "not-a-document" });
  });

  it("a file made elsewhere has no base; a malformed base is ignored", () => {
    expect(readReplacement(kit, TEXT, EXPECT)).toEqual({ ok: true, text: TEXT, baseVersion: null });
    const bad = kit.editHeader(TEXT, { x_alembic_base: "nope" });
    const r = readReplacement(kit, bad, EXPECT);
    expect(r).toEqual({ ok: true, text: TEXT, baseVersion: null });
  });

  it("reads header values", () => {
    expect(headerValues(withHostKeys(kit, TEXT, META))["x_alembic_path"]).toBe("chapters/01/notes.md");
    expect(headerValues("# no header")).toEqual({});
  });
});
