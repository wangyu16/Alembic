"use client";

import { useRef, useState, useTransition } from "react";
import type { EditorHandle, EditorTheme } from "@alembic/editor-kit";
import { extractSource, embedSource, getKindByExtension } from "@alembic/carriers";
import type { EditorKind } from "@alembic/package-contract";
import { ModuleMount } from "@/lib/editor-modules/module-mount";
import { useUnsavedGuard } from "@/lib/use-unsaved-guard";
import { saveCollectionFileAction } from "../collection-actions";
import { resolveIncludeAction } from "../include-actions";

/**
 * The shared in-workspace editor for a collection file (CF6). One pane, three
 * modalities driven by the file's `editorKind`:
 *
 *  - `markdown` (`.md`)      — a plain-text source editor (textarea + Save).
 *  - `md`/`slides`/`paged`   — the self-contained file's OWN in-file editor,
 *    mounted in a sandboxed iframe (hosted carrier); the file drives saves and
 *    we persist its re-serialized bytes (orz-host-save).
 *  - `ketcher`/`plot`        — an editor-kit WYSIWYG surface; on Save we render
 *    the SVG, re-embed the editable source (so it stays re-editable), and write.
 *
 * Every modality persists through the ONE validated door,
 * `saveCollectionFileAction` (repo derived from space → two-repo invariant).
 * The pane mounts the editor ONCE (never re-keyed) so an unsaved iframe/canvas
 * is never destroyed mid-edit; the parent unmounts it only on close.
 */
export function CollectionEditorPane({
  packageId,
  space,
  path,
  name,
  editorKind,
  initialContent,
  isNew,
  theme,
  onClose,
  onSaved,
  onDirty,
}: {
  packageId: string;
  /** Contract space dir (drives the repo via the two-repo invariant). */
  space: string;
  /** Full repo-relative path the file lives (or will live) at. */
  path: string;
  /** Display name (final path segment). */
  name: string;
  editorKind: EditorKind;
  /** Current file bytes; "" for a not-yet-written file (new ketcher/plot). */
  initialContent: string;
  /** True when this file does not exist yet (first save creates it). */
  isNew?: boolean;
  theme?: EditorTheme;
  onClose: () => void;
  /** Called after a successful save (parent refreshes the tree). */
  onSaved?: () => void;
  onDirty?: (dirty: boolean) => void;
}): React.JSX.Element {
  const hosted = editorKind === "md" || editorKind === "slides" || editorKind === "paged";
  const wysiwyg = editorKind === "ketcher" || editorKind === "plot";

  const [dirty, setDirtyState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);
  const [pending, start] = useTransition();
  useUnsavedGuard(dirty);

  const markDirty = (d: boolean) => {
    setDirtyState(d);
    onDirty?.(d);
  };

  const persist = (content: string) =>
    new Promise<{ ok: boolean; error?: string }>((resolve) => {
      start(async () => {
        const r = await saveCollectionFileAction(packageId, space, path, content);
        if (r.ok) {
          markDirty(false);
          setSavedTick(true);
          setTimeout(() => setSavedTick(false), 1500);
          onSaved?.();
        } else {
          setError(r.error ?? "Couldn't save.");
        }
        resolve(r);
      });
    });

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          ← Back
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-ink">{name}</span>
        {savedTick && <span className="text-xs text-ok">Saved</span>}
        {dirty && !savedTick && <span className="text-xs text-warn">Unsaved</span>}
        {hosted && (
          <span className="text-xs text-faint">Use the file’s own Save (top-right of the editor).</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-edge">
        {editorKind === "markdown" ? (
          <MarkdownSource
            initial={initialContent}
            onDirty={markDirty}
            onSave={(text) => persist(text)}
            pending={pending}
          />
        ) : hosted ? (
          // The self-contained file IS the source; its in-file editor host-saves
          // the full re-serialized bytes, which we persist verbatim.
          <ModuleMount
            kind={editorKind}
            source={initialContent}
            theme={theme}
            onDirty={markDirty}
            hostSave={async ({ rendered }) => persist(rendered)}
            resolveInclude={resolveIncludeAction}
          />
        ) : (
          <WysiwygCarrier
            editorKind={editorKind}
            path={path}
            initialContent={initialContent}
            isNew={isNew}
            theme={theme}
            onDirty={markDirty}
            onSave={persist}
            pending={pending}
          />
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/* ── .md — plain-text source editor ─────────────────────────────────────────── */
function MarkdownSource({
  initial,
  onDirty,
  onSave,
  pending,
}: {
  initial: string;
  onDirty: (d: boolean) => void;
  onSave: (text: string) => Promise<{ ok: boolean }>;
  pending: boolean;
}) {
  const [text, setText] = useState(initial);
  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <textarea
        className="field h-full w-full flex-1 resize-none font-mono text-sm"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          onDirty(true);
        }}
        placeholder="# Heading\n\nWrite Markdown here…"
      />
      <div className="flex justify-end">
        <button
          className="btn btn-primary btn-sm"
          disabled={pending}
          onClick={() => void onSave(text)}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/* ── .ketcher.svg / .plot.svg — editor-kit WYSIWYG + embed-on-save ───────────── */
function WysiwygCarrier({
  editorKind,
  path,
  initialContent,
  isNew,
  theme,
  onDirty,
  onSave,
  pending,
}: {
  editorKind: EditorKind;
  path: string;
  initialContent: string;
  isNew?: boolean;
  theme?: EditorTheme;
  onDirty: (d: boolean) => void;
  onSave: (content: string) => Promise<{ ok: boolean }>;
  pending: boolean;
}) {
  const handleRef = useRef<EditorHandle | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The editable source (KetJSON / Plotly spec) the module mounts — extracted
  // from the existing carrier, or empty for a brand-new file.
  const initialSource = (() => {
    if (isNew || !initialContent.trim()) return "";
    try {
      return extractSource(initialContent).source;
    } catch {
      return "";
    }
  })();

  const save = async () => {
    setError(null);
    const handle = handleRef.current;
    if (!handle) return;
    if (!handle.renderPayload) {
      setError("This editor can't export yet.");
      return;
    }
    const carrier = getKindByExtension(path);
    if (!carrier) {
      setError("Unknown structure type.");
      return;
    }
    try {
      const svg = await handle.renderPayload();
      if (!svg.trim()) {
        setError("Nothing to save yet — draw something first.");
        return;
      }
      const source = await handle.getSource();
      // Re-embed the editable source so the file stays re-editable next time.
      const file = embedSource({
        kind: carrier.id,
        format: carrier.formatVersion,
        payload: carrier.payload,
        rendered: svg,
        source,
      });
      await onSave(file);
    } catch {
      setError("Couldn't capture the drawing. Please try again.");
    }
  };

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <div className="min-h-0 flex-1 overflow-hidden rounded border border-edge-soft">
        <ModuleMount
          kind={editorKind}
          source={initialSource}
          theme={theme}
          onDirty={onDirty}
          onReady={(h) => (handleRef.current = h)}
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end">
        <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => void save()}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
