/**
 * The Publish job with fakes: claims P.4–P.6, P.8, P.11–P.15, Q.6, Q.9, plus
 * the G3 round-1 findings (kept as regression tests; probes ported here).
 */
import { describe, expect, it } from "vitest";
import { copyChecks, fingerprint } from "./copy-check";
import { FakePublic, FakeStore, h, manifestJson, working } from "./publish-fakes";
import { anywayKey, approvalKey, findingsDigest, runPublish, type PublishedRecord, type UnitCheck } from "./publish-job";

const M = manifestJson([{ slug: "atoms" }, { slug: "gases" }]);
const W: Record<string, string> = {
  "concepts/atoms.md": "atoms plan", "assessment-support/atoms.md": "atoms assess", "study-guide/atoms.md": "# Atoms",
  "concepts/gases.md": "gases plan", "assessment-support/gases.md": "gases assess", "study-guide/gases.md": "# Gases",
  "private/instructor/key.md": "ANSWERS", "README.md": "readme", "alembic.json": M,
};
const noChecks: UnitCheck[] = [];
const id = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${String(n).repeat(12)}`;
const input = (over: Partial<Parameters<typeof runPublish>[0]> = {}) => ({
  runId: id(1), packageId: "pkg-1", by: "owner", role: "owner" as const, choices: { publishAnyway: [] as string[], approveAndPublish: [] as string[] }, ...over,
});
const approveAll = (st: FakeStore, files: Record<string, string>) => {
  for (const [p, t] of Object.entries(files)) if (p.startsWith("concepts/") || p.startsWith("assessment-support/")) st.approveText(p, t);
};

describe("runPublish", () => {
  it("first Publish (owner) creates the public repo; approved chapters publish, unapproved are kept; private never leaves", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    st.approveText("concepts/atoms.md", "atoms plan"); st.approveText("assessment-support/atoms.md", "atoms assess");
    const out = await runPublish(input(), working(W), pub, st, noChecks);
    expect(out.status).toBe("committed");
    expect(pub.file("study-guide/atoms.md")).toBe("# Atoms");
    expect(pub.file("study-guide/gases.md")).toBeUndefined();
    expect(pub.file("private/instructor/key.md")).toBeUndefined();
    expect(JSON.parse(pub.file("alembic.json")!)).not.toHaveProperty("privateRepo");
    expect(st.runs.get(id(1))!.status).toBe("committed");
    expect(st.ack).toBe(pub.headSha);
    expect((await pub.recentCommits())[0]!.message).toContain(`Alembic-Publish-Run: ${id(1)}`);
  });

  it("P.8 a deputy can't make the first Publish; a co-author can't publish; approve-and-publish needs approve rights", async () => {
    expect(await runPublish(input({ role: "deputy" }), working(W), new FakePublic(), new FakeStore(), noChecks)).toMatchObject({ status: "stopped" });
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    await runPublish(input(), working(W), pub, st, noChecks);
    expect(await runPublish(input({ runId: id(2), role: "co-author" }), working(W), pub, st, noChecks)).toMatchObject({ status: "stopped" });
    expect((await runPublish(input({ runId: id(3), role: "deputy" }), working(W), pub, st, noChecks)).status).toBe("committed");
  });

  it("approve-and-publish approves the plan parts at W and publishes the chapter", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const out = await runPublish(input({ choices: { publishAnyway: [], approveAndPublish: [approvalKey("concepts/atoms.md", h("atoms plan")), approvalKey("assessment-support/atoms.md", h("atoms assess"))] } }), working(W), pub, st, noChecks);
    expect(out.status === "committed" && out.published).toEqual(["atoms"]);
  });

  it("review H2: approve-and-publish covers only the version that was shown; a plan changed since stays unapproved", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    // The page showed "atoms plan"; a co-author's edit landed before the job pinned W.
    const shown = [approvalKey("concepts/atoms.md", h("atoms plan")), approvalKey("assessment-support/atoms.md", h("atoms assess"))];
    const out = await runPublish(input({ choices: { publishAnyway: [], approveAndPublish: shown } }), working({ ...W, "concepts/atoms.md": "atoms plan, changed by a co-author" }), pub, st, noChecks);
    expect(out.status === "committed" && out.published).toEqual([]);
    expect(st.approvals.has(`concepts/atoms.md@${h("atoms plan, changed by a co-author")}`)).toBe(false);
    // A bare path (the old form) approves nothing.
    const out2 = await runPublish(input({ runId: id(2), choices: { publishAnyway: [], approveAndPublish: ["concepts/gases.md", "assessment-support/gases.md"] } }), working(W), pub, st, noChecks);
    expect(out2.status === "committed" && out2.published).toEqual([]);
  });

  it("review H2: publish anyway covers only the problems that were shown", async () => {
    const st = new FakeStore(); approveAll(st, W);
    let msg = "a link looks odd";
    const odd: UnitCheck = { id: "links", async run(unit) { return unit === "chapter:atoms" ? [{ unit, path: "study-guide/atoms.md", check: "links", severity: "default", message: msg }] : []; } };
    const pub = new FakePublic();
    const first = await runPublish(input(), working(W), pub, st, [odd]);
    expect(first.status === "committed" && first.published).toEqual(["gases"]);
    const key = first.status === "committed" ? first.anywayKeys["atoms"]! : "";
    expect(key).toBe(await findingsDigest([{ unit: "chapter:atoms", path: "study-guide/atoms.md", check: "links", severity: "default", message: msg }]));
    // The problems changed before the next run: the old "publish anyway" doesn't cover the new ones.
    msg = "a different problem";
    const second = await runPublish(input({ runId: id(2), choices: { publishAnyway: [anywayKey("atoms", key)], approveAndPublish: [] } }), working(W), pub, st, [odd]);
    expect(second.status === "committed" && second.published).toEqual(["gases"]);
    const key2 = second.status === "committed" ? second.anywayKeys["atoms"]! : "";
    const third = await runPublish(input({ runId: id(3), choices: { publishAnyway: [anywayKey("atoms", key2)], approveAndPublish: [] } }), working(W), pub, st, [odd]);
    expect(third.status === "committed" && third.published.sort()).toEqual(["atoms", "gases"]);
  });

  it("review M1: a run recorded committed but never acknowledged is our own commit, not drift", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    const realAck = st.acknowledge.bind(st);
    let crash = true;
    st.acknowledge = async (...a) => { if (crash) { crash = false; throw new Error("worker died"); } return realAck(...a); };
    st.isCommitted = async (_p, runId, sha) => st.runs.get(runId)?.status === "committed" && st.runs.get(runId)?.publicSha === sha;
    await expect(runPublish(input(), working(W), pub, st, noChecks)).rejects.toThrow("worker died");
    const drift = st.drift.length;
    expect((await runPublish(input({ runId: id(2) }), working(W), pub, st, noChecks)).status).toBe("committed");
    expect(st.drift.length).toBe(drift);
  });

  it("review r2 M-A: an amended copy of our own commit (same trailer, other content) is drift, not ours", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    st.isCommitted = async (_p, runId, sha) => st.runs.get(runId)?.status === "committed" && st.runs.get(runId)?.publicSha === sha;
    await runPublish(input(), working(W), pub, st, noChecks);
    // Someone amends Alembic's commit on GitHub, keeping its message (and trailer).
    const last = pub.commits[pub.commits.length - 1]!;
    const amended = new Map(last.files); amended.set("study-guide/atoms.md", "# Atoms (amended on GitHub)");
    pub.commits.push({ sha: "amended", message: last.message, files: amended }); pub.headSha = "amended";
    const out = await runPublish(input({ runId: id(2) }), working(W), pub, st, noChecks);
    expect(out).toMatchObject({ status: "stopped", drift: ["study-guide/atoms.md"] });
  });

  it("review r2 M-A: a crashed run whose commit was changed before recording isn't recovered as ours", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    const realMark = st.markCommitted.bind(st);
    let crash = true;
    st.markCommitted = async (...a) => { if (crash) { crash = false; throw new Error("worker died"); } return realMark(...a); };
    const stopped: string[] = [];
    st.markStopped = async (runId) => { stopped.push(runId); };
    await expect(runPublish(input(), working(W), pub, st, noChecks)).rejects.toThrow("worker died");
    const last = pub.commits[pub.commits.length - 1]!;
    const changed = new Map(last.files); changed.set("study-guide/atoms.md", "# Atoms (changed)");
    pub.commits[pub.commits.length - 1] = { ...last, files: changed };
    const out = await runPublish(input({ runId: id(2) }), working(W), pub, st, noChecks);
    expect(stopped).toContain(id(1));
    expect(st.runs.get(id(1))!.status).toBe("pending"); // never recorded as committed with content it didn't write
    // Nothing was ever committed, so the head is the first Publish's baseline (G3 L3) and this run publishes W.
    expect(out.status).toBe("committed");
  });

  it("review r3 M1: a crashed run's commit amended with an extra file isn't ours: the file is brought in, not deleted", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    await runPublish(input(), working(W), pub, st, noChecks); // one committed run, so the head isn't a first-Publish baseline
    const realMark = st.markCommitted.bind(st);
    let crash = true;
    st.markCommitted = async (...a) => { if (crash) { crash = false; throw new Error("worker died"); } return realMark(...a); };
    const W2 = { ...W, "study-guide/atoms.md": "# Atoms, second" };
    await expect(runPublish(input({ runId: id(2) }), working(W2), pub, st, noChecks)).rejects.toThrow("worker died");
    const last = pub.commits[pub.commits.length - 1]!;
    const amended = new Map(last.files); amended.set("study-guide/chapters/atoms/notes.md", "added on GitHub");
    pub.commits[pub.commits.length - 1] = { ...last, files: amended };
    const out = await runPublish(input({ runId: id(3) }), working(W2), pub, st, noChecks);
    expect(st.runs.get(id(2))!.status).toBe("pending");
    expect(out).toMatchObject({ status: "stopped" });
    expect(st.drift.flat()).toContain("study-guide/chapters/atoms/notes.md");
  });

  it("review r2 L-B: a run that no longer holds its request doesn't commit", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    const out = await runPublish(input({ stillHeld: async () => false }), working(W), pub, st, noChecks);
    expect(out).toEqual({ status: "stopped", reason: "This Publish was taken over by a newer run" });
    expect(pub.commits.filter((c) => c.message.includes("Alembic-Publish-Run")).length).toBe(0);
  });

  it("review M3: Publish never writes or deletes workflow files", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    await pub.create();
    await pub.push(".github/workflows/build-site.yml", "on: push");
    expect((await runPublish(input(), working(W), pub, st, noChecks)).status).toBe("committed");
    expect(pub.file(".github/workflows/build-site.yml")).toBe("on: push");
    await expect(runPublish(input({ runId: id(2), generated: { ".github/workflows/x.yml": "on: push" } }), working(W), pub, st, noChecks)).rejects.toThrow(/not a file Publish generates/);
  });

  it("an always-finding keeps its chapter whatever the choices", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    const leak: UnitCheck = { id: "answer-key", async run(unit) { return unit === "chapter:atoms" ? [{ unit, check: "answer-key", severity: "always", message: "matches an answer key" }] : []; } };
    const out = await runPublish(input({ choices: { publishAnyway: ["atoms"], approveAndPublish: [] } }), working(W), pub, st, [leak]);
    expect(out.status === "committed" && out.published).toEqual(["gases"]);
  });

  it("drift on GitHub is brought in and the run stops; the next run proceeds", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    await runPublish(input(), working(W), pub, st, noChecks);
    await pub.push("study-guide/atoms.md", "# Atoms (edited on GitHub)");
    expect(await runPublish(input({ runId: id(2) }), working(W), pub, st, noChecks)).toMatchObject({ status: "stopped", drift: ["study-guide/atoms.md"] });
    expect((await runPublish(input({ runId: id(3) }), working(W), pub, st, noChecks)).status).toBe("committed");
  });

  it("a crash after the public commit is completed from the trailer, not treated as drift", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    const realMark = st.markCommitted.bind(st);
    let crash = true;
    st.markCommitted = async (...a) => { if (crash) { crash = false; throw new Error("worker died"); } return realMark(...a); };
    await expect(runPublish(input(), working(W), pub, st, noChecks)).rejects.toThrow("worker died");
    expect((await runPublish(input({ runId: id(4) }), working(W), pub, st, noChecks)).status).toBe("committed");
    expect(st.drift).toHaveLength(0);
    expect(st.runs.get(id(1))!.status).toBe("committed");
  });

  it("refuses symlinks, submodules and truncated trees", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    expect(await runPublish(input(), working(W, [{ path: "study-guide/key.md", mode: "120000", blobSha: "x" }]), pub, st, noChecks)).toMatchObject({ status: "stopped" });
    expect(await runPublish(input(), working(W, [], true), pub, st, noChecks)).toMatchObject({ status: "stopped" });
    expect(pub.headSha).toBeNull();
  });

  it("a later run removes chapters that left the manifest and keeps kept chapters' old bytes", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    await runPublish(input(), working(W), pub, st, noChecks);
    const W2 = { ...W, "study-guide/atoms.md": "# Atoms v2", "concepts/atoms.md": "atoms plan v2", "alembic.json": manifestJson([{ slug: "atoms" }]) };
    expect((await runPublish(input({ runId: id(5) }), working(W2), pub, st, noChecks)).status).toBe("committed");
    expect(pub.file("study-guide/atoms.md")).toBe("# Atoms");
    expect(pub.file("study-guide/gases.md")).toBeUndefined();
  });

  it("a lost compare-and-swap is retried", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    await runPublish(input(), working(W), pub, st, noChecks);
    pub.moveOnce = true;
    expect((await runPublish(input({ runId: id(6) }), working(W), pub, st, noChecks)).status).toBe("committed");
  });
});

describe("G3 round 1 (regression)", () => {
  it("H1 the manifest is read at W: a chapter that is Draft there is not published", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    const atW = { ...W, "alembic.json": manifestJson([{ slug: "atoms" }, { slug: "gases", mode: "draft" }]) };
    await runPublish(input(), working(atW), pub, st, noChecks);
    expect(pub.file("study-guide/gases.md")).toBeUndefined();
  });

  it("H1 an unreadable manifest stops the run (fail closed)", async () => {
    expect(await runPublish(input(), working({ ...W, "alembic.json": "{" }), new FakePublic(), new FakeStore(), noChecks)).toMatchObject({ status: "stopped" });
  });

  it("H2 every record carries the public blob id; kept files round-trip by blob as the table stores them", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    let intended: PublishedRecord[] = [];
    const real = st.insertPendingRun.bind(st);
    st.insertPendingRun = async (r) => { intended = r.intendedFiles; return real(r); };
    await runPublish(input(), working(W), pub, st, noChecks);
    expect(intended.filter((r) => !r.blobSha)).toEqual([]);
    const W2 = { ...W, "study-guide/atoms.md": "# Atoms v2", "concepts/atoms.md": "atoms plan v2" };
    await runPublish(input({ runId: id(2) }), working(W2), pub, st, noChecks);
    expect(pub.file("study-guide/atoms.md")).toBe("# Atoms");
  });

  it("H3 an asset deleted at W and used by no kept chapter leaves the public repo", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    await runPublish(input(), working({ ...W, "assets/fig.svg": "<svg/>" }), pub, st, noChecks);
    expect(pub.file("assets/fig.svg")).toBe("<svg/>");
    await runPublish(input({ runId: id(2) }), working(W), pub, st, noChecks);
    expect(pub.file("assets/fig.svg")).toBeUndefined();
  });

  it("H3 a deleted asset a kept chapter still links to stays", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    const W1 = { ...W, "assets/fig.svg": "<svg/>", "study-guide/atoms.md": "# Atoms ![f](../assets/fig.svg)" };
    await runPublish(input(), working(W1), pub, st, noChecks);
    const W2 = { ...W, "study-guide/atoms.md": "# Atoms v2", "concepts/atoms.md": "plan v2" }; // atoms kept, fig deleted
    await runPublish(input({ runId: id(2) }), working(W2), pub, st, noChecks);
    expect(pub.file("assets/fig.svg")).toBe("<svg/>");
  });

  it("M2 a text file that can't be read stops the run instead of skipping the checks", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    const files = { ...W, "study-guide/chapters/atoms/key.md": "ANSWERS" };
    expect(await runPublish(input(), working(files, [], false, ["study-guide/chapters/atoms/key.md"]), pub, st, noChecks)).toMatchObject({ status: "stopped" });
  });

  it("M3 a new projectable file added on GitHub is brought in", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    await runPublish(input(), working(W), pub, st, noChecks);
    await pub.push("study-guide/chapters/atoms/contributed.md", "a fix");
    expect((await runPublish(input({ runId: id(2) }), working(W), pub, st, noChecks)).status).toBe("stopped");
    expect(st.drift.flat()).toContain("study-guide/chapters/atoms/contributed.md");
  });

  it("L3 a first Publish that crashed right after creating the repo doesn't look like drift", async () => {
    const pub = new FakePublic(); const st = new FakeStore(); approveAll(st, W);
    await pub.create();
    expect((await runPublish(input(), working(W), pub, st, noChecks)).status).toBe("committed");
  });
});

describe("Publish with the copy checks (B5 as plug-ins)", () => {
  it("a chapter repeating an answer key or copying a source is kept, even if published anyway", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const key = "The pressure doubles because the volume is halved at constant temperature and amount of gas.";
    const book = Array.from({ length: 120 }, (_, k) => `bookword${k}`).join(" ");
    const W3 = { ...W, "private/instructor/key.md": key,
      "study-guide/atoms.md": `# Atoms\n<!-- ${key} -->`,
      "study-guide/gases.md": `# Gases\n${book.split(" ").slice(0, 70).join(" ")}` };
    approveAll(st, W3);
    const checks = copyChecks([{ path: "private/instructor/key.md", text: key }], [fingerprint("src_book", book)]);
    const out = await runPublish(input({ choices: { publishAnyway: ["atoms", "gases"], approveAndPublish: [] } }), working(W3), pub, st, checks);
    expect(out.status === "committed" && out.published).toEqual([]);
  });
});
