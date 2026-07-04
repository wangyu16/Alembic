"use client";

import { useEffect, useRef } from "react";
import type { EditorHandle, EditorTheme } from "@alembic/editor-kit";
import { editorRegistry } from "./index";

/**
 * Mount an editor module (by carrier kind) into a host div, bridging the
 * framework-agnostic `EditorModule` to React. `onReady` hands the parent the
 * live handle so it can pull `getSource()`/`renderPayload()` on save.
 */
export function ModuleMount({
  kind,
  source,
  readOnly,
  theme,
  onChange,
  hostSave,
  onDirty,
  onReady,
  className,
}: {
  kind: string;
  source: string;
  readOnly?: boolean;
  theme?: EditorTheme;
  onChange?: (next: { source: string; rendered: string }) => void;
  /** Persist a file-initiated save (orz-host-save); the result becomes the
   *  in-file ack. Route through the validated write path. */
  hostSave?: (payload: { source: string; rendered: string }) => Promise<{ ok: boolean; error?: string }>;
  onDirty?: (dirty: boolean) => void;
  onReady?: (handle: EditorHandle) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest callbacks without forcing a remount.
  const cbs = useRef({ onChange, onReady, hostSave, onDirty });
  cbs.current = { onChange, onReady, hostSave, onDirty };

  useEffect(() => {
    const el = ref.current;
    const module = editorRegistry.get(kind);
    if (!el || !module) return;
    const handle = module.mount(el, {
      source,
      readOnly,
      theme,
      onChange: (next) => cbs.current.onChange?.(next),
      hostSave: (payload) =>
        cbs.current.hostSave
          ? cbs.current.hostSave(payload)
          : Promise.resolve({ ok: true }),
      onDirty: (dirty) => cbs.current.onDirty?.(dirty),
    });
    cbs.current.onReady?.(handle);
    return () => handle.destroy();
    // Remount only when the file/kind changes, not on callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, source, readOnly, theme]);

  if (!editorRegistry.has(kind)) {
    return <p className="text-sm text-muted">No editor module for “{kind}”.</p>;
  }
  return <div ref={ref} className={className ?? "h-full w-full"} />;
}
