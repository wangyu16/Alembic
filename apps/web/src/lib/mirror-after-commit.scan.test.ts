/**
 * Loop r3 (M3-4, P5.B.3.h): server actions that write a PUBLISHED course's
 * files outside `writeThrough` must not write Alembic's copy before the
 * guarded save — a refused save then left the copy claiming a file the
 * course does not have (LICENSE: never retried by later publishes). The
 * ordering itself is bound by package-ops tests (`backfillLicenseFile`,
 * `restoreStudyGuideFile`); this binds the call sites to those helpers.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = fileURLToPath(new URL("../app/workspace/[packageId]/", import.meta.url));
const src = (f: string) => readFileSync(`${dir}${f}`, "utf8");

describe("Alembic's copy is written only after the guarded save (loop r3, P5.B.3.h)", () => {
  it("[P5.B.3.h] the website publish backfills LICENSE through backfillLicenseFile, never ensureLicenseFile", () => {
    const s = src("site-actions.ts");
    expect(s).toMatch(/backfillLicenseFile\(store, resolved\.committer, packageId/);
    expect(s).not.toMatch(/ensureLicenseFile/);
  });

  it("[P5.B.3.h] the single-chapter restore saves online before writing the copy (restoreStudyGuideFile)", () => {
    const s = src("github-actions.ts");
    const restore = s.slice(s.indexOf("export async function restoreStudyGuideAction"));
    expect(restore).toMatch(/restoreStudyGuideFile\(store, resolved\.committer, packageId/);
    expect(restore).not.toMatch(/saveStudyGuide\(|putFiles\(/);
  });
});
