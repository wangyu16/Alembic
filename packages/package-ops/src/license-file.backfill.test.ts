/**
 * Loop r3 (M3-4, P5.B.3.h): the LICENSE backfill of a published course
 * records LICENSE in Alembic's copy only AFTER the save to the online home
 * succeeded. Before r3 the copy was written first; when the save was then
 * refused (changed outside Alembic) the copy already said LICENSE existed,
 * so no later publish ever tried again.
 */
import { describe, expect, it } from "vitest";
import { CommitFailedError, type Committer, type CommitPlanInput } from "./write-through";
import { LICENSE_PATH, backfillLicenseFile, licenseFileContent } from "./license-file";
import { MemoryPackageStore } from "./memory-store";

const PKG = "pkg-1";

function committer(failFirst: number) {
  const plans: CommitPlanInput[] = [];
  let fails = failFirst;
  const c: Committer = {
    async commit(plan) {
      plans.push(plan);
      if (fails > 0) {
        fails--;
        throw new CommitFailedError("This course was changed outside Alembic since your last save.");
      }
      return { commitSha: `c${plans.length}` };
    },
  };
  return { c, plans };
}

describe("LICENSE backfill for a published course (loop r3, P5.B.3.h)", () => {
  it("[P5.B.3.h] a refused save leaves Alembic's copy unchanged, so the next publish retries and then records it", async () => {
    const store = new MemoryPackageStore();
    const { c, plans } = committer(1);
    const manifest = { license: "CC-BY-4.0" as const };

    await expect(backfillLicenseFile(store, c, PKG, manifest)).rejects.toBeInstanceOf(CommitFailedError);
    expect(await store.readFile(PKG, "public", LICENSE_PATH)).toBeNull();

    expect(await backfillLicenseFile(store, c, PKG, manifest)).toBe(true);
    expect(plans).toHaveLength(2);
    expect(plans[1]!.changes).toEqual([{ path: LICENSE_PATH, content: licenseFileContent("CC-BY-4.0") }]);
    expect(await store.readFile(PKG, "public", LICENSE_PATH)).toBe(licenseFileContent("CC-BY-4.0"));

    // Now in place: nothing more to do.
    expect(await backfillLicenseFile(store, c, PKG, manifest)).toBe(false);
    expect(plans).toHaveLength(2);
  });

  it("[P5.B.3.h] a licence change is saved online first, and only then recorded", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [{ repo: "public", path: LICENSE_PATH, content: licenseFileContent("CC-BY-4.0") }]);
    const { c } = committer(1);
    await expect(backfillLicenseFile(store, c, PKG, { license: "CC0-1.0" })).rejects.toThrow();
    expect(await store.readFile(PKG, "public", LICENSE_PATH)).toBe(licenseFileContent("CC-BY-4.0"));
  });
});
