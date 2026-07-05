/**
 * Structural project validation — "one contract, two surfaces"
 * (carriers-and-assets.md §7).
 *
 * This is the SAME structural check the importer runs server-side and that a
 * local author (or their AI agent) runs before upload: "if validate(project)
 * passes, Alembic incorporates it with zero friction." Keeping it here, pure,
 * is what guarantees the Agent Skill cannot drift from the validator.
 *
 * PURITY (CLAUDE.md rule 2): this module imports zod and sibling contract
 * modules only. It must NOT import a carrier-kind registry — the set of known
 * carrier extensions is INJECTED via ValidateOptions, never imported.
 *
 * It collects ALL issues and never throws on validation failure (it converts
 * thrown contract errors into issues). Messages are educator-facing plain
 * language because they surface in the upload UI.
 */

import { LAYER_REPO, assertPathAllowedInRepo, layerForPath } from "./layers";
import {
  SPACE_REPO,
  assertPathAllowedInRepoV2,
  spaceForPath,
} from "./spaces";
import { parseManifest } from "./manifest";
import type { RepoKind } from "./layers";

/**
 * Dual-mode two-repo check (contract v2 §1). A path is allowed in its declared
 * repo if it is valid under EITHER the v1 layer set OR the v2 space set — so a
 * package mid-migration (or a native v2 layout with `assets/`, `slides/`,
 * `practice/`, `current/`, `private/`) validates alongside a v1 layout
 * (`materials/`, `private-instructor/`). Throws only when BOTH reject; the v1
 * error is preferred (most callers are still v1) but the two-repo invariant
 * still fails closed — a private-space path in the public repo is rejected by
 * both checks. Pure: no IO, no framework imports.
 */
function assertPathAllowedInEitherContract(path: string, repo: RepoKind): void {
  try {
    assertPathAllowedInRepo(path, repo);
    return; // valid under v1
  } catch (v1Err) {
    try {
      assertPathAllowedInRepoV2(path, repo);
      return; // valid under v2
    } catch {
      throw v1Err; // neither accepts it — surface the v1 message
    }
  }
}

/** True if a path resolves to a PUBLIC location under v1 layers OR v2 spaces.
 *  Root-allowlisted files (v1 layer null) are public-safe. Used by the carrier
 *  placement check so v2 `assets/…` is recognized as public alongside v1
 *  `materials/…`. */
function isInPublicLocation(path: string): boolean {
  try {
    const layer = layerForPath(path);
    if (layer === null || LAYER_REPO[layer] === "public") return true;
  } catch {
    // fall through to the v2 attempt
  }
  try {
    return SPACE_REPO[spaceForPath(path)] === "public";
  } catch {
    return false;
  }
}

export interface ProjectFile {
  repo: RepoKind; // "public" | "private"
  path: string;
}

export interface ValidateInput {
  /** Parsed/raw alembic.json (validated here via parseManifest). */
  manifest: unknown;
  /** Every file in the project tree, each tagged with its declared repo. */
  files: ProjectFile[];
}

export interface ValidateOptions {
  /**
   * Known carrier file extensions, e.g.
   * [".ketcher.svg", ".plot.svg", ".md.html", ".slides.html"].
   * INJECTED by the caller (from the kind registry) — never imported here.
   */
  knownCarrierExtensions: string[];
}

export interface ValidationIssue {
  /** Repo-relative path the issue is about, when applicable. */
  path?: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/** Chapter slug → study-guide file path. Mirrors the platform convention
 *  (`study-guide/<slug>.md`); kept inline because package-contract may not
 *  depend on package-ops. */
function chapterStudyGuidePath(slug: string): string {
  return `study-guide/${slug}.md`;
}

/** A file under materials/ (v1) or assets/ (v2) that *looks* like a carrier
 *  (renderable payload). */
function looksLikeCarrier(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.startsWith("materials/") && !normalized.startsWith("assets/")) {
    return false;
  }
  return (
    normalized.endsWith(".svg") ||
    normalized.endsWith(".html") ||
    normalized.endsWith(".pdf")
  );
}

function matchesKnownCarrier(path: string, extensions: string[]): boolean {
  const normalized = path.replace(/\\/g, "/");
  return extensions.some((ext) => normalized.endsWith(ext));
}

/**
 * Validate a whole project tree against the package contract.
 *
 * Checks (all collected; never throws on a validation problem):
 *  1. The manifest parses (zod errors → one issue per problem).
 *  2. Every file path is allowed in its declared repo (two-repo invariant).
 *  3. If the manifest declares chapters, each chapter's study-guide file
 *     (`study-guide/<slug>.md`) exists in `files`.
 *  4. Every KNOWN carrier file sits in a PUBLIC layer (assets/documents are
 *     public). A known carrier under a private layer is an ERROR.
 *  5. A file that LOOKS like a carrier (.svg/.html/.pdf under materials/) but
 *     matches no known extension is a WARNING-level issue: it is reported (so
 *     the author notices an unregistered/typo'd kind) but does NOT by itself
 *     fail validation. Rationale: materials/ legitimately holds plain images
 *     and handouts; we surface the ambiguity without blocking upload.
 *
 * `ok` is true iff there are no ERROR-level issues. Warnings are still listed in
 * `issues` (prefixed "Heads up:") but do not flip `ok` to false.
 */
export function validateProject(
  input: ValidateInput,
  opts: ValidateOptions,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  // Track warnings separately so they don't fail the project.
  let errorCount = 0;
  const addError = (issue: ValidationIssue) => {
    errorCount++;
    issues.push(issue);
  };
  const addWarning = (issue: ValidationIssue) => {
    issues.push({ ...issue, message: `Heads up: ${issue.message}` });
  };

  // 1. Manifest parses.
  let manifest: ReturnType<typeof parseManifest> | undefined;
  try {
    manifest = parseManifest(input.manifest);
  } catch (err) {
    const zodIssues =
      err && typeof err === "object" && "issues" in err
        ? (err as { issues: Array<{ path: Array<string | number>; message: string }> }).issues
        : undefined;
    if (zodIssues && zodIssues.length > 0) {
      for (const zi of zodIssues) {
        const where = zi.path.length ? ` (${zi.path.join(".")})` : "";
        addError({
          path: "alembic.json",
          message: `The package settings file (alembic.json) is invalid${where}: ${zi.message}.`,
        });
      }
    } else {
      addError({
        path: "alembic.json",
        message: `The package settings file (alembic.json) could not be read.`,
      });
    }
  }

  // 2. Every file path allowed in its declared repo (dual-mode: v1 layers OR
  //    v2 spaces — a package mid-migration or a native v2 layout validates).
  for (const file of input.files) {
    try {
      assertPathAllowedInEitherContract(file.path, file.repo);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "path is not allowed in this repository";
      addError({
        path: file.path,
        message: `"${file.path}" cannot be stored in the ${file.repo} part of the package: ${message}.`,
      });
    }
  }

  // 3. Declared chapters have their study-guide page present.
  if (manifest?.chapters && manifest.chapters.length > 0) {
    const present = new Set(
      input.files.map((f) => f.path.replace(/\\/g, "/").replace(/^\/+/, "")),
    );
    for (const chapter of manifest.chapters) {
      const expected = chapterStudyGuidePath(chapter.slug);
      if (!present.has(expected)) {
        addError({
          path: expected,
          message: `Chapter "${chapter.title}" is listed but its study-guide page (${expected}) is missing.`,
        });
      }
    }
  }

  // 4 & 5. Carrier placement checks.
  for (const file of input.files) {
    const normalized = file.path.replace(/\\/g, "/").replace(/^\/+/, "");
    const isKnownCarrier = matchesKnownCarrier(normalized, opts.knownCarrierExtensions);

    if (isKnownCarrier) {
      // Known carriers must be public. Dual-mode: public under v1 layers OR v2
      // spaces (so `assets/…` is accepted alongside `materials/…`). If the path
      // can't be classified in either contract, treat as non-public → error.
      if (!isInPublicLocation(normalized)) {
        addError({
          path: normalized,
          message: `Reusable media "${normalized}" must live in a public folder (under materials/ or assets/) so it can be shown and shared. It is currently in a private folder.`,
        });
      }
    } else if (looksLikeCarrier(normalized)) {
      // Looks like a carrier but matches no registered kind — warn only.
      addWarning({
        path: normalized,
        message: `"${normalized}" looks like an interactive figure but its type isn't recognized. If it should be editable, check the file name; otherwise it will be treated as a plain image.`,
      });
    }
  }

  return { ok: errorCount === 0, issues };
}
