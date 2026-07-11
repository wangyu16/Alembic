/**
 * Pure decision helpers for the generalized collection upload door
 * (collections framework, CF2; docs/specs/collections-framework.md §2, §3, §5).
 *
 * These encode the storage + size policy (decision 3): follow GitHub's limits
 * (warn near 50 MB, block at 100 MB), and require a package to be *published*
 * before it can accept binary (non-UTF-8-text) uploads — a trial package lives
 * in Postgres and stays text-only. No IO, no framework imports: unit-testable
 * in isolation and reused by the server action.
 */

/** GitHub's hard limit — a single blob cannot exceed 100 MB. */
const HARD_LIMIT_BYTES = 100 * 1024 * 1024;
/** GitHub's soft limit — files past this make a clone slow; warn but allow. */
const WARN_LIMIT_BYTES = 50 * 1024 * 1024;

/**
 * Extensions whose content is UTF-8 text and can be stored directly in Postgres
 * on a trial package. Longest-suffix first so a compound text doc (`.md.html`,
 * `.ketcher.svg`) is recognized before its bare base — though every entry here
 * is independently text, so the base extensions (`.html`, `.svg`) already cover
 * the compounds; they are listed explicitly for clarity and intent.
 */
const TEXT_EXTENSIONS = [
  ".md.html",
  ".slides.html",
  ".paged.html",
  ".ketcher.svg",
  ".plot.svg",
  ".markdown",
  ".md",
  ".txt",
  ".csv",
  ".json",
  ".html",
  ".svg",
] as const;

/**
 * TRUE when a file's content cannot be stored as UTF-8 text (images, PDFs,
 * audio/video, archives, Office docs, …) and therefore needs the published,
 * GitHub-backed store. Text files (`.md`, `.csv`, `.json`, `.html`, `.svg`, and
 * the compound self-contained docs) return false. Case-insensitive, and matches
 * on the basename so a directory segment with a dot cannot fool it.
 */
export function isBinaryPath(filename: string): boolean {
  const base = filename
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .split("/")
    .pop()!
    .toLowerCase();
  // Longest-suffix wins: check the compound/text extensions in declared order.
  for (const ext of TEXT_EXTENSIONS) {
    if (base.endsWith(ext)) return false;
  }
  return true;
}

export interface UploadVerdictInput {
  /** Whether the content is non-UTF-8-text (see {@link isBinaryPath}). */
  isBinary: boolean;
  /** Whether the package is published (GitHub-backed, `storage === "github"`). */
  isPublished: boolean;
  /** Decoded byte length of the content the caller will store. */
  sizeBytes: number;
}

export interface UploadVerdict {
  ok: boolean;
  /** Present when `ok` is false — an educator-facing reason to block. */
  error?: string;
  /** Present when `ok` is true but the file is large — a non-blocking nudge. */
  warning?: string;
}

/**
 * Decide whether an upload may proceed, applying the storage gate and the
 * GitHub size policy in that order. Educator-facing copy (no Git jargon).
 */
export function uploadVerdict({
  isBinary,
  isPublished,
  sizeBytes,
}: UploadVerdictInput): UploadVerdict {
  if (isBinary && !isPublished) {
    return {
      ok: false,
      error:
        "Publish this course to GitHub first to upload images, PDFs, and other files — text files work now.",
    };
  }
  if (sizeBytes > HARD_LIMIT_BYTES) {
    return { ok: false, error: "GitHub can't store a file larger than 100 MB." };
  }
  if (sizeBytes > WARN_LIMIT_BYTES) {
    return {
      ok: true,
      warning:
        "Files over 50 MB make the repository slow to clone — consider linking to the file instead.",
    };
  }
  return { ok: true };
}
