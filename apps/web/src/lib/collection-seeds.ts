import "server-only";
import type { EditorKind } from "@alembic/package-contract";

/**
 * Seed source for a newly-created collection file (CF6). Only the SEEDED kinds
 * (`markdown` / `md` / `slides` / `paged`) have a server-side starter; the
 * WYSIWYG image kinds (`ketcher` / `plot`) open empty and write their SVG on
 * first save (see `isSeededOnCreate`), so they are not handled here.
 *
 * For `md` / `paged` the returned string is the orz-markdown SOURCE that the
 * generator wraps into a self-contained `.md.html` / `.paged.html`; for `slides`
 * it is an orz-slides DECK source; for plain `markdown` it is the `.md` file's
 * own bytes.
 */
export function seedSourceFor(kind: EditorKind, title: string): string {
  const t = title.trim() || "Untitled";
  switch (kind) {
    case "markdown":
    case "md":
    case "paged":
      return `# ${t}\n\n`;
    case "slides":
      return slidesDeckTemplate(t);
    case "ketcher":
    case "plot":
      throw new Error(`seedSourceFor: ${kind} files are seeded on first save, not at create`);
    default: {
      const never: never = kind;
      throw new Error(`seedSourceFor: unknown editor kind ${String(never)}`);
    }
  }
}

/** A minimal orz-slides deck scaffold — title · two content slides · closing.
 *  Mirrors the chapter-slides starter so a fresh collection deck opens usably. */
export function slidesDeckTemplate(title: string): string {
  const t = title.trim() || "Slides";
  return `<!-- deck
title: ${t}
ratio: 16:9
-->

<!-- slide template=title -->
# ${t}
## <subtitle>
**<your name>**

<!-- slide -->
## <First topic>

- <key point>
- <key point>
- <key point>

<!-- slide -->
## <Second topic>

- <key point>
- <key point>
- <key point>

<!-- slide template=closing -->
# Thank you

Questions?
`;
}
