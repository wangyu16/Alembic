import {
  assertPathAllowedInRepo,
  newBlockId,
  newPackageId,
  PACKAGE_SCHEMA_VERSION,
  parseManifest,
  type License,
  type PackageManifest,
} from "@alembic/package-contract";
import type { PackageFile, PackageRecord, PackageStore } from "./store";

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
  return `## Getting started{{attrs[#${id}]}}

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
    createdAt,
  });

  const files: PackageFile[] = [
    {
      repo: "public",
      path: "alembic.json",
      content: JSON.stringify(manifest, null, 2) + "\n",
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
