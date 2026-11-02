import { describe, expect, it } from "vitest";
import { followFiles, isPage, setStatuses, statusOf } from "./status";
import { toPublicManifest, WorkingManifestV3Schema } from "../manifest-v3";

describe("file status (SITE-TYPE-CONTRACT §7)", () => {
  it("[K1.22] pages are draft until marked completed; other public files are published as they are; any can be withdrawn", () => {
    expect(isPage("study-guide/gases.md")).toBe(true);
    expect(isPage("slides/gases.slides.md")).toBe(true);
    expect(isPage("private/instructor/key.md")).toBe(false);
    expect(isPage("provenance/coursewerk/ATTRIBUTION.md")).toBe(false);
    expect(isPage("assets/gases/f.png")).toBe(false);
    expect(statusOf(undefined, "study-guide/gases.md")).toBe("draft");
    expect(statusOf({ "study-guide/gases.md": "completed" }, "study-guide/gases.md")).toBe("completed");
    expect(statusOf(undefined, "assets/gases/f.png")).toBe("public");
    expect(statusOf({ "assets/gases/f.png": "withdrawn" }, "assets/gases/f.png")).toBe("withdrawn");
  });
  it("[K1.22] a status follows its file: a move carries it (not into private/), a delete drops it, a restored file gets its old one back", () => {
    const m = { "study-guide/a.md": "completed", "assets/f.png": "withdrawn" } as const;
    expect(followFiles(m, { moves: [{ from: "study-guide/a.md", to: "study-guide/b.md" }] })).toEqual({ "study-guide/b.md": "completed", "assets/f.png": "withdrawn" });
    expect(followFiles(m, { moves: [{ from: "study-guide/a.md", to: "private/instructor/a.md" }] })).toEqual({ "assets/f.png": "withdrawn" });
    expect(followFiles(m, { deletes: ["assets/f.png"] })).toEqual({ "study-guide/a.md": "completed" });
    expect(followFiles({}, { restored: [{ path: "study-guide/a.md", status: "completed" }] })).toEqual({ "study-guide/a.md": "completed" });
    expect(followFiles(m, { deletes: ["study-guide/other.md"] })).toBeNull();
  });
  it("[K1.22] many files change at once; draft or bringing back clears the entry", () => {
    expect(setStatuses(undefined, ["a.md", "b.md"], "completed")).toEqual({ "a.md": "completed", "b.md": "completed" });
    expect(setStatuses({ "a.md": "withdrawn" }, ["a.md"], "public")).toEqual({});
    expect(setStatuses({ "a.md": "completed" }, ["a.md"], "draft")).toEqual({});
  });
  it("[K1.22] statuses never reach the public copy", () => {
    const w = WorkingManifestV3Schema.parse({ schemaVersion: 3, packageId: "pkg-a", title: "Chem", license: "CC-BY-4.0", createdAt: "2026-10-30T00:00:00Z", chapters: [], status: { "study-guide/a.md": "completed" } });
    expect("status" in toPublicManifest(w, new Set())).toBe(false);
  });
});
