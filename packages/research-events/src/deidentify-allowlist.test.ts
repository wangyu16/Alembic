import { describe, expect, it } from "vitest";
import { deidentifyEvents, eventToCsvRow, eventsToJson, type ResearchEventRow } from "./deidentify";

/**
 * Security loop r1, finding M1 (P5.S.2.a): the export used to pass `detail`
 * through verbatim. These rows are the audit's repro plus every identifying
 * key a caller actually logged (site URL, repo names, raw source ids, error
 * text, file paths, filenames, snapshot names, commit SHAs, content hashes).
 */

const ps = (id: string) => "P-" + Buffer.from(id).toString("hex").slice(0, 12);

const row = (type: string, detail: Record<string, unknown>, over: Partial<ResearchEventRow> = {}): ResearchEventRow => ({
  type,
  user_id: "uuid-alice",
  package_id: "pkg-gen-chem-ab12cd34",
  duration_ms: null,
  detail,
  occurred_at: "2026-10-23T10:00:00Z",
  ...over,
});

const auditRows: ResearchEventRow[] = [
  row("publish.completed", { kind: "site", siteUrl: "https://alice-smith.github.io/gen-chem-x1-oer/", pagesPending: false }),
  row("publish.completed", { publicRepo: "alice-smith/gen-chem-x1-oer", privateRepo: "alice-smith/gen-chem-x1-oer-instructor" }),
  row("publish.failed", { kind: "site", reason: "GitHub said: repository alice-smith/gen-chem-x1-oer not found" }),
  row("publish.failed", { reason: "Bad credentials for alice-smith" }),
  row("adaptation.started", { mode: "portal" }, { user_id: "uuid-bob" }),
  row("adaptation.completed", { sourcePackageId: "pkg-gen-chem-ab12cd34", blocks: 3, crossOwner: true }, { user_id: "uuid-bob", package_id: "pkg-bob-course-zz99" }),
  row("adaptation.completed", { mode: "fork", source: "pkg-gen-chem-ab12cd34", blocks: 12 }),
  row("adaptation.completed", { mode: "element", sourceDocId: "doc-secret-7f3e", sourcePackageId: "pkg-gen-chem-ab12cd34", kind: "figure" }),
  row("suggestion.sent", { toPackageId: "pkg-gen-chem-ab12cd34", crossOwner: true }),
  row("save.completed", { path: "study-guide/alice-notes.md", blockCount: 4 }, { duration_ms: 120 }),
  row("tier1.auto-applied", { kind: "formatting-tidy", path: "study-guide/alice-notes.md" }),
  row("import.completed", { kind: "image", mode: "asset", filename: "alice-smith-roster.png" }),
  row("snapshot.created", { tag: "fall-2026-alice-smith" }),
  row("restore.completed", { fromCommit: "abc1234" }),
  row("export.dual-extension", { kind: "study-guide", format: "md.html", sourceHash: "deadbeefcafe", chapter: "alice-secret-chapter" }),
  row("change.undone", { changeId: "chg-123-secret", kind: "formatting-tidy" }),
  row("upstream.update.applied", { mode: "accept", targetBlockId: "blk-secret-01" }),
  row("artifact.generated", { kind: "diagram", path: "assets/alice-smith.svg" }),
  row("portal.registered", { license: "CC-BY-4.0", attested: true, attestedAt: "2026-10-23T10:00:00Z" }),
];

const FORBIDDEN = [
  "https://", "github.io", "alice-smith", "gen-chem", "pkg-", "doc-secret", "chg-123", "blk-secret",
  "Bad credentials", "not found", "study-guide/", "roster", "abc1234", "deadbeef", "assets/",
];

describe("deidentifyEvents — per-type detail allowlist (security loop r1, M1)", () => {
  it("[P5.S.2.a] the export drops URLs, repo names, logins, paths and free text", () => {
    const out = deidentifyEvents(auditRows, ps);
    const text = eventsToJson(out) + "\n" + out.map(eventToCsvRow).join("\n");
    for (const needle of FORBIDDEN) expect(text, needle).not.toContain(needle);
  });

  it("[P5.S.2.a] kept package and doc ids are pseudonymised with the package pseudonymiser", () => {
    const out = deidentifyEvents(auditRows, ps);
    const adapted = out.find((e) => e.type === "adaptation.completed" && e.detail["crossOwner"] === true && !("mode" in e.detail))!;
    expect(adapted.detail).toEqual({ sourcePackageId: ps("pkg-gen-chem-ab12cd34"), blocks: 3, crossOwner: true });
    // the same source package gets the same code as the package column elsewhere
    expect(adapted.detail["sourcePackageId"]).toBe(out[0]!.package);
    const element = out.find((e) => e.detail["mode"] === "element")!;
    expect(element.detail).toEqual({
      mode: "element",
      sourceDocId: ps("doc-secret-7f3e"),
      sourcePackageId: ps("pkg-gen-chem-ab12cd34"),
      kind: "figure",
    });
    const fork = out.find((e) => e.detail["mode"] === "fork")!;
    expect(fork.detail).toEqual({ mode: "fork", source: ps("pkg-gen-chem-ab12cd34"), blocks: 12 });
    const sent = out.find((e) => e.type === "suggestion.sent")!;
    expect(sent.detail).toEqual({ toPackageId: ps("pkg-gen-chem-ab12cd34"), crossOwner: true });
  });

  it("[P5.S.2.a] analytic keys survive: counts, booleans, enums, statuses, modes", () => {
    const out = deidentifyEvents(auditRows, ps);
    expect(out[0]!.detail).toEqual({ kind: "site", pagesPending: false });
    expect(out[1]!.detail).toEqual({});
    expect(out[2]!.detail).toEqual({ kind: "site" });
    expect(out[4]!.detail).toEqual({ mode: "portal" });
    expect(out.find((e) => e.type === "save.completed")!.detail).toEqual({ blockCount: 4 });
    expect(out.find((e) => e.type === "import.completed")!.detail).toEqual({ kind: "image", mode: "asset" });
    expect(out.find((e) => e.type === "export.dual-extension")!.detail).toEqual({ kind: "study-guide", format: "md.html" });
    expect(out.find((e) => e.type === "portal.registered")!.detail).toEqual({ license: "cc-by-4.0", attested: true });
  });

  it("[P5.S.2.a] an unknown event type or an unknown key is dropped (fail closed)", () => {
    const out = deidentifyEvents(
      [
        row("not.a.type", { count: 3, note: "alice-smith" }),
        row("a11y.checked", { status: "fail", errorCount: 2, warningCount: 1, url: "https://x.example" }),
        row("a11y.checked", { status: "alice wrote this", errorCount: "two", warningCount: -1 }),
        row("agent.run.failed", { reason: "Error: token ghp_secret leaked", issues: 2 }),
      ],
      ps,
    );
    expect(out[0]!.detail).toEqual({});
    expect(out[1]!.detail).toEqual({ status: "fail", errorCount: 2, warningCount: 1 });
    // a value outside its closed vocabulary or of the wrong shape is dropped too
    expect(out[2]!.detail).toEqual({});
    expect(out[3]!.detail).toEqual({ issues: 2 });
  });
});
