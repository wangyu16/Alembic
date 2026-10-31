/**
 * The Publish job with fakes: claims P.4–P.6, P.8, P.11–P.15, Q.6, Q.9, plus
 * the G3 round-1 findings (kept as regression tests; probes ported here).
 * Publish by file status (family SITE-TYPE-CONTRACT §7, K1.23): a page goes out
 * when it is completed; a draft published before stays at its last published
 * version; any other public file goes out as it is unless withdrawn.
 */
import { describe, expect, it } from "vitest";
import { cleanSvg } from "@alembic/package-contract";
import { FakePublic, FakeStore, h, manifestJson, working } from "./publish-fakes";
import { READ_CONCURRENCY, runPublish, type PublishedRecord, type WorkingSide } from "./publish-job";

type Status = Record<string, "completed" | "withdrawn">;
/** The working manifest with a `status` map. */
const manifest = (chs: Array<{ slug: string }>, status: Status = {}) => JSON.stringify({ ...JSON.parse(manifestJson(chs)), status });
const pagesOf = (slug: string) => [`concepts/${slug}.md`, `assessment-support/${slug}.md`, `study-guide/${slug}.md`];
const completed = (paths: string[]): Status => Object.fromEntries(paths.map((p) => [p, "completed" as const]));
const ALL = completed([...pagesOf("atoms"), ...pagesOf("gases"), "README.md"]);
/** Every page completed except these (set back to draft). */
const allBut = (...draft: string[]): Status => Object.fromEntries(Object.entries(ALL).filter(([p]) => !draft.includes(p)));

const CH = [{ slug: "atoms" }, { slug: "gases" }];
const M = manifest(CH, ALL);
const W: Record<string, string> = {
  "concepts/atoms.md": "atoms plan", "assessment-support/atoms.md": "atoms assess", "study-guide/atoms.md": "# Atoms",
  "concepts/gases.md": "gases plan", "assessment-support/gases.md": "gases assess", "study-guide/gases.md": "# Gases",
  "private/instructor/key.md": "ANSWERS", "README.md": "readme", "alembic.json": M,
};
const id = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${String(n).repeat(12)}`;
const input = (over: Partial<Parameters<typeof runPublish>[0]> = {}) => ({
  runId: id(1), packageId: "pkg-1", by: "owner", role: "owner" as const, ...over,
});
const cleanMarkdown = (_p: string, t: string) => t.includes("REFUSE") ? { ok: false as const, reason: "it contains raw HTML that can't be published safely" }
  : t.includes("<img") ? { ok: true as const, text: t.replace("<img", "&lt;img"), escaped: 1 } : { ok: true as const, text: t, escaped: 0 };

/** A store whose bring-in copies the public files into the working files (as the system queue row would). */
function bringingStore(pub: FakePublic, files: Record<string, string>, onBring?: () => Promise<void>) {
  const st = new FakeStore();
  st.bringInDrift = async (_p, sha, paths) => {
    st.drift.push(paths);
    for (const p of paths) {
      const t = await pub.readText(sha, p);
      if (t === null) delete files[p]; else files[p] = t;
    }
    await onBring?.();
    return "done";
  };
  return st;
}

describe("the course-website add-on at Publish (K1.30)", () => {
  const files = (addon: Record<string, unknown>) => ({
    ...W, "home.md": "# Welcome", "current/fall-2026/syllabus.md": "fall syllabus", "current/spring-2026/syllabus.md": "old syllabus",
    "alembic.json": JSON.stringify({ ...JSON.parse(manifest(CH, { ...ALL, "home.md": "completed", "current/fall-2026/syllabus.md": "completed", "current/spring-2026/syllabus.md": "completed" })), ...addon }),
  });
  it("[K1.30] with the add-on on, the home page and only the current term's pages go out; with it off, none of them", async () => {
    const pub = new FakePublic();
    await runPublish(input(), working(files({ addons: ["course-website"], terms: [{ slug: "spring-2026", title: "Spring 2026" }, { slug: "fall-2026", title: "Fall 2026" }], currentTerm: "fall-2026" })), pub, new FakeStore());
    expect(pub.file("home.md")).toBe("# Welcome");
    expect(pub.file("current/fall-2026/syllabus.md")).toBe("fall syllabus");
    expect(pub.file("current/spring-2026/syllabus.md")).toBeUndefined();
    const pub2 = new FakePublic();
    await runPublish(input(), working(files({})), pub2, new FakeStore());
    expect(pub2.file("home.md")).toBeUndefined();
    expect(pub2.file("current/fall-2026/syllabus.md")).toBeUndefined();
  });
});

describe("runPublish", () => {
  it("[K1.20] Publish writes each Markdown text as its clean copy, lists the files whose HTML became text, and leaves out one it can't clean", async () => {
    const st = new FakeStore(); const pub = new FakePublic();
    const out = await runPublish(input({ cleanMarkdown }), working({ ...W, "study-guide/atoms.md": "# Atoms <img src=x onerror=1>", "study-guide/gases.md": "# Gases REFUSE" }), pub, st);
    expect(out).toMatchObject({ status: "committed", htmlAsText: ["study-guide/atoms.md"], leftOut: ["study-guide/gases.md"] });
    expect(pub.file("study-guide/atoms.md")).toBe("# Atoms &lt;img src=x onerror=1>");
    expect(pub.file("study-guide/gases.md")).toBeUndefined();
  });

  it("[K1.11] every SVG is published as the clean copy the check read: comments and declarations gone, values re-escaped", async () => {
    const st = new FakeStore(); const pub = new FakePublic();
    const src = '<?xml version="1.0"?>\n<!-- made by a tool --><svg xmlns="http://www.w3.org/2000/svg" viewBox=\'0 0 1 1\'><path d="M0 0"/></svg>';
    await runPublish(input(), working({ ...W, "assets/atoms/x.svg": src }), pub, st);
    expect(pub.file("assets/atoms/x.svg")).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0"/></svg>\n');
  });

  it("[K1.23] each published file records the working-copy blob it came from, also when the public copy is a clean copy", async () => {
    const st = new FakeStore(); const pub = new FakePublic();
    await runPublish(input(), working({ ...W, "assets/atoms/x.svg": '<!-- tool --><svg viewBox="0 0 1 1"/>' }), pub, st);
    const svg = st.files.find((f) => f.path === "assets/atoms/x.svg")!;
    expect(svg.sourceBlob).toBe("wb-assets/atoms/x.svg"); // the source in the working copy
    expect(svg.blobSha).not.toBe(svg.sourceBlob); // the public copy is the clean copy
    expect(st.files.find((f) => f.path === "study-guide/atoms.md")!.sourceBlob).toBe("wb-study-guide/atoms.md");
  });

  it("[K1.11] a file published before the safety rule leaves even when a draft page kept at its published version still links to it (audit r4 MEDIUM-A)", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const W1 = { ...W, "study-guide/atoms.md": "# Atoms ![f](atoms-fig.svg) [s](atoms.html)" };
    await runPublish(input(), working(W1), pub, st);
    // As if an earlier, unchecked Publish had put these in the atoms chapter.
    const head = pub.commits.at(-1)!;
    head.files.set("study-guide/atoms.html", "<script>x()</script>");
    head.files.set("study-guide/atoms-fig.svg", '<svg onload="x()"/>');
    st.files.push(
      { path: "study-guide/atoms.html", unit: "chapter:atoms", blobSha: h("<script>x()</script>"), version: null },
      { path: "study-guide/atoms-fig.svg", unit: "chapter:atoms", blobSha: h('<svg onload="x()"/>'), version: null });
    // The atoms page is a draft again: its published version is kept as it was.
    const W2 = { ...W1, "study-guide/atoms.md": "# Atoms v2", "alembic.json": manifest(CH, allBut("study-guide/atoms.md")) };
    const out = await runPublish(input({ runId: id(2) }), working(W2), pub, st);
    expect(out).toMatchObject({ status: "committed", kept: ["study-guide/atoms.md"] });
    expect(pub.file("study-guide/atoms.html")).toBeUndefined();
    expect(pub.file("study-guide/atoms-fig.svg")).toBeUndefined();
    expect(pub.file("study-guide/atoms.md")).toBe("# Atoms ![f](atoms-fig.svg) [s](atoms.html)"); // the kept page itself stays
  });

  it("[K1.11] a file the website can't serve safely (.html, .js) is left out and said so; never reaches the public copy (audit r3 HIGH-1)", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const out = await runPublish(input(), working({ ...W, "metadata/evidence/page.html": "<script>x()</script>", "assets/run.js": "x()" }), pub, st);
    expect(out.status).toBe("committed");
    expect(out.status === "committed" && [...(out.leftOut ?? [])].sort()).toEqual(["assets/run.js", "metadata/evidence/page.html"]);
    expect(pub.file("metadata/evidence/page.html")).toBeUndefined();
    expect(pub.file("assets/run.js")).toBeUndefined();
  });

  it("[K1.11] an unsafe SVG is left out and named, the rest publishes; a safe one is published", async () => {
    const pub1 = new FakePublic();
    const bad = await runPublish(input(), working({ ...W, "assets/atoms/x.svg": '<svg onload="alert(1)"/>' }), pub1, new FakeStore());
    expect(bad).toMatchObject({ status: "committed", leftOut: ["assets/atoms/x.svg"] });
    expect(pub1.file("assets/atoms/x.svg")).toBeUndefined();
    expect(pub1.file("study-guide/atoms.md")).toBe("# Atoms");
    const pub2 = new FakePublic();
    const ok = await runPublish(input(), working({ ...W, "assets/atoms/x.svg": '<svg viewBox="0 0 1 1"/>' }), pub2, new FakeStore());
    expect(ok.status).toBe("committed");
    expect(pub2.file("assets/atoms/x.svg")).toBe(cleanSvg('<svg viewBox="0 0 1 1"/>'));
  });

  it("first Publish (owner) creates the public repo; completed pages publish, draft pages never published stay off; private never leaves", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const out = await runPublish(input(), working({ ...W, "alembic.json": manifest(CH, completed(pagesOf("atoms"))) }), pub, st);
    expect(out).toMatchObject({ status: "committed", published: ["atoms"], kept: [] });
    expect(pub.file("study-guide/atoms.md")).toBe("# Atoms");
    expect(pub.file("study-guide/gases.md")).toBeUndefined();
    expect(pub.file("README.md")).toBeUndefined();
    expect(pub.file("private/instructor/key.md")).toBeUndefined();
    expect(JSON.parse(pub.file("alembic.json")!)).not.toHaveProperty("privateRepo");
    expect(JSON.parse(pub.file("alembic.json")!)).not.toHaveProperty("status");
    expect(st.runs.get(id(1))!.status).toBe("committed");
    expect(st.ack).toBe(pub.headSha);
    expect((await pub.recentCommits())[0]!.message).toContain(`Alembic-Publish-Run: ${id(1)}`);
  });

  it("P.8 a deputy can't make the first Publish; a co-author can't publish; a deputy publishes after the first", async () => {
    expect(await runPublish(input({ role: "deputy" }), working(W), new FakePublic(), new FakeStore())).toMatchObject({ status: "stopped" });
    const pub = new FakePublic(); const st = new FakeStore();
    await runPublish(input(), working(W), pub, st);
    expect(await runPublish(input({ runId: id(2), role: "co-author" }), working(W), pub, st)).toMatchObject({ status: "stopped" });
    expect((await runPublish(input({ runId: id(3), role: "deputy" }), working(W), pub, st)).status).toBe("committed");
  });

  it("review M1: a run recorded committed but never acknowledged is our own commit, not drift", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const realAck = st.acknowledge.bind(st);
    let crash = true;
    st.acknowledge = async (...a) => { if (crash) { crash = false; throw new Error("worker died"); } return realAck(...a); };
    st.isCommitted = async (_p, runId, sha) => st.runs.get(runId)?.status === "committed" && st.runs.get(runId)?.publicSha === sha;
    await expect(runPublish(input(), working(W), pub, st)).rejects.toThrow("worker died");
    const drift = st.drift.length;
    expect((await runPublish(input({ runId: id(2) }), working(W), pub, st)).status).toBe("committed");
    expect(st.drift.length).toBe(drift);
  });

  it("review r2 M-A: an amended copy of our own commit (same trailer, other content) is drift, not ours: it is brought in", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    st.isCommitted = async (_p, runId, sha) => st.runs.get(runId)?.status === "committed" && st.runs.get(runId)?.publicSha === sha;
    await runPublish(input(), working(W), pub, st);
    // Someone amends Alembic's commit on GitHub, keeping its message (and trailer).
    const last = pub.commits[pub.commits.length - 1]!;
    const amended = new Map(last.files); amended.set("study-guide/atoms.md", "# Atoms (amended on GitHub)");
    pub.commits.push({ sha: "amended", message: last.message, files: amended }); pub.headSha = "amended";
    const out = await runPublish(input({ runId: id(2) }), working(W), pub, st);
    expect(st.drift).toEqual([["study-guide/atoms.md"]]);
    expect(out).toMatchObject({ status: "committed", broughtIn: ["study-guide/atoms.md"] });
  });

  it("review r2 M-A: a crashed run whose commit was changed before recording isn't recovered as ours", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const realMark = st.markCommitted.bind(st);
    let crash = true;
    st.markCommitted = async (...a) => { if (crash) { crash = false; throw new Error("worker died"); } return realMark(...a); };
    const stopped: string[] = [];
    st.markStopped = async (runId) => { stopped.push(runId); };
    await expect(runPublish(input(), working(W), pub, st)).rejects.toThrow("worker died");
    const last = pub.commits[pub.commits.length - 1]!;
    const changed = new Map(last.files); changed.set("study-guide/atoms.md", "# Atoms (changed)");
    pub.commits[pub.commits.length - 1] = { ...last, files: changed };
    const out = await runPublish(input({ runId: id(2) }), working(W), pub, st);
    expect(stopped).toContain(id(1));
    expect(st.runs.get(id(1))!.status).toBe("pending"); // never recorded as committed with content it didn't write
    // Nothing was ever committed, so the head is the first Publish's baseline (G3 L3) and this run publishes W.
    expect(out.status).toBe("committed");
  });

  it("review r3 M1: a crashed run's commit amended with an extra file isn't ours: the file is brought in, not deleted", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    await runPublish(input(), working(W), pub, st); // one committed run, so the head isn't a first-Publish baseline
    const realMark = st.markCommitted.bind(st);
    let crash = true;
    st.markCommitted = async (...a) => { if (crash) { crash = false; throw new Error("worker died"); } return realMark(...a); };
    const W2 = { ...W, "study-guide/atoms.md": "# Atoms, second" };
    await expect(runPublish(input({ runId: id(2) }), working(W2), pub, st)).rejects.toThrow("worker died");
    const last = pub.commits[pub.commits.length - 1]!;
    const amended = new Map(last.files); amended.set("study-guide/chapters/atoms/notes.md", "added on GitHub");
    pub.commits[pub.commits.length - 1] = { ...last, files: amended };
    const out = await runPublish(input({ runId: id(3) }), working(W2), pub, st);
    expect(st.runs.get(id(2))!.status).toBe("pending");
    expect(st.drift.flat()).toContain("study-guide/chapters/atoms/notes.md");
    expect(out.status === "committed" && out.broughtIn).toContain("study-guide/chapters/atoms/notes.md");
  });

  it("a Publish with nothing new records the run on the current head, without an empty commit", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const first = await runPublish(input(), working(W), pub, st);
    const commits = pub.commits.length;
    const again = await runPublish(input({ runId: id(2) }), working(W), pub, st);
    expect(again).toMatchObject({ status: "committed", unchanged: true, publicSha: first.status === "committed" ? first.publicSha : "" });
    expect(pub.commits.length).toBe(commits);
    expect(st.runs.get(id(2))!.status).toBe("committed");
    // A change to a draft page never published is nothing new either.
    const draft = await runPublish(input({ runId: id(3) }), working({ ...W, "study-guide/chapters/atoms/new.md": "# New" }), pub, st);
    expect(draft).toMatchObject({ status: "committed", unchanged: true });
    // A real change still commits.
    const third = await runPublish(input({ runId: id(4) }), working({ ...W, "study-guide/atoms.md": "# Atoms, changed" }), pub, st);
    expect(third.status === "committed" && third.unchanged).toBeFalsy();
    expect(pub.commits.length).toBe(commits + 1);
  });

  it("[RC.2] a real-size course is read in parallel, never more than READ_CONCURRENCY at once, with the same result", async () => {
    // 19 chapters x 4 pages, like General Chemistry.
    const slugs = Array.from({ length: 19 }, (_, k) => `ch${k}`);
    const status: Status = {};
    const files: Record<string, string> = {};
    for (const s2 of slugs) for (const sp of ["concepts", "assessment-support", "study-guide", "practice"]) { files[`${sp}/${s2}.md`] = `# ${sp} ${s2}`; status[`${sp}/${s2}.md`] = "completed"; }
    files["alembic.json"] = manifest(slugs.map((slug) => ({ slug })), status);
    const base = working(files);
    let inFlight = 0, peak = 0, reads = 0;
    const slow: WorkingSide = { ...base, async readFile(sha, p) { inFlight++; reads++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 2)); inFlight--; return base.readFile(sha, p); } };
    const out = await runPublish(input(), slow, new FakePublic(), new FakeStore());
    expect(out.status === "committed" && out.published.length).toBe(19);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(READ_CONCURRENCY);
    expect(reads).toBeLessThanOrEqual(19 * 4 + 1); // each file read once (the manifest once more)
  });

  it("review r2 L-B: a run that no longer holds its request doesn't commit", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const out = await runPublish(input({ stillHeld: async () => false }), working(W), pub, st);
    expect(out).toEqual({ status: "stopped", reason: "This Publish was taken over by a newer run" });
    expect(pub.commits.filter((c) => c.message.includes("Alembic-Publish-Run")).length).toBe(0);
  });

  it("review M3: Publish never writes or deletes workflow files", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    await pub.create();
    await pub.push(".github/workflows/build-site.yml", "on: push");
    expect((await runPublish(input(), working(W), pub, st)).status).toBe("committed");
    expect(pub.file(".github/workflows/build-site.yml")).toBe("on: push");
    await expect(runPublish(input({ runId: id(2), generated: { ".github/workflows/x.yml": "on: push" } }), working(W), pub, st)).rejects.toThrow(/not a file Publish generates/);
  });

  it("a crash after the public commit is completed from the trailer, not treated as drift", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const realMark = st.markCommitted.bind(st);
    let crash = true;
    st.markCommitted = async (...a) => { if (crash) { crash = false; throw new Error("worker died"); } return realMark(...a); };
    await expect(runPublish(input(), working(W), pub, st)).rejects.toThrow("worker died");
    expect((await runPublish(input({ runId: id(4) }), working(W), pub, st)).status).toBe("committed");
    expect(st.drift).toHaveLength(0);
    expect(st.runs.get(id(1))!.status).toBe("committed");
  });

  it("refuses symlinks, submodules and truncated trees", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    expect(await runPublish(input(), working(W, [{ path: "study-guide/key.md", mode: "120000", blobSha: "x" }]), pub, st)).toMatchObject({ status: "stopped" });
    expect(await runPublish(input(), working(W, [], true), pub, st)).toMatchObject({ status: "stopped" });
    expect(pub.headSha).toBeNull();
  });

  it("a later run removes chapters that left the manifest and keeps draft pages' old bytes", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    await runPublish(input(), working(W), pub, st);
    const W2 = { ...W, "study-guide/atoms.md": "# Atoms v2", "concepts/atoms.md": "atoms plan v2", "alembic.json": manifest([{ slug: "atoms" }], allBut("study-guide/atoms.md")) };
    const out = await runPublish(input({ runId: id(5) }), working(W2), pub, st);
    expect(out).toMatchObject({ status: "committed", published: ["atoms"], kept: ["study-guide/atoms.md"] });
    expect(pub.file("study-guide/atoms.md")).toBe("# Atoms");
    expect(pub.file("concepts/atoms.md")).toBe("atoms plan v2");
    expect(pub.file("study-guide/gases.md")).toBeUndefined();
  });

  it("a lost compare-and-swap is retried", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    await runPublish(input(), working(W), pub, st);
    pub.moveOnce = true;
    expect((await runPublish(input({ runId: id(6) }), working({ ...W, "study-guide/atoms.md": "# Atoms v2" }), pub, st)).status).toBe("committed");
    expect(pub.file("study-guide/atoms.md")).toBe("# Atoms v2");
  });
});

describe("[K1.23] Publish by file status", () => {
  it("[K1.23] an unsafe SVG and a text whose raw HTML can't be cleaned are left out; the rest publishes", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const files = { ...W, "assets/atoms/bad.svg": '<svg onload="alert(1)"/>', "assets/atoms/good.svg": "<svg/>", "study-guide/gases.md": "# Gases <div onclick=x>REFUSE</div>" };
    const out = await runPublish(input({ cleanMarkdown }), working(files), pub, st);
    expect(out.status).toBe("committed");
    expect(out.status === "committed" && [...(out.leftOut ?? [])].sort()).toEqual(["assets/atoms/bad.svg", "study-guide/gases.md"]);
    expect(out.status === "committed" && out.published.sort()).toEqual(["atoms", "gases"]); // gases' other pages still go out
    expect(pub.file("assets/atoms/bad.svg")).toBeUndefined();
    expect(pub.file("study-guide/gases.md")).toBeUndefined();
    expect(pub.file("assets/atoms/good.svg")).toBe(cleanSvg("<svg/>"));
    expect(pub.file("study-guide/atoms.md")).toBe("# Atoms");
    expect(pub.file("concepts/gases.md")).toBe("gases plan");
  });

  it("[K1.23] drift is brought in and published in the same run (the outcome has broughtIn); files under an unknown chapter are brought in but stay unplaced and unpublished", async () => {
    const pub = new FakePublic(); const files = { ...W }; const st = bringingStore(pub, files);
    await runPublish(input(), working(files), pub, st);
    await pub.push("study-guide/atoms.md", "# Atoms (fixed on GitHub)");
    await pub.push("study-guide/chapters/kinetics/contributed.md", "a contributor's new chapter");
    const commits = pub.commits.length;
    const out = await runPublish(input({ runId: id(2) }), working(files), pub, st);
    expect(out.status).toBe("committed");
    expect(out.status === "committed" && [...(out.broughtIn ?? [])].sort()).toEqual(["study-guide/atoms.md", "study-guide/chapters/kinetics/contributed.md"]);
    expect(out.status === "committed" && out.published).not.toContain("kinetics");
    expect(files["study-guide/chapters/kinetics/contributed.md"]).toBe("a contributor's new chapter"); // kept in the course
    expect(pub.file("study-guide/atoms.md")).toBe("# Atoms (fixed on GitHub)"); // a completed page: published as brought in
    expect(pub.file("study-guide/chapters/kinetics/contributed.md")).toBeUndefined(); // unplaced: not published
    expect(pub.commits.length).toBe(commits + 1);
    expect(st.ack).toBe(pub.headSha);
  });

  it("[K1.23] a second drift while the brought-in changes are being published stops the run", async () => {
    const pub = new FakePublic(); const files = { ...W };
    let again = true;
    const st = bringingStore(pub, files, async () => { if (again) { again = false; await pub.push("README.md", "readme, edited again"); } });
    await runPublish(input(), working(files), pub, st);
    await pub.push("study-guide/atoms.md", "# Atoms (fixed on GitHub)");
    const out = await runPublish(input({ runId: id(2) }), working(files), pub, st);
    expect(out).toMatchObject({ status: "stopped", reason: expect.stringMatching(/keeps changing/), drift: ["README.md"] });
  });

  it("[K1.23] a withdrawn page published before is deleted from the public repo (and a withdrawn figure too)", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const W1 = { ...W, "assets/fig.png": "PNG" };
    await runPublish(input(), working(W1), pub, st);
    expect(pub.file("study-guide/gases.md")).toBe("# Gases");
    expect(pub.file("assets/fig.png")).toBe("PNG");
    const W2 = { ...W1, "alembic.json": manifest(CH, { ...ALL, "study-guide/gases.md": "withdrawn", "assets/fig.png": "withdrawn" }) };
    const out = await runPublish(input({ runId: id(2) }), working(W2), pub, st);
    expect(out).toMatchObject({ status: "committed", kept: [] });
    expect(pub.file("study-guide/gases.md")).toBeUndefined();
    expect(pub.file("assets/fig.png")).toBeUndefined();
    expect(pub.file("concepts/gases.md")).toBe("gases plan");
  });

  it("[K1.23] a draft page published before keeps its old bytes and is listed in kept; a draft never published stays off", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    await runPublish(input(), working(W), pub, st);
    const W2 = { ...W, "study-guide/atoms.md": "# Atoms, half rewritten", "study-guide/chapters/atoms/extra.md": "# Extra, a draft",
      "alembic.json": manifest(CH, allBut("study-guide/atoms.md")) };
    const out = await runPublish(input({ runId: id(2) }), working(W2), pub, st);
    expect(out).toMatchObject({ status: "committed", kept: ["study-guide/atoms.md"] });
    expect(out.status === "committed" && out.published.sort()).toEqual(["atoms", "gases"]);
    expect(pub.file("study-guide/atoms.md")).toBe("# Atoms");
    expect(pub.file("study-guide/chapters/atoms/extra.md")).toBeUndefined();
  });

  it("[K1.23] provenance/coursewerk/ files are published as they are, with no status", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const prov = { "provenance/coursewerk/sources.json": '{"sources":[]}\n', "provenance/coursewerk/log.md": "# Log\n- drafted\n" };
    const out = await runPublish(input(), working({ ...W, ...prov, "alembic.json": manifest(CH, {}) }), pub, st);
    expect(out).toMatchObject({ status: "committed", published: [] }); // every page is a draft
    expect(pub.file("provenance/coursewerk/sources.json")).toBe(prov["provenance/coursewerk/sources.json"]);
    expect(pub.file("provenance/coursewerk/log.md")).toBe(prov["provenance/coursewerk/log.md"]);
    expect(pub.file("study-guide/atoms.md")).toBeUndefined();
  });
});

describe("G3 round 1 (regression)", () => {
  it("H1 the manifest is read at W: a page that is a draft there is not published", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const atW = { ...W, "alembic.json": manifest(CH, allBut("study-guide/gases.md")) };
    await runPublish(input(), working(atW), pub, st);
    expect(pub.file("study-guide/gases.md")).toBeUndefined();
    expect(pub.file("concepts/gases.md")).toBe("gases plan");
  });

  it("H1 an unreadable manifest stops the run (fail closed)", async () => {
    expect(await runPublish(input(), working({ ...W, "alembic.json": "{" }), new FakePublic(), new FakeStore())).toMatchObject({ status: "stopped" });
  });

  it("H2 every record carries the public blob id; kept files round-trip by blob as the table stores them", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    let intended: PublishedRecord[] = [];
    const real = st.insertPendingRun.bind(st);
    st.insertPendingRun = async (r) => { intended = r.intendedFiles; return real(r); };
    await runPublish(input(), working(W), pub, st);
    expect(intended.length).toBeGreaterThan(0);
    expect(intended.filter((r) => !r.blobSha)).toEqual([]);
    const W2 = { ...W, "study-guide/atoms.md": "# Atoms v2", "concepts/atoms.md": "atoms plan v2", "alembic.json": manifest(CH, allBut("study-guide/atoms.md")) };
    await runPublish(input({ runId: id(2) }), working(W2), pub, st);
    expect(intended.filter((r) => !r.blobSha)).toEqual([]);
    expect(pub.file("study-guide/atoms.md")).toBe("# Atoms");
  });

  it("H3 an asset deleted at W and used by no kept page leaves the public repo", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    await runPublish(input(), working({ ...W, "assets/fig.svg": "<svg/>" }), pub, st);
    expect(pub.file("assets/fig.svg")).toBe(cleanSvg("<svg/>"));
    await runPublish(input({ runId: id(2) }), working(W), pub, st);
    expect(pub.file("assets/fig.svg")).toBeUndefined();
  });

  it("H3 a deleted asset a kept draft page still links to stays", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const W1 = { ...W, "assets/fig.svg": "<svg/>", "study-guide/atoms.md": "# Atoms ![f](../assets/fig.svg)" };
    await runPublish(input(), working(W1), pub, st);
    const W2 = { ...W, "study-guide/atoms.md": "# Atoms v2", "alembic.json": manifest(CH, allBut("study-guide/atoms.md")) }; // atoms kept, fig deleted
    await runPublish(input({ runId: id(2) }), working(W2), pub, st);
    expect(pub.file("assets/fig.svg")).toBe(cleanSvg("<svg/>"));
  });

  it("M2 a completed page that can't be read stops the run instead of skipping it; a draft isn't read at all", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    const files = { ...W, "study-guide/chapters/atoms/key.md": "ANSWERS" };
    expect(await runPublish(input(), working(files, [], false, ["study-guide/atoms.md"]), pub, st)).toMatchObject({ status: "stopped" });
    expect(await runPublish(input({ runId: id(2) }), working(files, [], false, ["study-guide/chapters/atoms/key.md"]), pub, st)).toMatchObject({ status: "committed" });
  });
  it("[K1.23] a completed page that can't be made safe keeps its last published version and is named as left out", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    await runPublish({ ...input(), cleanMarkdown }, working(W), pub, st);
    const files = { ...W, "study-guide/atoms.md": "# Atoms REFUSE" };
    const out = await runPublish({ ...input({ runId: id(2) }), cleanMarkdown }, working(files), pub, st);
    expect(out).toMatchObject({ status: "committed", leftOut: ["study-guide/atoms.md"], kept: ["study-guide/atoms.md"] });
    expect(pub.file("study-guide/atoms.md")).toBe("# Atoms");
  });

  it("M3 a new projectable file added on GitHub is brought in", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    await runPublish(input(), working(W), pub, st);
    await pub.push("study-guide/chapters/atoms/contributed.md", "a fix");
    const out = await runPublish(input({ runId: id(2) }), working(W), pub, st);
    expect(st.drift.flat()).toContain("study-guide/chapters/atoms/contributed.md");
    expect(out).toMatchObject({ status: "committed", broughtIn: ["study-guide/chapters/atoms/contributed.md"] });
  });

  it("L3 a first Publish that crashed right after creating the repo doesn't look like drift", async () => {
    const pub = new FakePublic(); const st = new FakeStore();
    await pub.create();
    expect((await runPublish(input(), working(W), pub, st)).status).toBe("committed");
  });
});
