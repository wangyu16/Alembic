"use client";

import { useEffect, useRef } from "react";
import type {
  EditorHandle,
  EditorTheme,
  HostAIOperation,
  HostAIRequest,
} from "@alembic/editor-kit";
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
  aiOperations,
  runAIOperation,
  resolveInclude,
  className,
}: {
  kind: string;
  source: string;
  readOnly?: boolean;
  theme?: EditorTheme;
  onChange?: (next: { source: string; rendered: string }) => void;
  /** Persist a file-initiated save (orz-host-save); the result becomes the
   *  in-file ack. Route through the validated write path. */
  hostSave?: (payload: { source: string; rendered: string; theme?: string }) => Promise<{ ok: boolean; error?: string }>;
  onDirty?: (dirty: boolean) => void;
  onReady?: (handle: EditorHandle) => void;
  /** AI operations advertised to the file's in-file assistant (orz-host-ai@1). */
  aiOperations?: HostAIOperation[];
  /** Run an operation the file's assistant requested. */
  runAIOperation?: (req: HostAIRequest) => Promise<{ ok: boolean; proposed?: string; error?: string }>;
  /** Resolve a web transclusion URL for the file's preview (orz-host-include@1). */
  resolveInclude?: (url: string) => Promise<string | null>;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest callbacks without forcing a remount.
  const cbs = useRef({ onChange, onReady, hostSave, onDirty, runAIOperation, resolveInclude });
  cbs.current = { onChange, onReady, hostSave, onDirty, runAIOperation, resolveInclude };

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
      aiOperations,
      runAIOperation: (req) =>
        cbs.current.runAIOperation
          ? cbs.current.runAIOperation(req)
          : Promise.resolve({ ok: false, error: "AI is not available here." }),
      // Only expose the include bridge when the caller wired a resolver at mount
      // — otherwise the host would announce an include bridge it can't serve.
      ...(resolveInclude
        ? { resolveInclude: (url: string) => cbs.current.resolveInclude!(url) }
        : {}),
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
