import {
  assertPathAllowedInRepo,
  LicenseSchema,
  validateBlockIds,
} from "@alembic/package-contract";
import type { PackageStore } from "./store";
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
  const guide = await loadStudyGuide(store, packageId);

  // 1. License present.
  const licenseOk =
    !!record && LicenseSchema.safeParse(record.manifest.license).success;
  checks.push({
    name: "License",
    ok: licenseOk,
    message: "Choose a license before publishing so others know how they may reuse your work.",
  });

  // 2. Study guide has content.
  checks.push({
    name: "Study guide",
    ok: guide.blocks.length > 0,
    message: "Add at least one study-guide section before publishing.",
  });

  // 3. Section identifiers valid.
  const ids = validateBlockIds(
    guide.blocks.filter((b) => b.id).map((b) => ({ id: b.id! })),
  );
  const allHaveIds = guide.blocks.every((b) => b.id);
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

  return { ok: checks.every((c) => c.ok), checks };
}
