import { z } from "zod";

/**
 * The file-type registry (collections framework, CF0;
 * docs/specs/collections-framework.md §3).
 *
 * A collection can hold any file. What Alembic *does* with a file — insert it,
 * open it, or only offer a download — is decided by its **handling class**, not
 * its raw extension. Every supported extension maps to exactly one class, so a
 * new type an educator adds always has a defined behavior.
 *
 * Pure schema + lookup: no IO, no framework imports (this package is the schema
 * owner). The permalink class follows from the handling class (SteeringNote §3):
 * `document` → a Document permalink (view/cite, never inserted); everything else
 * → an Object permalink (raw bytes served as `src`, or a download).
 */

/** How a file may be used. `document` = a self-contained view (open/cite);
 *  the `insertable-*` classes embed as `src`; `opaque-download` is bytes only. */
export const HANDLING_CLASSES = [
  "document",
  "insertable-image",
  "insertable-media",
  "insertable-source",
  "opaque-download",
] as const;

export type HandlingClass = (typeof HANDLING_CLASSES)[number];

/**
 * The in-app editor a creatable type mounts (CF6). `md`/`slides`/`paged` mount
 * the self-contained file's own in-file editor (hosted carrier); `ketcher`/`plot`
 * mount an editor-kit WYSIWYG surface; `markdown` is a plain-text source editor.
 * Matches the carrier kinds registered in the workspace's editor-module registry.
 */
export const EDITOR_KINDS = ["markdown", "md", "slides", "paged", "ketcher", "plot"] as const;
export type EditorKind = (typeof EDITOR_KINDS)[number];

export interface FileTypeDef {
  /** Lowercase extension including the dot, e.g. `.md.html`, `.ketcher.svg`. */
  extension: string;
  /** Educator-facing label. */
  label: string;
  /** How the file may be used. */
  class: HandlingClass;
  /** True when Alembic can CREATE one in-app (has an in-file editor/builder).
   *  Uploaded-only types are `false`. */
  creatable?: boolean;
  /** The in-app editor kind (CF6) — present only on creatable types. Drives
   *  which editing surface the workspace mounts (see EditorKind). */
  editorKind?: EditorKind;
}

/**
 * Built-in registry — the base every package gets. Order does not matter;
 * resolution is by **longest matching suffix** (below), so `.ketcher.svg` wins
 * over the generic `.svg`, and `.md.html` over `.html`.
 *
 * Roadmap creatable formats (`.excalidraw.svg`, `.mol.html`, `.sim.html`, CF6)
 * are intentionally NOT listed: each classifies correctly via its base
 * extension (`.svg` → image, `.html` → document) until its own editor ships and
 * earns a dedicated, better-labelled entry here.
 */
export const BUILTIN_FILE_TYPES: readonly FileTypeDef[] = [
  // Documents — self-contained views (open / cite, never inserted).
  { extension: ".md.html", label: "Study guide / page", class: "document", creatable: true, editorKind: "md" },
  { extension: ".slides.html", label: "Slide deck", class: "document", creatable: true, editorKind: "slides" },
  { extension: ".paged.html", label: "Print document", class: "document", creatable: true, editorKind: "paged" },
  // `.html` (a plain web page) has no in-app editor yet — uploaded only until
  // its builder ships (CF6 scope: the five orz carriers + plain markdown).
  { extension: ".html", label: "Web page", class: "document" },
  // Insertable images.
  { extension: ".ketcher.svg", label: "Chemical structure", class: "insertable-image", creatable: true, editorKind: "ketcher" },
  { extension: ".plot.svg", label: "Plot", class: "insertable-image", creatable: true, editorKind: "plot" },
  { extension: ".svg", label: "Vector image", class: "insertable-image" },
  { extension: ".png", label: "Image", class: "insertable-image" },
  { extension: ".jpg", label: "Image", class: "insertable-image" },
  { extension: ".jpeg", label: "Image", class: "insertable-image" },
  { extension: ".gif", label: "Image", class: "insertable-image" },
  { extension: ".webp", label: "Image", class: "insertable-image" },
  { extension: ".avif", label: "Image", class: "insertable-image" },
  // Insertable media.
  { extension: ".mp3", label: "Audio", class: "insertable-media" },
  { extension: ".wav", label: "Audio", class: "insertable-media" },
  { extension: ".m4a", label: "Audio", class: "insertable-media" },
  { extension: ".ogg", label: "Audio", class: "insertable-media" },
  { extension: ".mp4", label: "Video", class: "insertable-media" },
  { extension: ".webm", label: "Video", class: "insertable-media" },
  { extension: ".mov", label: "Video", class: "insertable-media" },
  // Insertable source (markdown include / data).
  { extension: ".md", label: "Markdown", class: "insertable-source", creatable: true, editorKind: "markdown" },
  { extension: ".csv", label: "Data (CSV)", class: "insertable-source" },
  // Opaque downloads.
  { extension: ".pdf", label: "PDF", class: "opaque-download" },
  { extension: ".zip", label: "Archive", class: "opaque-download" },
  { extension: ".docx", label: "Word document", class: "opaque-download" },
  { extension: ".xlsx", label: "Spreadsheet", class: "opaque-download" },
  { extension: ".pptx", label: "Presentation", class: "opaque-download" },
];

/** The default for any extension not in the registry — never rejected; it is the
 *  educator's own repo. Download-only until they teach Alembic the type. */
export const DEFAULT_HANDLING_CLASS: HandlingClass = "opaque-download";

/**
 * A per-package registry extension (additive, versioned — CLAUDE.md rule 9).
 * The educator's "add a supported type" writes here; they pick the class from
 * `HANDLING_CLASSES`, so behavior stays known. `creatable` is not offered — an
 * educator-added type is uploaded, never generated in-app.
 */
export const FileTypeDefSchema = z.object({
  extension: z
    .string()
    .min(2)
    .regex(/^\.[A-Za-z0-9.]+$/, "extension must start with a dot, e.g. .foo"),
  label: z.string().min(1),
  class: z.enum(HANDLING_CLASSES),
});
export type FileTypeDefInput = z.infer<typeof FileTypeDefSchema>;

/** Final segment of a path, lowercased (drops directories, normalizes slashes). */
function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
}

/**
 * Resolve the file-type definition for a path: per-package additions first (so
 * an educator can override a built-in), then the built-ins, by **longest
 * matching extension**. Returns `undefined` when nothing matches.
 */
export function fileTypeForPath(
  path: string,
  extraTypes: readonly FileTypeDef[] = [],
): FileTypeDef | undefined {
  const name = basename(path);
  if (!name) return undefined;
  // Per-package entries win over built-ins at equal specificity, so scan them
  // first and only fall back to built-ins for a strictly longer built-in match.
  const candidates = [...extraTypes, ...BUILTIN_FILE_TYPES];
  let best: FileTypeDef | undefined;
  for (const def of candidates) {
    const ext = def.extension.toLowerCase();
    if (!name.endsWith(ext)) continue;
    if (!best || ext.length > best.extension.length) best = def;
  }
  return best;
}

/** The handling class for a path; the default (`opaque-download`) when unknown. */
export function classForPath(
  path: string,
  extraTypes: readonly FileTypeDef[] = [],
): HandlingClass {
  return fileTypeForPath(path, extraTypes)?.class ?? DEFAULT_HANDLING_CLASS;
}

/** True when a file at `path` can be inserted into a document (any insertable
 *  class); false for `document` (which is opened/cited) and `opaque-download`. */
export function isInsertable(cls: HandlingClass): boolean {
  return cls === "insertable-image" || cls === "insertable-media" || cls === "insertable-source";
}

const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".m4v", ".ogv"];
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".ogg", ".oga", ".aac", ".flac"];

/**
 * Build the insert-ready cross-reference for a shared element (permalinks
 * §"objects: insert"). The reference is an ABSOLUTE permalink URL baked into the
 * source at insert time (pinned by docId), so the document renders the element
 * standalone — in the workspace preview, on the published site, AND in a
 * downloaded copy — with no view-time URL assembly. The class decides the form:
 *
 *  - `insertable-image`  → Markdown image `![alt](url)` (renders as `<img>`)
 *  - `insertable-media`  → an HTML `<video>`/`<audio controls>` (by extension)
 *  - `insertable-source` → a Markdown link `[alt](url)` (a `.md`/`.csv` opens at
 *    the permalink; inlining its TEXT is transclusion — a separate operation)
 *
 * `url` must be the full absolute permalink (`https://host/d/{docId}`). `alt`
 * defaults to the filename; Markdown-breaking brackets are stripped.
 */
export function insertReference(opts: {
  cls: HandlingClass;
  path: string;
  url: string;
  alt?: string;
}): string {
  const alt = (opts.alt ?? basename(opts.path)).replace(/[[\]]/g, "").trim();
  const lower = opts.path.toLowerCase();
  switch (opts.cls) {
    case "insertable-image":
      return `![${alt}](${opts.url})`;
    case "insertable-media":
      if (VIDEO_EXTENSIONS.some((e) => lower.endsWith(e)))
        return `<video src="${opts.url}" controls style="max-width:100%"></video>`;
      if (AUDIO_EXTENSIONS.some((e) => lower.endsWith(e)))
        return `<audio src="${opts.url}" controls></audio>`;
      return `[${alt}](${opts.url})`;
    case "insertable-source":
      // Markdown transcludes: the `{{md-include url}}` directive is resolved by
      // orz-markdown's `prepareSources` pre-pass at render/publish time — the
      // fetched markdown is inlined, so the document is standalone. Other source
      // (e.g. `.csv`) has no transclusion form → a link.
      if (lower.endsWith(".md")) return `{{md-include ${opts.url}}}`;
      return `[${alt}](${opts.url})`;
    default:
      // document / opaque-download are not inserted — return the bare link.
      return `[${alt}](${opts.url})`;
  }
}

/** The built-in types Alembic can create in-app (for the "New" menu). */
export const CREATABLE_FILE_TYPES: readonly FileTypeDef[] = BUILTIN_FILE_TYPES.filter(
  (t) => t.creatable,
);

/**
 * The in-app editor kind for a path (CF6), or `undefined` when the type has no
 * editor (uploaded-only). Resolves via the same longest-suffix match as
 * `fileTypeForPath`, so `.md.html` → `md` (never `markdown` for the base `.md`).
 */
export function editorKindForPath(
  path: string,
  extraTypes: readonly FileTypeDef[] = [],
): EditorKind | undefined {
  return fileTypeForPath(path, extraTypes)?.editorKind;
}

/**
 * Whether a creatable type's file is SEEDED at create time (a text/HTML stub
 * written immediately) or created LAZILY on first save. The self-contained
 * documents and plain markdown are seeded so the editor has a file to mount;
 * the WYSIWYG image editors (`ketcher`/`plot`) open empty and write the SVG on
 * first save, so no server-side seed is possible (rendering is client-side).
 */
export function isSeededOnCreate(editorKind: EditorKind): boolean {
  return editorKind !== "ketcher" && editorKind !== "plot";
}
