"use client";

import { useRef, useState } from "react";
import { isBinaryPath } from "@/lib/collection-upload";
import { replaceCollectionFileAction } from "../collection-actions";

/**
 * "Replace with edited version" — the upload half of the offline document
 * round-trip (U1). The educator downloads a document (Open → save), edits it
 * offline, and picks it here to REPLACE the current version at its existing
 * path. Because the path is unchanged, the registry keeps the same docId, so
 * the document's permalink survives the round-trip.
 *
 * Read mode follows the TARGET path's type (not the picked file's name): a
 * binary slot reads base64, a text slot reads UTF-8 — so the bytes are encoded
 * the way that document is stored, and `replaceCollectionFileAction` commits a
 * binary as a real blob.
 */
export function ReplaceFileButton({
  packageId,
  space,
  path,
  name,
  disabled,
  onDone,
  onError,
}: {
  packageId: string;
  /** The document's contract space dir (fixes the repo). */
  space: string;
  /** The existing repo-relative path to replace. */
  path: string;
  /** Display name, for the confirm prompt. */
  name: string;
  disabled?: boolean;
  /** Called after a successful replace (refresh the list). `warning` is a
   *  non-blocking nudge (e.g. a large file). */
  onDone?: (warning?: string) => void;
  onError?: (message: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(file: File) {
    if (
      !window.confirm(
        `Replace “${name}” with “${file.name}”? This updates the current version in place — its share link stays the same.`,
      )
    ) {
      if (ref.current) ref.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const isBinary = isBinaryPath(path);
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => {
          const result = reader.result as string;
          resolve(isBinary ? (result.split(",", 2)[1] ?? "") : result);
        };
        if (isBinary) reader.readAsDataURL(file);
        else reader.readAsText(file);
      });
      const r = await replaceCollectionFileAction(packageId, {
        space,
        path,
        content,
        isBinary,
        sizeBytes: file.size,
      });
      if (!r.ok) onError?.(r.error ?? "Couldn't replace that document.");
      else onDone?.(r.warning);
    } catch {
      onError?.("Couldn't read that file. Please try again.");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <label
      aria-label={busy ? "Replacing…" : "Replace with an edited version"}
      aria-busy={busy || undefined}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-elevated hover:text-ink ${
        busy || disabled ? "pointer-events-none opacity-50" : "cursor-pointer"
      }`}
      title="Replace with an edited version (upload; keeps its share link)"
    >
      {/* Upload-into-tray — mirrors the Download glyph (arrow up vs down). */}
      <svg
        viewBox="0 0 16 16"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className={busy ? "animate-pulse" : undefined}
      >
        <path d="M8 10V3" />
        <path d="M5 6l3-3 3 3" />
        <path d="M3 10.5v1.5A1.5 1.5 0 0 0 4.5 13.5h7a1.5 1.5 0 0 0 1.5-1.5v-1.5" />
      </svg>
      <input
        ref={ref}
        type="file"
        className="sr-only"
        disabled={busy || disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onPick(f);
        }}
      />
    </label>
  );
}
