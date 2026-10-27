/**
 * The 1.x orz editors (FC-19), loaded client-side on demand (K4 §3 step 3).
 * Each kind's package is a separate dynamic import, so a page pays only for
 * the editor it opens (slides with reveal.js is about 1 MB).
 */
import type { Editor, EditorHooks, EditorMode } from "orz-mdhtml-browser";

export type OrzKind = "md" | "slides" | "paged";

/** What Alembic uses from any of the three packages. */
export interface OrzKit {
  mountEditor(el: HTMLElement, options: {
    text: string;
    mode?: EditorMode;
    chrome?: "full" | "compact" | "none";
    readOnly?: boolean;
    nonce?: string;
    includes?: Record<string, string>;
    fileName?: string;
    hooks?: EditorHooks;
  }): OrzEditor;
  assemble(text: string, options?: Record<string, unknown>): Promise<string>;
  extract(html: string): { text: string; kind?: string } | null;
  readDocument(text: string): { uid?: string | null; title?: string | null };
  /** FC-18 §9 header edit (null removes a key); never re-serializes the header. */
  editHeader(text: string, changes: Readonly<Record<string, string | null>>): string;
  version: string;
}

/** FC-19 2.4.0 additions, present at run time on all three (typings lag for md/paged). */
export interface OrzEditor extends Editor {
  applyEdits?(edits: ReadonlyArray<{ from: number; to: number; insert: string }>, options?: { label?: string }): boolean;
  flash?(ranges: ReadonlyArray<{ from: number; to: number }>, options?: { ms?: number }): void;
}

export async function loadKit(kind: OrzKind): Promise<OrzKit> {
  switch (kind) {
    case "md": return (await import("orz-mdhtml-browser")) as unknown as OrzKit;
    case "slides": return (await import("orz-slides-browser")) as unknown as OrzKit;
    case "paged": return (await import("orz-paged-browser")) as unknown as OrzKit;
  }
}

/** The kind of a working-repo text file, from its name. */
export function kindOfPath(path: string): OrzKind | null {
  if (/\.slides\.md$/i.test(path)) return "slides";
  if (/\.paged\.md$/i.test(path)) return "paged";
  if (/\.md$/i.test(path)) return "md";
  return null;
}

/**
 * The smallest single replacement turning `from` into `to` (common prefix and
 * suffix kept), for bringing another person's synced change into the open
 * editor without resetting the cursor or the undo history.
 */
export function diffEdit(from: string, to: string): { from: number; to: number; insert: string } | null {
  if (from === to) return null;
  let a = 0;
  const max = Math.min(from.length, to.length);
  while (a < max && from.charCodeAt(a) === to.charCodeAt(a)) a++;
  let b = 0;
  while (b < max - a && from.charCodeAt(from.length - 1 - b) === to.charCodeAt(to.length - 1 - b)) b++;
  return { from: a, to: from.length - b, insert: to.slice(a, to.length - b) };
}
