import { describe, expect, it } from "vitest";
import { appliedAppend, HANDIN_LIMITS, parseDigest, parseEvent, parseHandIn } from "./agent-api";

const V = "a".repeat(64);
const ok = (b: unknown, role: "owner" | "co-author" = "co-author") => parseHandIn(b, role);

describe("reading the agent's hand-in (agent-runtime §11, §14, §15)", () => {
  it("[K1.40] a hand-in of edits, records, appends, proposals and questions is read as the agent's writes", () => {
    const r = ok({
      changesetId: "cs-0001-abc",
      files: [
        { path: "study-guide/gases.md", baseVersion: V, text: "# Gases\n" },
        { path: "provenance/coursewerk/CHECKED.json", baseVersion: null, text: "{}" },
        { path: "practice/new.md", movedFrom: "practice/old.md", baseVersion: null },
      ],
      appends: [{ path: "private/coursewerk/LOG.jsonl", baseVersion: V, append: "{\"step\":1}" }],
      courseOps: [{ op: "renameChapter", slug: "gases", title: "The Gas Laws" }],
      digest: { questions: [{ id: "q1", text: "Round to 3 significant figures?", choices: ["Yes", "No"], recommended: "Yes" }] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.files.map((f) => f.path)).toEqual(["study-guide/gases.md", "provenance/coursewerk/CHECKED.json", "practice/new.md"]);
    expect(r.value.files[2]).toMatchObject({ movedFrom: "practice/old.md", text: null });
    expect(r.value.courseOps).toHaveLength(1);
    expect(r.value.questions[0]).toEqual({ id: "q1", text: "Round to 3 significant figures?", choices: ["Yes", "No"], recommended: "Yes" });
  });

  it("[K1.40] refused: files the agent may not write, records deleted or moved, appends outside .jsonl records, unclean paths, repeats, bad ids", () => {
    const one = (f: unknown) => ok({ changesetId: "cs-0001-abc", files: [f] });
    expect(one({ path: "alembic.json", baseVersion: V, text: "{}" }).ok).toBe(false);
    expect(one({ path: ".github/workflows/x.yml", baseVersion: null, text: "on: push" }).ok).toBe(false);
    expect(one({ path: "private/sources/x.json", baseVersion: null, text: "{}" }).ok).toBe(false);
    expect(one({ path: "README.md", baseVersion: V, text: "x" }).ok).toBe(false); // a course file: the lead's
    expect(one({ path: "study-guide/../alembic.json", baseVersion: V, text: "{}" }).ok).toBe(false);
    expect(one({ path: "private/coursewerk/LOG.jsonl", baseVersion: V, text: null }).ok).toBe(false);
    expect(one({ path: "provenance/coursewerk/A.md", movedFrom: "study-guide/gases.md", baseVersion: null }).ok).toBe(false);
    expect(one({ path: "study-guide/gases.md", baseVersion: null, text: null }).ok).toBe(false); // a delete names what was read
    expect(one({ path: "study-guide/gases.md", baseVersion: "HEAD", text: "x" }).ok).toBe(false);
    expect(ok({ changesetId: "cs-0001-abc", appends: [{ path: "study-guide/gases.md", baseVersion: V, append: "x" }] }).ok).toBe(false);
    expect(ok({ changesetId: "cs-0001-abc", files: [{ path: "practice/a.md", baseVersion: null, text: "a" }, { path: "practice/a.md", baseVersion: null, text: "b" }] }).ok).toBe(false);
    for (const id of ["short", "x".repeat(65), "has space!", 7]) expect(ok({ changesetId: id, files: [{ path: "practice/a.md", baseVersion: null, text: "a" }] }).ok).toBe(false);
    expect(ok({ changesetId: "cs-0001-abc" }).ok).toBe(false); // empty
    expect(ok({ changesetId: "cs-0001-abc", courseOps: [{ op: "setLicense", license: "MIT; drop table" }] }).ok).toBe(false);
  });

  it("[K1.40] every list is bounded: content files, records, record bytes, operations, questions", () => {
    const many = (n: number, dir: string) => Array.from({ length: n }, (_, k) => ({ path: `${dir}/f${k}.md`, baseVersion: null, text: "x" }));
    expect(ok({ changesetId: "cs-0001-abc", files: many(HANDIN_LIMITS.contentFiles, "practice") }).ok).toBe(true);
    expect(ok({ changesetId: "cs-0001-abc", files: many(HANDIN_LIMITS.contentFiles + 1, "practice") }).ok).toBe(false);
    // Records don't count toward the 50 (§15 M1), but have their own bounds.
    expect(ok({ changesetId: "cs-0001-abc", files: [...many(50, "practice"), ...many(100, "provenance/coursewerk")] }).ok).toBe(true);
    expect(ok({ changesetId: "cs-0001-abc", files: many(HANDIN_LIMITS.recordFiles + 1, "provenance/coursewerk") }).ok).toBe(false);
    const big = "x".repeat(1024 * 1024);
    expect(ok({ changesetId: "cs-0001-abc", files: Array.from({ length: 5 }, (_, k) => ({ path: `private/coursewerk/r${k}.json`, baseVersion: null, text: big })) }).ok).toBe(false);
    expect(ok({ changesetId: "cs-0001-abc", courseOps: Array.from({ length: 21 }, () => ({ op: "renameChapter", slug: "gases", title: "G" })) }).ok).toBe(false);
    expect(parseDigest({ questions: Array.from({ length: 51 }, (_, k) => ({ id: `q${k}`, text: "Why?" })) }).ok).toBe(false);
  });

  it("[K1.40] questions are plain one-line text with unique ids and a recommendation among the choices", () => {
    expect(parseDigest({ questions: [{ id: "q1", text: "A?" }, { id: "q1", text: "B?" }] }).ok).toBe(false);
    expect(parseDigest({ questions: [{ id: "q1", text: "x".repeat(501) }] }).ok).toBe(false);
    expect(parseDigest({ questions: [{ id: "q1", text: "A?", choices: ["Yes", "No"], recommended: "Maybe" }] }).ok).toBe(false);
    expect(parseDigest({ questions: [{ id: "q1", text: "A?", recommended: "Yes" }] }).ok).toBe(false);
    expect(parseDigest({ questions: [{ id: "q1", text: "A?", choices: ["Yes"] }] }).ok).toBe(false);
    expect(parseDigest({ questions: [{ id: "q1", text: "A?", choices: ["a\u0007", "b"] }] }).ok).toBe(false);
  });

  it("[K1.40] events: a closed list of kinds (no questions, no approvals), payloads at most 64 KiB", () => {
    expect(parseEvent({ kind: "progress", payload: { text: "Reading chapter 6" } }).ok).toBe(true);
    for (const kind of ["question", "approve", "publish", "both-changed"]) expect(parseEvent({ kind, payload: {} }).ok).toBe(false);
    expect(parseEvent({ kind: "message", payload: { t: "x".repeat(70_000) } }).ok).toBe(false);
  });

  it("[K1.40] an append lands only on the log version it was read at", () => {
    expect(appliedAppend("a\n", V, { baseVersion: V, append: "b" })).toBe("a\nb\n");
    expect(appliedAppend("a", V, { baseVersion: V, append: "b\n" })).toBe("a\nb\n");
    expect(appliedAppend("a\n", "b".repeat(64), { baseVersion: V, append: "b" })).toBeNull();
    expect(appliedAppend(null, null, { baseVersion: V, append: "b" })).toBeNull();
  });
});
