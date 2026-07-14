import {
  assertPathAllowedInRepo,
  newBlockId,
  newPackageId,
  PACKAGE_SCHEMA_VERSION,
  parseManifest,
  type License,
  type PackageManifest,
  type UnitTerm,
} from "@alembic/package-contract";
import type { PackageFile, PackageRecord, PackageStore } from "./store";
import { LICENSE_PATH, licenseFileContent } from "./license-file";

/**
 * The two content placeholders a fresh package is seeded with (paths only — the
 * welcome study-guide chapter and the private starter note). Root scaffold
 * (`alembic.json`, `LICENSE`) is not listed here; it is always present and is
 * overwritten rather than treated as content. Exported so the "populate a
 * pristine package" path can recognize an as-created package and clear any of
 * these placeholders the upload doesn't itself provide. Keep in sync with the
 * `files` seeded in {@link createSandboxPackage}.
 */
export const SEED_CONTENT_PATHS = [
  "study-guide/01-getting-started.md",
  "private-instructor/notes/getting-started.md",
] as const;

/**
 * Root files that are scaffold, not authored content — always present on a
 * fresh package, and overwritten (never a signal that the package has content).
 */
export const ROOT_SCAFFOLD_PATHS = [
  "alembic.json",
  "LICENSE",
  "README.md",
  "CITATION.cff",
  ".gitignore",
] as const;

/**
 * TRUE when a package still holds only its as-created placeholders — no authored
 * content has been added. This is the guard for "populate a published *empty*
 * package from a zip": populate replaces the placeholders, and refuses a package
 * that already has real content (replacing that is a separate, future feature).
 * Path-based (rebuildable from repo content, no flag/migration): a package is
 * pristine iff every file is root scaffold or one of the two seed placeholders.
 */
export function isPristinePackage(files: { path: string }[]): boolean {
  const allowed = new Set<string>([...ROOT_SCAFFOLD_PATHS, ...SEED_CONTENT_PATHS]);
  return files.every((f) => allowed.has(f.path.replace(/\\/g, "/").replace(/^\/+/, "")));
}

export interface CreateSandboxPackageInput {
  ownerId: string;
  title: string;
  description?: string;
  license: License;
  courseContext?: {
    courseName?: string;
    level?: string;
    institutionType?: string;
  };
  /** What the course calls its units (display wording). Absent → "chapter". */
  unitTerm?: UnitTerm;
  /** Injected so the operation stays deterministic in tests. */
  now?: () => Date;
}

export interface CreatedPackage {
  packageId: string;
  manifest: PackageManifest;
  files: PackageFile[];
}

function welcomeChapter(title: string): string {
  const id = newBlockId();
  return `# ${title}

## Getting started{{attrs[#${id}]}}

Welcome to **${title}**. This is your first study-guide section — replace it
with your own material. Each section keeps a permanent invisible label (the
\`{{attrs[#…]}}\` marker) so worksheets and slides generated from it stay
connected even as you edit.

Chemistry notation works out of the box: H~2~O, CO~3~^2-^, and equations like
$K_a = \\frac{[\\mathrm{H^+}][\\mathrm{A^-}]}{[\\mathrm{HA}]}$.
`;
}

function instructorNotes(): string {
  const id = newBlockId();
  return `## Private notes{{attrs[#${id}]}}

Notes here are **never published**. They live in your private materials,
physically separate from anything students or the public can see.
`;
}

/**
 * Create a trial-sandbox package: build and validate the manifest, seed
 * starter files, validate every path against the layer contract, persist.
 */
export async function createSandboxPackage(
  store: PackageStore,
  input: CreateSandboxPackageInput,
): Promise<CreatedPackage> {
  const createdAt = (input.now?.() ?? new Date()).toISOString();
  const packageId = newPackageId(input.title);

  const manifest = parseManifest({
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    packageId,
    title: input.title,
    description: input.description ?? "",
    license: input.license,
    courseContext: input.courseContext ?? {},
    ...(input.unitTerm ? { unitTerm: input.unitTerm } : {}),
    createdAt,
  });

  const files: PackageFile[] = [
    {
      repo: "public",
      path: "alembic.json",
      content: JSON.stringify(manifest, null, 2) + "\n",
    },
    {
      // The verbatim legal code, so the published repository is self-describing
      // and GitHub can detect the license. `ensureLicenseFile` keeps it honest
      // for packages that predate this seed. See license-file.ts.
      repo: "public",
      path: LICENSE_PATH,
      content: licenseFileContent(input.license),
    },
    {
      repo: "public",
      path: "study-guide/01-getting-started.md",
      content: welcomeChapter(input.title),
    },
    {
      repo: "private",
      path: "private-instructor/notes/getting-started.md",
      content: instructorNotes(),
    },
  ];

  // The same invariant the GitHub bridge enforces — sandbox storage included,
  // so graduation can never leak.
  for (const file of files) {
    assertPathAllowedInRepo(file.path, file.repo);
  }

  await store.createPackage(
    {
      packageId,
      ownerId: input.ownerId,
      title: input.title,
      manifest,
      storage: "sandbox",
    },
    files,
  );

  return { packageId, manifest, files };
}
