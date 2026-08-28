import {
  assertPathAllowedInRepo,
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
 * **LEGACY ONLY.** The two content placeholders packages created BEFORE the
 * "slots, not placeholders" rule were seeded with (paths only — the welcome
 * study-guide chapter and the private starter note).
 * {@link createSandboxPackage} no longer produces either file, so a *fresh*
 * package never contains these paths; they survive only in packages created
 * earlier. Retained because the populate and pristine-gate paths still have to
 * recognize (and clear) them on those older packages. Root scaffold
 * (`alembic.json`, `LICENSE`) is not listed here; it is always present and is
 * overwritten rather than treated as content.
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
 * content has been added. Path-based, so it is rebuildable from repo content
 * with no flag or migration: a package is pristine iff every file is root
 * scaffold or one of the two legacy seed placeholders.
 *
 * **No longer a gate (2026-08-28).** This used to *refuse* the zip upload on any
 * package that wasn't pristine, which turned every interrupted upload into a
 * dead end ("This course already has content") and made the door depend on
 * whether the educator happened to have opened a document first. Populate now
 * asks {@link diffPopulatePlan} what the upload would add, replace and leave
 * alone, shows that to the educator, and takes an explicit confirmation —
 * see `populate-package.ts`, which also owns
 * {@link authoredContentFiles} / {@link packageAwaitsUpload}, the predicates the
 * upload door and the "this course is empty" call-to-action now share.
 *
 * What remains here is the plain question this function's name asks — "does this
 * package still hold only its placeholders?" — kept for callers that genuinely
 * want it (package creation tests, lifecycle checks). It must not be used to
 * decide whether an upload is allowed.
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

/**
 * Slug of the first chapter every new package declares. Chosen to match the
 * slug the legacy *implicit* chapter had (derived from
 * `DEFAULT_STUDY_GUIDE_PATH`) so nothing downstream shifts: a package created
 * before and after this change lists the same first chapter.
 */
export const FIRST_CHAPTER_SLUG = "01-getting-started";

/**
 * Create a trial-sandbox package: build and validate the manifest, write the
 * root scaffold, validate every path against the layer contract, persist.
 *
 * **No content files are seeded** ("slots, not placeholders",
 * docs/specs/storage-and-write-paths.md §4): the package's chapter documents
 * are declared slots, and a file exists iff real content exists. Empty-state
 * guidance belongs in the UI, never in a committed file.
 *
 * Because of that, the manifest declares its first chapter EXPLICITLY. The
 * `chapters`-absent case in `chapters.ts` materializes an implicit chapter
 * pointing at the old seeded study-guide file; leaving `chapters` unset here
 * would therefore show a phantom chapter whose file does not exist. That
 * fallback now serves legacy packages only.
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
    // One first chapter, declared but empty — no file behind it yet.
    chapters: [{ slug: FIRST_CHAPTER_SLUG, title: input.title }],
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
