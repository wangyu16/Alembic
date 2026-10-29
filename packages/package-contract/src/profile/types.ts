/**
 * A content profile (FD-10): what a project of one kind is. Alembic's core
 * (storage, permissions, the write path, Publish, the workspace) knows no
 * course concepts; it asks the active profile. The Coursewerk OER profile is
 * the first one (FD-09: Coursewerk owns course content). Pure data and pure
 * functions only.
 */
import type { PackageSpace } from "../spaces";

/**
 * What a path is to the project, in the core's generic terms. The core maps
 * each class to a permission (access.ts); the profile never names a role.
 */
/** Kinds of non-text file the core knows how to check (contract v3 §11.4). */
export type MediaKind = "png" | "jpeg" | "gif" | "webp" | "svg";

export type PathClass =
  | "material"          // what readers see (study guides, slides, practice, figures)
  | "plan"              // the unit's plan (concept map, assessment guide): approved before publishing
  | "project-file"      // project-wide files the owner/deputy maintain (README, records, site config)
  | "private-editable"  // instructor-only documents members may write
  | "private-protected" // private files only the server or a harness writes
  | "settings";         // the manifest: only through course operations

export interface UnitPart {
  /** Stable id of the part within the profile (e.g. "study-guide"). */
  readonly id: string;
  /** What educators call it. */
  readonly label: string;
  /** The part's file for a unit slug. */
  path(slug: string): string;
  /** Shown on the published site (vs. kept in the public copy only). */
  readonly published: boolean;
  /** Part of the unit's plan (approved before the unit is published). */
  readonly plan: boolean;
  /** The text a newly started part begins with. */
  starter(unitTitle: string, uid: string): string;
}

export interface ContentProfile {
  /** e.g. "coursewerk-oer". */
  readonly id: string;
  /** The version of the owner's definitions this profile follows. */
  readonly version: string;
  /** Root files allowed in a project. */
  readonly rootFiles: readonly string[];
  /** Top-level folders and the space each one is. */
  readonly folders: Readonly<Record<string, PackageSpace>>;
  /** Private subfolders allowed (fail closed on any other). */
  readonly privateSubfolders: readonly string[];
  /** Unit slugs that may not be used (they collide with a project file). */
  readonly reservedUnitSlugs: readonly string[];
  /** The unit's parts, in order; the first `required` ones must exist for every listed unit. */
  readonly unitParts: readonly UnitPart[];
  /** Parts every listed unit must have (ids). */
  readonly requiredParts: readonly string[];
  /** Where a figure added to a document is stored (a folder path, no trailing slash). */
  figureFolder(docPath: string): string;
  /** Non-text files a project may hold (figures and media): extension → kind. */
  readonly media: Readonly<Record<string, MediaKind>>;
  /** Licences a project may carry, and which of them are open. */
  readonly licences: { readonly allowed: readonly string[]; readonly open: readonly string[] };
  /** Classify a normalised, classifiable path (the core has already applied hygiene and its own mechanics paths). */
  pathClass(path: string, space: PackageSpace): PathClass;
  /** Tree-aware problems with a manifest's units against the project's files (empty = valid). */
  unitProblems(units: ReadonlyArray<{ slug: string; title: string }>, files: ReadonlySet<string>): string[];
}
