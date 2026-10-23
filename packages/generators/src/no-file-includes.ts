/**
 * D-39 guard for the worker tier, until the generators move to the 1.x
 * carriers (Phase 5 Track C.1).
 *
 * This process loads orz-markdown 1.x (through orz-mdhtml 0.9, orz-slides
 * 0.8 and orz-paged 0.7), whose shared `md` resolves file-include directives
 * (`{{md path}}`, `{{markdown path}}`, `{{md-include path}}`) from
 * `process.cwd()` and reads ANY local file (`{{md /etc/hosts}}`,
 * `{{md ../.env}}`). The `build*Html` entry points used here render in the
 * reader's browser, not in this process (the adversarial test checks the
 * generated files too), but the 0.x packages also render server-side in other
 * entry points (orz-slides `render-slide`, orz-paged `render-paged`), so the
 * reader is closed for the whole process as defence in depth. orz-markdown
 * 2.0 fixed this upstream (includes are opt-in); the 0.x carriers are pinned
 * to kit 1.x.
 *
 * The kit's `{{name}}` registry is global and read at render time, and pnpm
 * gives the carriers the same orz-markdown 1.x module instance as this
 * package, so registering these aliases again replaces the file reader for
 * every render in the process. They render nothing — exactly what kit 2.x
 * does without `markdownBasePath`/`readFile`. URL includes are not affected
 * (they are a separate, async `prepareSources` pass the generators never run).
 *
 * Remove this module when `orz-markdown` 1.x leaves the dependency tree.
 */

import { register } from "orz-markdown";

export const FILE_INCLUDE_ALIASES = ["markdown", "md", "md-include"] as const;

let installed = false;

/** Disable file includes in the process's kit-1.x renderer (idempotent). */
export function disableFileIncludes(): void {
  if (installed) return;
  register({ type: "block", aliases: [...FILE_INCLUDE_ALIASES], render: () => "" });
  installed = true;
}

disableFileIncludes();
