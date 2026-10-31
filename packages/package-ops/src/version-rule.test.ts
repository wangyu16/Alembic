/** Claims A4.0–A4.4, A4.9, A4.10 (pure parts) of docs/specs/v3/write-path-v3.md. */
import { describe, expect, it } from "vitest";
import { decideFile, mergeBlocks, splitBlocks, type FileChangeInput } from "./version-rule";
import { sha256Hex } from "@alembic/package-contract";

const sg = (...sections: string[]) => "# Gases\n\nIntro.\n\n" + sections.map((s, i) => `## S${i + 1}\n\n${s}\n\n`).join("");
import { createHash } from "node:crypto";
const h = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const input = (o: Partial<FileChangeInput> & Pick<FileChangeInput, "currentText" | "incomingText">): FileChangeInput => ({
  path: "study-guide/gases.md",
  kind: "study-guide",
  baseVersion: o.baseText ? h(o.baseText) : null,
  fromOpenEditor: false,
  ...o,
});

describe("splitBlocks", () => {
  it("concatenates back exactly, for any study guide", async () => {
    const texts = [sg("a", "b", "c"), "", "no headings\n", "## A\n```\n## not a heading\n```\n## B\nx", "x\r\n## A\r\nb\r\n"];
    for (const t of texts) expect(splitBlocks(t, "study-guide").join("")).toBe(t);
  });
  it("does not split inside code fences", async () => {
    expect(splitBlocks("## A\n```\n## inside\n```\n## B\n", "study-guide")).toHaveLength(2);
  });
  it("treats other kinds as one block", async () => {
    expect(splitBlocks("---\nslide\n---\nslide2\n", "slides")).toHaveLength(1);
  });
});

describe("mergeBlocks (diff3 over blocks)", () => {
  it("combines edits to different blocks and keeps both insertions at different places", async () => {
    expect(mergeBlocks(["a", "b", "c"], ["A", "b", "c"], ["a", "b", "C"])).toEqual(["A", "b", "C"]);
    expect(mergeBlocks(["a", "b", "c"], ["a", "x", "b", "c"], ["a", "b", "c", "y"])).toEqual(["a", "x", "b", "c", "y"]);
  });
  it("refuses same-block edits, same-place insertions and an insertion next to an edit", async () => {
    expect(mergeBlocks(["a", "b"], ["A", "b"], ["AA", "b"])).toBeNull();
    expect(mergeBlocks(["a", "b"], ["a", "x", "b"], ["a", "y", "b"])).toBeNull();
    expect(mergeBlocks(["a", "b"], ["A", "b"], ["x", "a", "b"])).toBeNull();
  });
  it("delete of one block with an edit of another combines", async () => {
    expect(mergeBlocks(["a", "b", "c"], ["a", "c"], ["a", "b", "C"])).toEqual(["a", "C"]);
  });
  it("property: disjoint single-block edits always combine to both edits (exhaustive over 5 blocks)", async () => {
    const base = ["b0", "b1", "b2", "b3", "b4"];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      if (Math.abs(i - j) < 1) continue;
      const cur = base.map((b, k) => (k === i ? b + "-cur" : b));
      const inc = base.map((b, k) => (k === j ? b + "-inc" : b));
      const m = mergeBlocks(base, cur, inc);
      expect(m, `${i},${j}`).not.toBeNull();
      expect(m![i]).toBe(base[i] + "-cur");
      expect(m![j]).toBe(base[j] + "-inc");
      expect(m).toHaveLength(5);
    }
  });
});

describe("decideFile", () => {
  const base = sg("one", "two", "three");

  it("A4.0 a replay of the head's content is a no-op landing", async () => {
    const d = await decideFile(input({ baseText: "old", currentText: base, incomingText: base }));
    expect(d).toEqual({ outcome: "landed", write: base, noop: true });
  });

  it("A4.1 base = current lands", async () => {
    const next = sg("one!", "two", "three");
    expect(await decideFile(input({ baseText: base, currentText: base, incomingText: next }))).toMatchObject({ outcome: "landed", write: next });
  });

  it("A4.2 disjoint section edits combine", async () => {
    const cur = sg("ONE", "two", "three");
    const inc = sg("one", "two", "THREE");
    const d = await decideFile(input({ baseText: base, currentText: cur, incomingText: inc }));
    expect(d).toEqual({ outcome: "combined", write: sg("ONE", "two", "THREE") });
  });

  it("A4.3/A4.9 same section: typist on top for an open editor, otherwise current on top", async () => {
    const cur = sg("ONE", "two", "three");
    const inc = sg("uno", "two", "three");
    expect(await decideFile(input({ baseText: base, currentText: cur, incomingText: inc }))).toMatchObject({ outcome: "both-changed", top: cur, kept: inc, reason: "same-block" });
    expect(await decideFile(input({ baseText: base, currentText: cur, incomingText: inc, fromOpenEditor: true }))).toMatchObject({ top: inc, kept: cur });
    expect(await decideFile(input({ baseText: base, currentText: cur, incomingText: inc, fromOpenEditor: true, openItemWithOther: true }))).toMatchObject({ top: cur, kept: inc });
  });

  it("A4.4 course-plan files never combine and current stays on top, even from an open editor", async () => {
    const d = await decideFile({ ...input({ baseText: "a\n\nb\n", currentText: "A\n\nb\n", incomingText: "a\n\nB\n", fromOpenEditor: true }), kind: "concept-map", path: "concepts/gases.md" });
    expect(d).toMatchObject({ outcome: "both-changed", top: "A\n\nb\n", kept: "a\n\nB\n", reason: "plan-file" });
  });

  it("base text unavailable, binary, invalid combination → both changed", async () => {
    expect(await decideFile({ ...input({ baseText: base, currentText: sg("X", "two", "three"), incomingText: sg("one", "two", "Y") }), baseText: undefined })).toMatchObject({ reason: "base-unavailable" });
    expect(await decideFile({ ...input({ baseText: "a", currentText: "b", incomingText: "c" }), kind: "binary", path: "assets/x.png" })).toMatchObject({ reason: "binary" });
    expect(await decideFile({ ...input({ baseText: base, currentText: sg("X", "two", "three"), incomingText: sg("one", "two", "Y") }), validate: () => false })).toMatchObject({ reason: "invalid-combination" });
  });

  it("deletes never silently win; edits against deletions are kept", async () => {
    expect(await decideFile(input({ baseText: base, currentText: sg("changed", "two", "three"), incomingText: null }))).toMatchObject({ outcome: "both-changed", reason: "delete-vs-edit", top: sg("changed", "two", "three") });
    expect(await decideFile(input({ baseText: base, currentText: null, incomingText: sg("mine", "two", "three"), fromOpenEditor: true }))).toMatchObject({ outcome: "both-changed", reason: "edit-vs-delete", top: null, kept: sg("mine", "two", "three") });
    expect(await decideFile(input({ baseText: base, currentText: base, incomingText: null }))).toMatchObject({ outcome: "landed", write: null });
  });

  it("creating a file that someone else created meanwhile → both changed", async () => {
    expect(await decideFile({ ...input({ currentText: "theirs", incomingText: "mine" }), baseVersion: null })).toMatchObject({ reason: "create-exists" });
  });

  it("[K1.35] records are never combined: a record lands only on the version it was made from; a stale one is refused", async () => {
    for (const path of ["private/coursewerk/LOG.jsonl", "provenance/coursewerk/ATTRIBUTION.md"]) {
      const r = { ...input({ currentText: sg("one", "two"), incomingText: sg("one", "TWO") }), path, allowRecords: true };
      expect(await decideFile({ ...r, baseVersion: await sha256Hex(sg("one", "two")) })).toMatchObject({ outcome: "landed" });
      expect(await decideFile({ ...r, baseVersion: await sha256Hex(sg("ONE", "two")), baseText: sg("ONE", "two") })).toMatchObject({ outcome: "refused", reason: "records-stale" });
      expect(await decideFile({ ...r, allowRecords: false })).toMatchObject({ outcome: "refused", reason: "records-not-editable" });
    }
  });

  it("records and the manifest are refused", async () => {
    expect(await decideFile({ ...input({ currentText: "a", incomingText: "b" }), path: "private/coursewerk/LOG.jsonl" })).toMatchObject({ outcome: "refused", reason: "records-not-editable" });
    expect(await decideFile({ ...input({ currentText: "a", incomingText: "b" }), path: "provenance/coursewerk/CHECKED.json" })).toMatchObject({ outcome: "refused", reason: "records-not-editable" });
    expect(await decideFile({ ...input({ currentText: "a", incomingText: "b" }), path: "alembic.json" })).toMatchObject({ outcome: "refused", reason: "manifest-not-editable" });
  });

  it("nothing is ever lost: every both-changed decision keeps both texts", async () => {
    const cur = sg("ONE", "two", "three");
    const inc = sg("uno", "two", "three");
    for (const fromOpenEditor of [true, false]) {
      const d = await decideFile(input({ baseText: base, currentText: cur, incomingText: inc, fromOpenEditor }));
      if (d.outcome !== "both-changed") throw new Error("expected both-changed");
      expect(new Set([d.top, d.kept])).toEqual(new Set([cur, inc]));
    }
  });
});
