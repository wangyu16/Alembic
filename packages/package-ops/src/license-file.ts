import { ALL_RIGHTS_RESERVED, licenseLabel, type License, type PackageManifest } from "@alembic/package-contract";
import type { PackageStore } from "./store";
import type { Committer } from "./write-through";
import { LICENSE_TEXTS } from "./license-texts.generated";

/**
 * The LICENSE body for an unlicensed (all-rights-reserved) package. There is no
 * open legal code to vendor — this is a plain copyright notice. GitHub shows no
 * license badge for it, which is correct: the package grants no reuse and is not
 * listable on Discover.
 */
const ALL_RIGHTS_RESERVED_TEXT =
  "All rights reserved.\n\n" +
  "This work is under standard copyright. No license is granted for reuse, " +
  "redistribution, or adaptation without the copyright holder's explicit permission. " +
  "Contact the author to request permission.\n";

/**
 * The `LICENSE` file of a published course repository.
 *
 * `LICENSE` has always been an allowed root path (`spaces.ts` / `layers.ts`
 * root allowlist) but nothing ever wrote one: the license lived only in
 * `alembic.json`, the JSON-LD and — since 2026-07-10 — the published home
 * page's rights notice. A repository with no LICENSE is not self-describing to
 * anyone who finds it outside Alembic, and GitHub shows it no license badge, so
 * it does not surface in license-filtered search. For an OER platform that is a
 * real loss of reusability, not a cosmetic gap.
 *
 * The file is the license's **verbatim legal code** and nothing else. Two
 * reasons, both deliberate:
 *
 *  - GitHub's detector matches the verbatim text. A prepended copyright preamble
 *    can push it below the match threshold, costing the badge we are here to get.
 *  - The text is vendored (`scripts/fetch-licenses.mjs`), never typed. Legal text
 *    must not be paraphrased or reconstructed from memory.
 *
 * Attribution — who holds the copyright — is therefore carried elsewhere: the
 * published page's rights notice, the JSON-LD, and `CITATION.cff`.
 */
export const LICENSE_PATH = "LICENSE";

/** The verbatim legal code for a license id (or a copyright notice for an unlicensed package). */
export function licenseFileContent(license: License): string {
  if (license === ALL_RIGHTS_RESERVED) return ALL_RIGHTS_RESERVED_TEXT;
  const vendored = LICENSE_TEXTS[license];
  if (!vendored) {
    // Unreachable while LICENSE_TEXTS is keyed by `License`; a new license id
    // added to the schema without re-running the vendor script lands here.
    throw new Error(`licenseFileContent: no vendored text for ${license}`);
  }
  return vendored.text;
}

/** A one-line human summary, for commit messages and logs. */
export function licenseSummary(license: License): string {
  return licenseLabel(license);
}

/**
 * The LICENSE content the package needs when Alembic's copy does not already
 * match its manifest; null when it does. Writes nothing (loop r3, P5.B.3.h:
 * "does it need one?" is split from "record it", so a published course
 * records LICENSE only after the save to its online home succeeded).
 */
export async function licenseFileNeeded(
  store: PackageStore,
  packageId: string,
  manifest: Pick<PackageManifest, "license">,
): Promise<string | null> {
  const want = licenseFileContent(manifest.license);
  const current = await store.readFile(packageId, "public", LICENSE_PATH);
  return current === want ? null : want;
}

/** Record LICENSE in Alembic's copy — for a published course, only after the
 *  commit that wrote it succeeded. */
export async function recordLicenseFile(
  store: PackageStore,
  packageId: string,
  content: string,
): Promise<void> {
  await store.putFiles(packageId, [{ repo: "public", path: LICENSE_PATH, content }]);
}

/**
 * Ensure the package's public `LICENSE` matches its manifest — in Alembic's
 * copy ONLY. For a TRIAL package (the copy is the truth; the first publish
 * then commits it with everything else).
 *
 * Idempotent, and it is the ONLY thing that keeps an existing package's LICENSE
 * honest: packages created before this existed have none, and the file must be
 * rewritten if the license ever changes. Returns true when it wrote.
 *
 * A PUBLISHED package must use `backfillLicenseFile` instead: writing the copy
 * before a guarded commit that is then refused left the copy claiming a
 * LICENSE the course does not have, so no later publish retried (P5.B.3.h).
 */
export async function ensureLicenseFile(
  store: PackageStore,
  packageId: string,
  manifest: Pick<PackageManifest, "license">,
): Promise<boolean> {
  const want = await licenseFileNeeded(store, packageId, manifest);
  if (want === null) return false;
  await recordLicenseFile(store, packageId, want);
  return true;
}

/**
 * Bring a PUBLISHED course's `LICENSE` in line with its manifest: save it to
 * the online home through `committer` first, and record it in Alembic's copy
 * only once that succeeded. A refused or failed save throws and leaves the
 * copy unchanged, so the next publish tries again. Returns true when it wrote.
 */
export async function backfillLicenseFile(
  store: PackageStore,
  committer: Committer,
  packageId: string,
  manifest: Pick<PackageManifest, "license">,
): Promise<boolean> {
  const want = await licenseFileNeeded(store, packageId, manifest);
  if (want === null) return false;
  await committer.commit({
    repo: "public",
    summary: "Add LICENSE (Alembic)",
    changes: [{ path: LICENSE_PATH, content: want }],
  });
  await recordLicenseFile(store, packageId, want);
  return true;
}
