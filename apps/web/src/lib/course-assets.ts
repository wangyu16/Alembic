/**
 * Course images in the workspace editor (RC.9): a course's own files are
 * served to its members by a members-only route, and the editor is given
 * the map from course path to that route's address.
 */
const TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", avif: "image/avif", pdf: "application/pdf",
};

/** The content type to serve a course file with, or null for files the route doesn't serve. */
export function assetContentType(path: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return ext ? (TYPES[ext] ?? null) : null;
}

/** The route address of a course file. */
export const assetUrl = (packageId: string, path: string) =>
  `/workspace/${encodeURIComponent(packageId)}/asset/${path.split("/").map(encodeURIComponent).join("/")}`;

/** Course path → address, for every servable file the person may see (instructor-only files only for those allowed). */
export function assetUrlMap(packageId: string, paths: readonly string[], mayReadPrivate: boolean): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of paths) {
    if (!assetContentType(p)) continue;
    if (p.startsWith("private/") && !mayReadPrivate) continue;
    out.set(p, assetUrl(packageId, p));
  }
  return out;
}
