"use client";

import { useEffect } from "react";

/**
 * Warn before losing in-progress edits. While `dirty` is true this:
 *  1. arms the browser's native `beforeunload` prompt (covers closing the tab,
 *     reloading, or navigating to an external URL), and
 *  2. intercepts in-app link clicks (capture phase, before Next's router) and
 *     asks for confirmation — covering "switch to another page / chapter /
 *     section" inside the editor.
 *
 * Links that don't lose the current edit are left alone: new-tab links
 * (`target="_blank"`), downloads (`download` attr or `/export`/`/api/` hrefs),
 * in-page anchors, and modified clicks (⌘/Ctrl/Shift/Alt or non-primary button).
 */
export const UNSAVED_MESSAGE =
  "You have unsaved changes. Leave without saving? Your edits since the last save will be lost.";

/**
 * Imperative unsaved-changes gate for controls that are NOT `<a>` link clicks —
 * e.g. a document/chapter switcher rendered as a `<button>` or `<select>` that
 * calls `router.push`, "open another file", "new note", etc.
 *
 * Why this exists (do NOT delete as unused before the nav redesign wires it up):
 * `useUnsavedGuard` cannot cover these. Its two mechanisms both miss non-anchor
 * client-side navigation —
 *   1. `beforeunload` does not fire on client-side Next.js router navigation, and
 *   2. the capture-phase click interceptor early-returns unless the click lands
 *      inside an `<a>` (`target.closest("a")`).
 * Hosted self-contained editors (the sandboxed `.md.html`/`.slides.html`
 * iframes) have no unsaved guard of their own, there is no save-on-unmount, and
 * the host cannot command a save (saves are file-initiated). So any non-anchor
 * control that triggers an iframe unmount runs `destroy()` and loses the
 * educator's edits silently. Such controls MUST call this before navigating.
 *
 * Returns `true` when it is safe to proceed (not dirty, or the user confirmed
 * discarding); `false` when the user cancelled and navigation must be aborted.
 * Uses the same confirmation copy as the anchor interceptor for consistency.
 */
export function confirmDiscard(dirty: boolean): boolean {
  if (!dirty) return true;
  return typeof window === "undefined" ? true : window.confirm(UNSAVED_MESSAGE);
}

export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy Chrome requires a returnValue to trigger the native prompt.
      e.returnValue = "";
    };

    const onClickCapture = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }
      // Don't guard links that don't navigate away from the editor.
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      if (href.includes("/export") || href.includes("/api/")) return;

      if (!window.confirm(UNSAVED_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [dirty]);
}
