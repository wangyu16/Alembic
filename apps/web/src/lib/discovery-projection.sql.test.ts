/**
 * Track A.1 — the discovery projection, against a real Postgres (PGlite with
 * every migration applied). Adversarial first: nothing private, current,
 * trial, archived, unlisted or unshared may ever enter the projection or be
 * readable through it — whichever way the base tables change.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asRole,
  freshDatabase,
  listPackage,
  seedDoc,
  seedPackage,
  seedUser,
} from "./discovery-pglite";

let db: PGlite;
let owner: string;

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

async function courseIds(): Promise<string[]> {
  const { rows } = await db.query<{ package_id: string }>(
    `select package_id from public.discovery_courses order by package_id`,
  );
  return rows.map((r) => r.package_id);
}
async function elementIds(): Promise<string[]> {
  const { rows } = await db.query<{ doc_id: string }>(
    `select doc_id from public.discovery_elements order by doc_id`,
  );
  return rows.map((r) => r.doc_id);
}
async function course(id: string) {
  const { rows } = await db.query<Record<string, unknown>>(
    `select * from public.discovery_courses where package_id = $1`,
    [id],
  );
  return rows[0];
}

describe("A.1 a listed, published course is projected from the manifest and registry", () => {
  it("carries the listing fields", async () => {
    const id = await seedPackage(db, {
      owner,
      title: "General Chemistry",
      manifest: {
        description: "Atoms, bonds and reactions for first-year students who have never taken any chemistry course before.",
        keywords: ["stoichiometry", " acids ", "", "equilibrium"],
        discipline: "  Chemistry ",
        courseContext: { level: "Introductory Undergraduate", courseNumber: "CHEM 101", secret: "x" },
        chapters: [
          { slug: "atoms", title: "Atoms" },
          { slug: "bonds", title: "Chemical Bonds" },
        ],
        accessibility: { status: "pass", errorCount: 0, warningCount: 0, checkedAt: "2026-10-01T00:00:00.000Z" },
      },
      listed: true,
    });
    await db.query(
      `insert into public.sandbox_files (package_id, repo, path, content)
       values ($1, 'public', 'concepts/course.md', $2)`,
      [id, "# Matter\nnot a heading\n## Periodic trends ##\n#### too deep\n```\ncode\n```"],
    );
    const c = (await course(id))!;
    expect(c["title"]).toBe("General Chemistry");
    expect(c["keywords"]).toEqual(["stoichiometry", "acids", "equilibrium"]);
    expect(c["discipline"]).toBe("chemistry");
    expect(c["level"]).toBe("introductory undergraduate");
    expect(c["course_context"]).toEqual({
      level: "Introductory Undergraduate",
      courseNumber: "CHEM 101",
    });
    expect(c["chapter_titles"]).toEqual(["Atoms", "Chemical Bonds"]);
    expect(c["chapter_count"]).toBe(2);
    expect(c["topics"]).toEqual(["Matter", "Periodic trends"]);
    expect(c["accessibility_status"]).toBe("pass");
    expect(c["license"]).toBe("CC-BY-4.0");
    expect(c["site_url"]).toBe(`https://educator.github.io/${id}-oer/`);
    expect(c["public_repo_url"]).toBe(`https://github.com/educator/${id}-oer`);
    expect(c["completeness"]).toBe(1);
  });

  it("a package without chapters counts as one chapter; discipline/level may be absent", async () => {
    const id = await seedPackage(db, { owner, manifest: { discipline: "" }, listed: true });
    const c = (await course(id))!;
    expect(c["chapter_count"]).toBe(1);
    expect(c["discipline"]).toBeNull();
    expect(c["level"]).toBeNull();
  });
});

describe("A.1 adversarial: what never enters the course projection", () => {
  it.each([
    ["a trial (unpublished) package, even with a listing row", { storage: "sandbox" as const }],
    ["an archived package", { archived: true }],
    ["an all-rights-reserved package listed around the app's check", { manifest: { license: "ALL-RIGHTS-RESERVED" } }],
    ["a published package with no public repo in its manifest", { manifest: { publicRepo: undefined } }],
  ])("%s", async (_label, over) => {
    const id = await seedPackage(db, { owner, listed: true, ...over });
    expect(await courseIds()).not.toContain(id);
  });

  it("a published package nobody listed", async () => {
    const id = await seedPackage(db, { owner });
    expect(await courseIds()).not.toContain(id);
  });

  it("unlisting (owner, or an operator deleting the row) removes it at once", async () => {
    const id = await seedPackage(db, { owner, listed: true });
    expect(await courseIds()).toContain(id);
    await db.query(`delete from public.portal_registrations where package_id = $1`, [id]);
    expect(await courseIds()).not.toContain(id);
  });

  it("archiving removes the course and its elements; restoring brings them back", async () => {
    const id = await seedPackage(db, { owner, listed: true });
    const doc = await seedDoc(db, { packageId: id });
    expect(await courseIds()).toContain(id);
    expect(await elementIds()).toContain(doc);
    await db.query(`update public.packages set archived_at = now() where id = $1`, [id]);
    expect(await courseIds()).not.toContain(id);
    expect(await elementIds()).not.toContain(doc);
    await db.query(`update public.packages set archived_at = null where id = $1`, [id]);
    expect(await courseIds()).toContain(id);
    expect(await elementIds()).toContain(doc);
  });

  it("a licence changed to all-rights-reserved after listing drops the course", async () => {
    const id = await seedPackage(db, { owner, listed: true });
    await db.query(
      `update public.packages set manifest = manifest || '{"license":"ALL-RIGHTS-RESERVED"}' where id = $1`,
      [id],
    );
    expect(await courseIds()).not.toContain(id);
  });

  it("deleting a package removes everything", async () => {
    const id = await seedPackage(db, { owner, listed: true });
    await seedDoc(db, { packageId: id });
    await db.query(`delete from public.packages where id = $1`, [id]);
    expect(await courseIds()).not.toContain(id);
    const { rows } = await db.query(`select 1 from public.discovery_elements where package_id = $1`, [id]);
    expect(rows).toHaveLength(0);
  });
});

describe("A.1 adversarial: what never enters the element projection", () => {
  let pub: string;
  beforeAll(async () => {
    pub = await seedPackage(db, { owner }); // published, not listed: elements are per-file consent
  });

  it("a shared public file of a published, active package is projected (course listing not needed)", async () => {
    const doc = await seedDoc(db, { packageId: pub, tags: ["acid-base"] });
    expect(await elementIds()).toContain(doc);
    const { rows } = await db.query<Record<string, unknown>>(
      `select * from public.discovery_elements where doc_id = $1`,
      [doc],
    );
    expect(rows[0]!["course_listed"]).toBe(false);
    expect(rows[0]!["license"]).toBe("CC-BY-4.0");
    expect(rows[0]!["described"]).toBe(true);
  });

  it.each([
    ["a private-repo file marked shared", { repo: "private" as const, space: "private", path: "private/key.md" }],
    ["a private-repo file with a public-looking space", { repo: "private" as const }],
    ["a public file in the private space", { space: "private" }],
    ["a file in the current (this-term) space", { space: "current", path: "current/fall/notes.md" }],
    ["an unshared file", { discoverable: false }],
    ["a tombstoned file", { tombstoned: true }],
  ])("%s", async (_label, over) => {
    const doc = await seedDoc(db, { packageId: pub, ...over });
    expect(await elementIds()).not.toContain(doc);
  });

  it("a shared file of a trial package", async () => {
    const trial = await seedPackage(db, { owner, storage: "sandbox" });
    const doc = await seedDoc(db, { packageId: trial });
    expect(await elementIds()).not.toContain(doc);
  });

  it("unsharing, deleting (tombstone) or moving into `current` removes it", async () => {
    const a = await seedDoc(db, { packageId: pub });
    const b = await seedDoc(db, { packageId: pub });
    const c = await seedDoc(db, { packageId: pub });
    expect(await elementIds()).toEqual(expect.arrayContaining([a, b, c]));
    await db.query(`update public.documents set discoverable = false where doc_id = $1`, [a]);
    await db.query(`update public.documents set tombstoned = true where doc_id = $1`, [b]);
    await db.query(`update public.documents set space = 'current', path = 'current/t/x.svg' where doc_id = $1`, [c]);
    const ids = await elementIds();
    expect(ids).not.toContain(a);
    expect(ids).not.toContain(b);
    expect(ids).not.toContain(c);
  });

  it("the table itself refuses a private or current row", async () => {
    const doc = await seedDoc(db, { packageId: pub, discoverable: false });
    const insert = (repo: string, space: string) =>
      db.query(
        `insert into public.discovery_elements (doc_id, package_id, repo, space, kind, permalink_class,
           path, title, license, package_title, listed_at, updated_at, fingerprint, search_vector)
         values ($1, $2, $3, $4, 'svg', 'object', 'p', 't', 'CC-BY-4.0', 'x', now(), now(), 'f', ''::tsvector)`,
        [doc, pub, repo, space],
      );
    await expect(insert("private", "assets")).rejects.toThrow(/check/i);
    await expect(insert("public", "current")).rejects.toThrow(/check/i);
    await expect(insert("public", "private")).rejects.toThrow(/check/i);
  });
});

describe("A.1 public read: RLS serves listed rows only; nobody else writes", () => {
  it("a stale row (projector bypassed) is still invisible to the public", async () => {
    const id = await seedPackage(db, { owner, listed: true });
    const doc = await seedDoc(db, { packageId: id });
    // Simulate a projection that missed the archive: disable the trigger.
    await db.exec(`alter table public.packages disable trigger discovery_packages`);
    await db.query(`update public.packages set archived_at = now() where id = $1`, [id]);
    await db.exec(`alter table public.packages enable trigger discovery_packages`);
    expect(await courseIds()).toContain(id); // stale on purpose

    for (const role of ["anon", "authenticated"] as const) {
      const seen = await asRole(db, role, async () => ({
        c: (await db.query(`select package_id from public.discovery_courses where package_id = $1`, [id])).rows,
        e: (await db.query(`select doc_id from public.discovery_elements where doc_id = $1`, [doc])).rows,
      }), role === "authenticated" ? owner : undefined);
      expect(seen.c).toHaveLength(0);
      expect(seen.e).toHaveLength(0);
    }
    // A rebuild repairs it.
    await db.query(`select public.discovery_rebuild()`);
    expect(await courseIds()).not.toContain(id);
  });

  it("anon reads a listed course and a shared element", async () => {
    const id = await seedPackage(db, { owner, listed: true, title: "Readable" });
    const doc = await seedDoc(db, { packageId: id });
    const seen = await asRole(db, "anon", async () => ({
      c: (await db.query(`select title from public.discovery_courses where package_id = $1`, [id])).rows,
      e: (await db.query(`select doc_id from public.discovery_elements where doc_id = $1`, [doc])).rows,
    }));
    expect(seen.c).toEqual([{ title: "Readable" }]);
    expect(seen.e).toHaveLength(1);
  });

  it("the documents registry stays owner-only", async () => {
    const id = await seedPackage(db, { owner });
    await seedDoc(db, { packageId: id });
    const rows = await asRole(db, "anon", async () =>
      (await db.query(`select doc_id from public.documents where package_id = $1`, [id])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it.each(["anon", "authenticated"] as const)("%s cannot write the projection or run the projector", async (role) => {
    const id = await seedPackage(db, { owner, listed: true });
    const attempts = [
      `update public.discovery_courses set title = 'x' where package_id = '${id}'`,
      `delete from public.discovery_courses where package_id = '${id}'`,
      `insert into public.discovery_courses (package_id) values ('${id}')`,
      `select public.discovery_refresh_package('${id}', false)`,
      `select public.discovery_rebuild()`,
      `select public.discovery_course_adaptations('${id}')`,
    ];
    for (const sql of attempts) {
      await expect(
        asRole(db, role, () => db.query(sql), role === "authenticated" ? owner : undefined),
      ).rejects.toThrow(/permission denied/i);
    }
  });
});

describe("A.1 freshness: the projection follows every change", () => {
  it("a metadata edit (manifest write) refreshes the listing and bumps updated_at; a no-op does not", async () => {
    const id = await seedPackage(db, { owner, listed: true, title: "Old title" });
    await db.query(`update public.discovery_courses set updated_at = '2020-01-01' where package_id = $1`, [id]);
    // Same manifest re-written (refreshManifestColumn after an unchanged save).
    await db.query(`update public.packages set manifest = manifest where id = $1`, [id]);
    expect(String((await course(id))!["updated_at"])).toContain("2020");
    await db.query(
      `update public.packages set manifest = manifest || '{"title":"New title","keywords":["kinetics"]}' where id = $1`,
      [id],
    );
    const c = (await course(id))!;
    expect(c["title"]).toBe("New title");
    expect(c["keywords"]).toEqual(["kinetics"]);
    expect(new Date(String(c["updated_at"])).getFullYear()).toBeGreaterThan(2020);
  });

  it("saving the course's public files counts as an update; private files do not", async () => {
    const id = await seedPackage(db, { owner, listed: true });
    const pubDoc = await seedDoc(db, { packageId: id, discoverable: false, path: "study-guide/a.md", space: "study-guide", kind: "md" });
    const privDoc = await seedDoc(db, { packageId: id, discoverable: false, repo: "private", space: "private", path: "private/n.md" });
    await db.query(`update public.discovery_courses set updated_at = '2020-01-01' where package_id = $1`, [id]);
    await db.query(`update public.documents set source_hash = 'h2' where doc_id = $1`, [privDoc]);
    expect(String((await course(id))!["updated_at"])).toContain("2020");
    await db.query(`update public.documents set source_hash = 'h2' where doc_id = $1`, [pubDoc]);
    expect(String((await course(id))!["updated_at"])).not.toContain("2020");
  });

  it("concept-map saves refresh the topics", async () => {
    const id = await seedPackage(db, { owner, listed: true });
    await db.query(
      `insert into public.sandbox_files (package_id, repo, path, content) values ($1, 'public', 'concepts/course.md', '# Gases')`,
      [id],
    );
    expect((await course(id))!["topics"]).toEqual(["Gases"]);
    await db.query(
      `update public.sandbox_files set content = '# Gases\n# Solutions' where package_id = $1 and path = 'concepts/course.md'`,
      [id],
    );
    expect((await course(id))!["topics"]).toEqual(["Gases", "Solutions"]);
    // A private file at the same path is never read.
    await db.query(
      `insert into public.sandbox_files (package_id, repo, path, content) values ($1, 'private', 'concepts/course.md', '# Secret')`,
      [id],
    );
    expect((await course(id))!["topics"]).toEqual(["Gases", "Solutions"]);
  });

  it("share counts and adaptation counts follow forks and element copies", async () => {
    const src = await seedPackage(db, { owner, listed: true });
    const srcDoc = await seedDoc(db, { packageId: src });
    expect((await course(src))!["element_count"]).toBe(1);
    expect((await course(src))!["adaptation_count"]).toBe(0);

    const other = await seedUser(db, "adapter");
    // A whole-course fork (manifest.adaptedFrom) …
    await seedPackage(db, {
      owner: other,
      storage: "sandbox",
      manifest: { adaptedFrom: { packageId: src, license: "CC-BY-4.0", attribution: "x" } },
    });
    expect((await course(src))!["adaptation_count"]).toBe(1);
    // … and an element copy into a third package.
    const third = await seedPackage(db, { owner: other });
    const copy = await seedDoc(db, { packageId: third, discoverable: false, adaptedFrom: srcDoc });
    expect((await course(src))!["adaptation_count"]).toBe(2);
    const { rows } = await db.query<{ adaptation_count: number }>(
      `select adaptation_count from public.discovery_elements where doc_id = $1`,
      [srcDoc],
    );
    expect(rows[0]!.adaptation_count).toBe(1);
    // Deleting the copy (tombstone) takes the count back down.
    await db.query(`update public.documents set tombstoned = true where doc_id = $1`, [copy]);
    expect((await course(src))!["adaptation_count"]).toBe(1);
  });

  it("listing after publication: a trial package that is published and listed appears", async () => {
    const id = await seedPackage(db, { owner, storage: "sandbox" });
    await db.query(
      `update public.packages set storage = 'github',
         manifest = manifest || '{"publicRepo":{"owner":"educator","name":"late-oer"}}' where id = $1`,
      [id],
    );
    expect(await courseIds()).not.toContain(id);
    await listPackage(db, id, owner);
    expect(await courseIds()).toContain(id);
  });
});

describe("A.1 best-effort and rebuild", () => {
  it("a failing projector never fails the educator's write", async () => {
    const id = await seedPackage(db, { owner, listed: true });
    await db.exec(`
      alter function public.discovery_refresh_package(text, boolean) rename to discovery_refresh_package_real;
      create function public.discovery_refresh_package(p text, c boolean default false) returns void
        language plpgsql as $$ begin raise exception 'boom'; end $$;
    `);
    try {
      await db.query(`update public.packages set manifest = manifest || '{"title":"Still saved"}' where id = $1`, [id]);
      const { rows } = await db.query<{ title: string }>(`select manifest->>'title' as title from public.packages where id = $1`, [id]);
      expect(rows[0]!.title).toBe("Still saved");
    } finally {
      await db.exec(`
        drop function public.discovery_refresh_package(text, boolean);
        alter function public.discovery_refresh_package_real(text, boolean) rename to discovery_refresh_package;
      `);
    }
    await db.query(`select public.discovery_rebuild()`);
    expect((await course(id))!["title"]).toBe("Still saved");
  });

  it("a rebuild from empty reproduces the projection", async () => {
    const cols = `package_id, title, description, keywords, chapter_titles, topics, discipline, level,
      course_context, license, accessibility_status, chapter_count, element_count, adaptation_count,
      site_url, completeness, fingerprint, search_text, search_vector::text as v`;
    const before = (await db.query(`select ${cols} from public.discovery_courses order by package_id`)).rows;
    const beforeEl = (await db.query(`select doc_id, fingerprint, search_vector::text as v from public.discovery_elements order by doc_id`)).rows;
    expect(before.length).toBeGreaterThan(3);
    await db.exec(`delete from public.discovery_courses; delete from public.discovery_elements;`);
    await db.query(`select public.discovery_rebuild()`);
    expect((await db.query(`select ${cols} from public.discovery_courses order by package_id`)).rows).toEqual(before);
    expect(
      (await db.query(`select doc_id, fingerprint, search_vector::text as v from public.discovery_elements order by doc_id`)).rows,
    ).toEqual(beforeEl);
  });
});

describe("A.1 the real write path: an educator's own session (RLS) drives the projection", () => {
  it("listing, sharing and archiving through the owner's own session refresh the index", async () => {
    const me = await seedUser(db, "session-owner");
    const id = await seedPackage(db, { owner: me, title: "Session Course" });
    const doc = await seedDoc(db, { packageId: id, discoverable: false });
    await asRole(
      db,
      "authenticated",
      async () => {
        // "List publicly" (registerPackageAction's upsert, under RLS)
        await db.query(
          `insert into public.portal_registrations
             (package_id, owner_id, title, license, public_repo_url, site_url)
           values ($1, $2, 'Session Course', 'CC-BY-4.0', 'x', 'y')`,
          [id, me],
        );
        // "Share this" (shareFileAction's update, under RLS)
        await db.query(`update public.documents set discoverable = true where doc_id = $1`, [doc]);
      },
      me,
    );
    expect(await courseIds()).toContain(id);
    expect(await elementIds()).toContain(doc);
    await asRole(
      db,
      "authenticated",
      () => db.query(`update public.packages set archived_at = now() where id = $1`, [id]),
      me,
    );
    expect(await courseIds()).not.toContain(id);
    expect(await elementIds()).not.toContain(doc);
  });

  it("another educator's session can neither list nor share someone else's course", async () => {
    const victim = await seedUser(db, "victim");
    const attacker = await seedUser(db, "attacker");
    const id = await seedPackage(db, { owner: victim });
    const doc = await seedDoc(db, { packageId: id, discoverable: false });
    await expect(
      asRole(
        db,
        "authenticated",
        () =>
          db.query(
            `insert into public.portal_registrations
               (package_id, owner_id, title, license, public_repo_url, site_url)
             values ($1, $2, 't', 'CC-BY-4.0', 'x', 'y')`,
            [id, victim],
          ),
        attacker,
      ),
    ).rejects.toThrow(/row-level security/i);
    await asRole(
      db,
      "authenticated",
      () => db.query(`update public.documents set discoverable = true where doc_id = $1`, [doc]),
      attacker,
    ); // RLS: matches no row
    expect(await courseIds()).not.toContain(id);
    expect(await elementIds()).not.toContain(doc);
  });
});

