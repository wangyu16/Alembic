"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  serializeStudyGuide,
  type StudyGuideBlock,
} from "@alembic/package-contract";
import { saveStudyGuideAction } from "./actions";

interface EditorBlock extends StudyGuideBlock {
  /** Stable React key, independent of the (possibly null) block ID. */
  key: string;
}

type SaveState =
  | { kind: "idle" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

function newKey(): string {
  return crypto.randomUUID();
}

export function StudyGuideEditor({
  packageId,
  initialPath,
  initialPreamble,
  initialBlocks,
}: {
  packageId: string;
  initialPath: string;
  initialPreamble: string;
  initialBlocks: StudyGuideBlock[];
}) {
  const [preamble] = useState(initialPreamble);
  const [blocks, setBlocks] = useState<EditorBlock[]>(() =>
    initialBlocks.map((b) => ({ ...b, key: newKey() })),
  );
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [html, setHtml] = useState("");

  const source = useMemo(
    () => serializeStudyGuide(preamble, blocks),
    [preamble, blocks],
  );

  // Debounced live preview via the server render route (single render path).
  useEffect(() => {
    const id = setTimeout(async () => {
      try {
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source }),
        });
        const data = (await res.json()) as { html?: string };
        setHtml(data.html ?? "");
      } catch {
        /* preview is best-effort */
      }
    }, 350);
    return () => clearTimeout(id);
  }, [source]);

  const markDirty = useCallback(() => {
    setSave((s) => (s.kind === "saving" ? s : { kind: "dirty" }));
  }, []);

  const update = useCallback(
    (key: string, field: "title" | "body", value: string) => {
      setBlocks((bs) =>
        bs.map((b) => (b.key === key ? { ...b, [field]: value } : b)),
      );
      markDirty();
    },
    [markDirty],
  );

  const addBlock = useCallback(() => {
    setBlocks((bs) => [
      ...bs,
      { key: newKey(), id: null, title: "New section", body: "" },
    ]);
    markDirty();
  }, [markDirty]);

  const deleteBlock = useCallback(
    (key: string) => {
      setBlocks((bs) => bs.filter((b) => b.key !== key));
      markDirty();
    },
    [markDirty],
  );

  const move = useCallback(
    (key: string, dir: -1 | 1) => {
      setBlocks((bs) => {
        const i = bs.findIndex((b) => b.key === key);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= bs.length) return bs;
        const next = [...bs];
        [next[i], next[j]] = [next[j]!, next[i]!];
        return next;
      });
      markDirty();
    },
    [markDirty],
  );

  const onSave = useCallback(async () => {
    setSave({ kind: "saving" });
    const result = await saveStudyGuideAction(packageId, {
      path: initialPath,
      preamble,
      blocks: blocks.map(({ key: _key, ...b }) => b),
    });
    if (result.ok && result.blocks) {
      // Sync minted IDs back by position (order is preserved server-side).
      setBlocks((bs) =>
        bs.map((b, i) => ({ ...b, id: result.blocks![i]?.id ?? b.id })),
      );
      setSave({ kind: "saved" });
    } else {
      setSave({ kind: "error", message: result.error ?? "Save failed." });
    }
  }, [packageId, initialPath, preamble, blocks]);

  return (
    <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Editor column */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Study guide
          </h2>
          <div className="flex items-center gap-3">
            <SaveBadge state={save} />
            <button
              onClick={onSave}
              disabled={save.kind === "saving"}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {save.kind === "saving" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {blocks.length === 0 && (
          <p className="text-sm text-zinc-500">
            No sections yet. Add your first one below.
          </p>
        )}

        {blocks.map((block, i) => (
          <div
            key={block.key}
            className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <div className="mb-2 flex items-center gap-2">
              <input
                value={block.title}
                onChange={(e) => update(block.key, "title", e.target.value)}
                placeholder="Section heading"
                className="flex-1 rounded border border-zinc-200 bg-transparent px-2 py-1 font-medium dark:border-zinc-700"
              />
              <button
                onClick={() => move(block.key, -1)}
                disabled={i === 0}
                title="Move up"
                className="rounded px-2 py-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
              >
                ↑
              </button>
              <button
                onClick={() => move(block.key, 1)}
                disabled={i === blocks.length - 1}
                title="Move down"
                className="rounded px-2 py-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
              >
                ↓
              </button>
              <button
                onClick={() => deleteBlock(block.key)}
                title="Delete section"
                className="rounded px-2 py-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
              >
                ✕
              </button>
            </div>
            <textarea
              value={block.body}
              onChange={(e) => update(block.key, "body", e.target.value)}
              placeholder="Write in Markdown — chemistry (H~2~O) and math ($E=mc^2$) supported."
              rows={Math.max(3, block.body.split("\n").length + 1)}
              className="w-full resize-y rounded border border-zinc-200 bg-transparent px-2 py-1 font-mono text-sm dark:border-zinc-700"
            />
            <p className="mt-1 text-xs text-zinc-400">
              {block.id ? `id ${block.id}` : "new — id assigned on save"}
            </p>
          </div>
        ))}

        <button
          onClick={addBlock}
          className="rounded-md border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          + Add section
        </button>
      </div>

      {/* Preview column */}
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Preview
        </h2>
        <div
          className="prose prose-zinc max-w-none rounded-lg border border-zinc-200 p-4 dark:prose-invert dark:border-zinc-800"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  let label = "";
  if (state.kind === "dirty") label = "Unsaved changes";
  else if (state.kind === "saving") label = "Saving…";
  else if (state.kind === "saved") label = "Saved";
  else if (state.kind === "error") label = state.message;

  const tone =
    state.kind === "error"
      ? "text-red-600 dark:text-red-400"
      : state.kind === "saved"
        ? "text-green-600 dark:text-green-400"
        : "text-zinc-500";
  return <span className={`text-xs ${tone}`}>{label}</span>;
}
