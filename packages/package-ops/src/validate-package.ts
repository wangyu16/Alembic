/**
 * The import-ready whole-package validator (offline-authoring / upload path).
 *
 * `validateProject` in `@alembic/package-contract` is PURE — it deliberately
 * does not import a carrier-kind registry, so the caller must inject the set of
 * known carrier extensions. This module is that caller: it wires the platform's
 * real carrier extensions from `@alembic/carriers` into `validateProject`, so
 * there is exactly ONE assembled "is this package valid + two-repo-safe?" call.
 *
 * It is the single check the importer runs server-side AND the target an
 * offline author (or their AI agent) validates against before uploading a zip
 * or pushing to GitHub: *if `validatePackageForImport` passes, Alembic ingests
 * the package with zero friction.*
 */

import {
  validateProject,
  type ValidateInput,
  type ValidationResult,
} from "@alembic/package-contract";
import { BUILTIN_KINDS, PAGED_KIND } from "@alembic/carriers";

/**
 * The renderable-carrier extensions Alembic recognizes: the self-contained
 * documents (`.md.html`, `.slides.html`, `.paged.html`) and the editable image
 * objects (`.ketcher.svg`, `.plot.svg`). A file with one of these extensions
 * must live in a PUBLIC location (`assets/` or `materials/`). Derived from the
 * carrier registry so the list can never drift from what the platform actually
 * knows how to render/edit.
 */
export const KNOWN_CARRIER_EXTENSIONS: string[] = [
  ...BUILTIN_KINDS.map((k) => k.extension),
  PAGED_KIND.extension,
];

/**
 * Validate a whole package (files + manifest) for import, with the platform's
 * carrier extensions injected. Returns the collected issues; `ok` is true when
 * there are no ERROR-level issues (warnings are listed but don't block).
 */
export function validatePackageForImport(input: ValidateInput): ValidationResult {
  return validateProject(input, {
    knownCarrierExtensions: KNOWN_CARRIER_EXTENSIONS,
  });
}
