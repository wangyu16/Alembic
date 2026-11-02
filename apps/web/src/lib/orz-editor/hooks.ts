/**
 * The FC-19 hooks for a document in a course (K4 §2). Pure apart from the
 * callbacks passed in; tested without a browser.
 */
import type { EditorHooks } from "orz-mdhtml-browser";
import { normalizePath } from "@alembic/package-contract";

export interface HookContext {
  packageId: string;
  /** The document's own path in the working repo (relative links resolve from its folder). */
  docPath: string;
  /** Keep the text on the device and tell the sync scheduler (A7). */
  saveToDevice(text: string): Promise<void>;
  /** Read another text file of the course (an include), or null. */
  readCourseText(path: string): Promise<string | null>;
  /** Asset paths already known to the page → URLs (resolveAsset must answer synchronously). */
  assetUrls: ReadonlyMap<string, string>;
  uploadAsset?(file: File): Promise<string>;
  /** A fresh document id from Alembic's registry. */
  mintUid(): Promise<string>;
}

/** Resolve `target` (as written in the document) against the document's folder; null if it leaves the course. */
export function resolveCoursePath(docPath: string, target: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//") || target.startsWith("#")) return null;
  const clean = target.split(/[?#]/, 1)[0]!;
  if (!clean) return null;
  const base = clean.startsWith("/") ? [] : docPath.split("/").slice(0, -1);
  const parts = [...base];
  for (const seg of clean.replace(/^\/+/, "").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (parts.length === 0) return null; parts.pop(); continue; }
    parts.push(seg);
  }
  try {
    return normalizePath(parts.join("/"));
  } catch {
    return null;
  }
}

export function makeHooks(c: HookContext): EditorHooks {
  const hooks: EditorHooks = {
    save: (text) => c.saveToDevice(text),
    // Course files only. Web includes wait for the fetch proxy (C6); until then they show "not available".
    fetchInclude: async (target) => {
      const p = resolveCoursePath(c.docPath, target);
      return p ? c.readCourseText(p) : null;
    },
    resolveAsset: (path) => {
      const p = resolveCoursePath(c.docPath, path);
      return (p && c.assetUrls.get(p)) ?? path;
    },
    resolveLink: (href) => {
      const p = resolveCoursePath(c.docPath, href);
      return p ? `/workspace/${encodeURIComponent(c.packageId)}/doc/${p.split("/").map(encodeURIComponent).join("/")}` : href;
    },
    mintUid: () => c.mintUid(),
  };
  if (c.uploadAsset) hooks.uploadAsset = c.uploadAsset;
  return hooks;
}
