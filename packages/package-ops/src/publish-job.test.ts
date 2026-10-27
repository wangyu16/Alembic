/** The Publish job with fakes: claims P.4–P.6, P.11–P.15, Q.6 (drift), first Publish. */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WorkingManifestV3Schema } from "@alembic/package-contract";
import { runPublish, type PublicSide, type PublishedRecord, type PublishStore, type TreeEntry, type UnitCheck, type WorkingSide } from "./publish-job";

const h = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const manifest = (chs: Array<{ slug: string; mode?: "draft" | "package" }>) =>
  WorkingManifestV3Schema.parse({ schemaVersion: 3, packageId: "pkg-1", title: "Chem", license: "CC-BY-4.0", createdAt: "2026-10-27T00:00:00Z",
    privateRepo: { owner: "yu", name: "chem-private" }, chapters: chs.map((c) => ({ slug: c.slug, title: c.slug, mode: c.mode ?? "package" })) });

function working(files: Record<string, string>, extra: TreeEntry[] = [], truncated = false): WorkingSide {
  return {
    async head() { return "W1"; },
    async listTree() { return { entries: [...Object.keys(files).map((p) => ({ path: p, mode: "100644", blobSha: `wb-${p}` })), ...extra], truncated }; },
    async readText(_s, p) { return files[p] ?? null; },
  };
}

class FakePublic implements PublicSide {
  commits: Array<{ sha: string; message: string; files: Map<string, string> }> = [];
  headSha: string | null = null;
  async head() { return this.headSha; }
  async create() { this.commits.push({ sha: "p0", message: "init", files: new Map() }); this.headSha = "p0"; return "p0"; }
  private at(sha: string) { return this.commits.find((c) => c.sha === sha)!; }
  async listTree(sha: string) { return { entries: [...this.at(sha).files.keys()].map((p) => ({ path: p, mode: "100644", blobSha: `pb-${p}` })), truncated: false }; }
  async recentCommits() { return [...this.commits].reverse().map((c) => ({ sha: c.sha, message: c.message })); }
  async changedPaths(from: string, to: string) {
    const a = this.at(from).files, b = this.at(to).files;
    return [...new Set([...a.keys(), ...b.keys()])].filter((p) => a.get(p) !== b.get(p));
  }
  async commit(i: { expectedHead: string; message: string; files: Array<{ path: string; text?: string; blobSha?: string; delete?: true }> }) {
    if (i.expectedHead !== this.headSha) throw new Error("head moved");
    const next = new Map(this.at(this.headSha!).files);
    for (const f of i.files) f.delete ? next.delete(f.path) : next.set(f.path, f.text ?? `blob:${f.blobSha}`);
    const sha = `p${this.commits.length}`;
    this.commits.push({ sha, message: i.message, files: next });
    this.headSha = sha;
    return sha;
  }
  push(path: string, text: string) {
    const next = new Map(this.at(this.headSha!).files); next.set(path, text);
    const sha = `p${this.commits.length}`; this.commits.push({ sha, message: "edited on GitHub", files: next }); this.headSha = sha;
  }
  file(p: string) { return this.at(this.headSha!).files.get(p); }
}

class FakeStore implements PublishStore {
  ack: string | null = null;
  runs = new Map<string, { status: string; intended: PublishedRecord[]; publicSha?: string }>();
  files: PublishedRecord[] = [];
  approvals = new Set<string>(); // `${path}@${version}`
  drift: string[][] = [];
  async acknowledged() { return this.ack; }
  async acknowledge(_p: string, sha: string) { this.ack = sha; }
  async pendingRun(_p: string, id: string) { const r = this.runs.get(id); return r && r.status === "pending" ? { id, intendedFiles: r.intended } : null; }
  async insertPendingRun(r: { id: string; intendedFiles: PublishedRecord[] }) { this.runs.set(r.id, { status: "pending", intended: r.intendedFiles }); }
  async markCommitted(id: string, sha: string, files: PublishedRecord[]) { this.runs.set(id, { status: "committed", intended: files, publicSha: sha }); this.files = files; }
  async publishedFiles() { return this.files; }
  async approvedAt(_p: string, parts: Array<{ path: string; version: string }>) { return new Set(parts.filter((x) => this.approvals.has(`${x.path}@${x.version}`)).map((x) => x.path)); }
  async bringInDrift(_p: string, _s: string, paths: string[]) { this.drift.push(paths); return "done" as const; }
  approve(path: string, text: string) { this.approvals.add(`${path}@${h(text)}`); }
}

const W = {
  "concepts/atoms.md": "atoms plan", "assessment-support/atoms.md": "atoms assess", "study-guide/atoms.md": "# Atoms",
  "concepts/gases.md": "gases plan", "assessment-support/gases.md": "gases assess", "study-guide/gases.md": "# Gases",
  "private/instructor/key.md": "ANSWERS", "README.md": "readme", "alembic.json": "{}",
};
const noChecks: UnitCheck[] = [];
const input = (over: Partial<Parameters<typeof runPublish>[0]> = {}) => ({
  runId: "11111111-1111-4111-8111-111111111111", packageId: "pkg-1", by: "owner", isFirstPublish: true,
  manifest: manifest([{ slug: "atoms" }, { slug: "gases" }]), choices: { publishAnyway: [], approveAndPublish: [] }, ...over,
});

describe("runPublish", () => {
  it("first Publish creates the public repo; approved chapters publish, unapproved are kept; private never leaves", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    st.approve("concepts/atoms.md", "atoms plan"); st.approve("assessment-support/atoms.md", "atoms assess");
    const out = await runPublish(input(), working(W), pub, st, noChecks);
    expect(out.status).toBe("committed");
    expect(pub.file("study-guide/atoms.md")).toBe("# Atoms");
    expect(pub.file("study-guide/gases.md")).toBeUndefined();
    expect(pub.file("private/instructor/key.md")).toBeUndefined();
    expect(JSON.parse(pub.file("alembic.json")!)).not.toHaveProperty("privateRepo");
    expect(st.runs.get(input().runId)!.status).toBe("committed");
    expect(st.ack).toBe(pub.headSha);
    expect((await pub.recentCommits())[0]!.message).toContain("Alembic-Publish-Run: 11111111-1111-4111-8111-111111111111");
  });

  it("an always-finding keeps its chapter whatever the choices", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    for (const [p, t] of Object.entries(W)) if (p.startsWith("concepts/") || p.startsWith("assessment-support/")) st.approve(p, t);
    const leak: UnitCheck = { id: "answer-key", async run(unit) { return unit === "chapter:atoms" ? [{ unit, check: "answer-key", severity: "always", message: "matches an answer key" }] : []; } };
    const out = await runPublish(input({ choices: { publishAnyway: ["atoms"], approveAndPublish: [] } }), working(W), pub, st, [leak]);
    expect(out.status === "committed" && out.published).toEqual(["gases"]);
  });

  it("drift on GitHub is brought in and the run stops; the next run proceeds", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    for (const [p, t] of Object.entries(W)) if (p.startsWith("concepts/") || p.startsWith("assessment-support/")) st.approve(p, t);
    await runPublish(input(), working(W), pub, st, noChecks);
    pub.push("study-guide/atoms.md", "# Atoms (edited on GitHub)");
    const second = await runPublish(input({ runId: "22222222-2222-4222-8222-222222222222", isFirstPublish: false }), working(W), pub, st, noChecks);
    expect(second).toMatchObject({ status: "stopped", drift: ["study-guide/atoms.md"] });
    const third = await runPublish(input({ runId: "33333333-3333-4333-8333-333333333333", isFirstPublish: false }), working(W), pub, st, noChecks);
    expect(third.status).toBe("committed");
  });

  it("a crash after the public commit is completed from the trailer, not treated as drift", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    for (const [p, t] of Object.entries(W)) if (p.startsWith("concepts/") || p.startsWith("assessment-support/")) st.approve(p, t);
    const realMark = st.markCommitted.bind(st);
    let crash = true;
    st.markCommitted = async (...a) => { if (crash) { crash = false; throw new Error("worker died"); } return realMark(...a); };
    await expect(runPublish(input(), working(W), pub, st, noChecks)).rejects.toThrow("worker died");
    const again = await runPublish(input({ runId: "44444444-4444-4444-8444-444444444444", isFirstPublish: false }), working(W), pub, st, noChecks);
    expect(again.status).toBe("committed");
    expect(st.drift).toHaveLength(0);
    expect(st.runs.get(input().runId)!.status).toBe("committed");
  });

  it("refuses symlinks, submodules and truncated trees", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    expect(await runPublish(input(), working(W, [{ path: "study-guide/key.md", mode: "120000", blobSha: "x" }]), pub, st, noChecks)).toMatchObject({ status: "stopped" });
    expect(await runPublish(input(), working(W, [], true), pub, st, noChecks)).toMatchObject({ status: "stopped" });
    expect(pub.headSha).toBeNull();
  });

  it("a later run removes chapters that left the manifest and keeps kept chapters' old bytes", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    for (const [p, t] of Object.entries(W)) if (p.startsWith("concepts/") || p.startsWith("assessment-support/")) st.approve(p, t);
    await runPublish(input(), working(W), pub, st, noChecks);
    const W2 = { ...W, "study-guide/atoms.md": "# Atoms v2", "concepts/atoms.md": "atoms plan v2" }; // plan changed: no longer approved
    const out = await runPublish(input({ runId: "55555555-5555-4555-8555-555555555555", isFirstPublish: false, manifest: manifest([{ slug: "atoms" }]) }), working(W2), pub, st, noChecks);
    expect(out.status).toBe("committed");
    expect(pub.file("study-guide/atoms.md")).toBe("# Atoms"); // kept at its last published bytes
    expect(pub.file("study-guide/gases.md")).toBeUndefined(); // removed from the manifest
  });
});

import { copyChecks, fingerprint } from "./copy-check";

describe("Publish with the copy checks (B5 as plug-ins)", () => {
  it("a chapter repeating an answer key or copying a source is kept, even if published anyway", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const key = "The pressure doubles because the volume is halved at constant temperature and amount of gas.";
    const book = Array.from({ length: 120 }, (_, k) => `bookword${k}`).join(" ");
    const W3 = { ...W, "private/instructor/key.md": key,
      "study-guide/atoms.md": `# Atoms\nHint: the pressure doubles because the volume is halved at constant temperature and amount of gas.`,
      "study-guide/gases.md": `# Gases\n${book.split(" ").slice(0, 70).join(" ")}` };
    for (const [p, t] of Object.entries(W3)) if (p.startsWith("concepts/") || p.startsWith("assessment-support/")) st.approve(p, t);
    const checks = copyChecks([{ path: "private/instructor/key.md", text: key }], [fingerprint("src_book", book)]);
    const out = await runPublish(input({ choices: { publishAnyway: ["atoms", "gases"], approveAndPublish: [] } }), working(W3), pub, st, checks);
    expect(out.status === "committed" && out.published).toEqual([]);
    expect(pub.file("study-guide/atoms.md")).toBeUndefined();
    expect(pub.file("study-guide/gases.md")).toBeUndefined();
  });
});
