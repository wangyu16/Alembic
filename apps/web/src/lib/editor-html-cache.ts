/**
 * Per-tab, per-session memo of generated hosted-editor HTML (subtask P2.2; see
 * docs/specs/workspace-collections.md §2a item 2).
 *
 * Alembic hosts the self-contained orz `.md.html` / `.slides.html` in-file
 * editors in iframes. Producing each one is a Fly.io worker round-trip that
 * returns a ~0.84–1 MB inline bundle. Once document-switching is one click, a
 * naive mount would fire rapid-fire regenerations with visible "Preparing the
 * editor…" stalls. This memo makes "switch away and back" instant and
 * worker-free.
 *
 * CORRECTNESS (this is the whole point — a stale hit is worse than a slow miss):
 *  - KEY = (packageId, path, title). Those are every input to generation EXCEPT
 *    the theme, which the server resolves from the manifest. The client can't
 *    key on a value it doesn't have, so instead the generate action RETURNS the
 *    resolved theme and we store it ON the entry; a save that changes the theme
 *    invalidates the memo (below). A hit is therefore always under the current
 *    theme.
 *  - A SAVE mutates the source. We overwrite the entry with the file's own
 *    `rendered` bytes — the exact state it just serialized — so switching back
 *    mounts the SAVED document, never the pre-save one.
 *  - A save that CHANGES THE THEME makes every other document's baked shell
 *    stale (theme is global per space), so we clear the whole memo.
 *  - Scoped by packageId in the key (never mixes packages or, being per-tab
 *    module state, users). NEVER persisted — a ~1 MB blob per document would
 *    blow localStorage/sessionStorage quota and outlive deploys. Gone on reload.
 *  - Bounded to the MAX_ENTRIES most-recently-used entries.
 */

const MAX_ENTRIES = 6;

interface Entry {
  packageId: string;
  path: string;
  title: string;
  /** Resolved theme baked into `html` (server-resolved; see hosted-actions.ts). */
  theme?: string;
  html: string;
}

// Most-recently-used LAST. Module-level → exactly one per browser tab, and it
// evaporates on reload. Deliberately NOT localStorage/sessionStorage (see file
// header): the blobs are ~1 MB each and must not persist across deploys.
const entries: Entry[] = [];

function indexOf(packageId: string, path: string, title: string): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.packageId === packageId && e.path === path && e.title === title) return i;
  }
  return -1;
}

/**
 * Pure read: the cached HTML for this document, or undefined. Does NOT reorder,
 * so it is safe to call during render (e.g. a lazy useState initializer). Use
 * `touchEditorHtml` from an effect to mark it most-recently-used.
 */
export function peekEditorHtml(
  packageId: string,
  path: string,
  title: string,
): string | undefined {
  const i = indexOf(packageId, path, title);
  return i === -1 ? undefined : entries[i].html;
}

/** Mark an entry most-recently-used. Call from an effect, never during render. */
export function touchEditorHtml(packageId: string, path: string, title: string): void {
  const i = indexOf(packageId, path, title);
  if (i === -1) return;
  const [e] = entries.splice(i, 1);
  entries.push(e);
}

/** Insert or overwrite an entry, mark it MRU, and evict beyond MAX_ENTRIES. */
export function storeEditorHtml(
  packageId: string,
  path: string,
  title: string,
  html: string,
  theme?: string,
): void {
  const i = indexOf(packageId, path, title);
  if (i !== -1) entries.splice(i, 1);
  entries.push({ packageId, path, title, theme, html });
  while (entries.length > MAX_ENTRIES) entries.shift();
}

/**
 * Record a successful hosted-editor save. The file handed us `rendered` — its
 * own current serialization, i.e. exactly the bytes it would write — so we cache
 * that as the fresh entry: switching away and back mounts the saved state with
 * no worker call. If the save changed the theme (relative to what this document
 * was generated under) then every OTHER document's baked shell is stale, so we
 * clear the whole memo before re-storing this one.
 */
export function recordEditorSave(args: {
  packageId: string;
  path: string;
  title: string;
  rendered: string;
  theme?: string;
}): void {
  const { packageId, path, title, rendered, theme } = args;
  const i = indexOf(packageId, path, title);
  const themeChanged = i !== -1 && entries[i].theme !== theme;
  if (themeChanged) entries.length = 0;
  storeEditorHtml(packageId, path, title, rendered, theme);
}
