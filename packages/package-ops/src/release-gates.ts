import {
  assertPathAllowedInRepo,
  assertPublicMarkdownReferences,
  LicenseSchema,
  validateBlockIds,
} from "@alembic/package-contract";
import type { PackageStore } from "./store";
import { listChapters } from "./chapters";
import { loadStudyGuide } from "./study-guide";

export interface GateCheck {
  name: string;
  ok: boolean;
  /** Educator-facing explanation, shown when the check fails. */
  message: string;
}

export interface GateResult {
  ok: boolean;
  checks: GateCheck[];
}

/**
 * Release gates: the second line of defense before publishing a package's
 * public site. Prevention-before-commit (the path invariant) is primary; these
 * checks catch state problems and explain them in educator language.
 */
export async function releaseGates(
  store: PackageStore,
  packageId: string,
): Promise<GateResult> {
  const checks: GateCheck[] = [];
  const record = await store.getPackage(packageId);
  const files = await store.listFiles(packageId);
  // Aggregate across ALL chapters — content may live in any chapter, and the
  // first chapter may have been renamed off the default study-guide path.
  const chapters = await listChapters(store, packageId);
  const guides = await Promise.all(
    chapters.map((c) => loadStudyGuide(store, packageId, c.path)),
  );
  const blocks = guides.flatMap((g) => g.blocks);

  // 1. License present.
  const licenseOk =
    !!record && LicenseSchema.safeParse(record.manifest.license).success;
  checks.push({
    name: "License",
    ok: licenseOk,
    message: "Choose a license before publishing so others know how they may reuse your work.",
  });

  // 2. Study guide has content (in any chapter). A "section" is text under a
  // "## Heading" line specifically — a single "#" is reserved for the
  // chapter's own auto-rendered title, so text above the first "##" doesn't
  // count even though it saved.
  checks.push({
    name: "Study guide",
    ok: blocks.length > 0,
    message:
      'Add at least one study-guide section before publishing — start it with a "## Heading" line (not a single "#", which is reserved for the page title).',
  });

  // 3. Section identifiers valid (across all chapters; IDs are globally unique).
  const ids = validateBlockIds(
    blocks.filter((b) => b.id).map((b) => ({ id: b.id! })),
  );
  const allHaveIds = blocks.every((b) => b.id);
  checks.push({
    name: "Section identifiers",
    ok: ids.ok && allHaveIds,
    message: "Some sections have missing or duplicate identifiers. Save your study guide and try again.",
  });

  // 4. Public/private separation — no public file resolves to a private layer.
  let separationOk = true;
  for (const f of files) {
    if (f.repo !== "public") continue;
    try {
      assertPathAllowedInRepo(f.path, "public");
    } catch {
      separationOk = false;
      break;
    }
  }
  checks.push({
    name: "Public/private separation",
    ok: separationOk,
    message: "Some content is in the wrong place. Private materials must stay private; resolve this before publishing.",
  });

  // 5. Answer keys & embargo — belt-and-suspenders, named for answer keys so
  // the educator message is specific. Re-assert every PUBLIC file's path
  // against the public-repo contract; an answer-key/private path staged public
  // is a leak of instructor-only material.
  let answerKeysSafe = true;
  for (const f of files) {
    if (f.repo !== "public") continue;
    try {
      assertPathAllowedInRepo(f.path, "public");
    } catch {
      answerKeysSafe = false;
      break;
    }
  }
  checks.push({
    name: "Answer keys & embargo",
    ok: answerKeysSafe,
    message: "Answer keys must stay private and were found staged for publication.",
  });

  // 6. References — no public text file references a private file (belt-and-
  // suspenders to the save-time check; covers worksheets/assessment too).
  let referencesSafe = true;
  for (const f of files) {
    if (f.repo !== "public") continue;
    if (!/\.(md|md\.html|html|svg)$/.test(f.path)) continue;
    try {
      assertPublicMarkdownReferences(f.content);
    } catch {
      referencesSafe = false;
      break;
    }
  }
  checks.push({
    name: "References",
    ok: referencesSafe,
    message:
      "Public content references a private file. Move reusable media to materials/ before publishing.",
  });

  return { ok: checks.every((c) => c.ok), checks };
}
