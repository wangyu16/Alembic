"use client";

import { useEffect, useState } from "react";
import { ReplaceFileButton } from "./replace-file-button";

/**
 * Download + Replace for a single course document (study guide, slides, practice,
 * concept map, assessment guide, …) — the offline round-trip (U1) for the
 * per-chapter documents, matching the Replace button the collection views (Assets
 * / Private / Current) already have.
 *
 * The document's space is its top-level folder (`study-guide/…` → `study-guide`,
 * `slides/…` → `slides`, `concepts/…` → `concepts`), which is all
 * `replaceCollectionFileAction` needs. Download serves the stored file; Replace
 * writes it into the document at its canonical path (so the permalink is
 * preserved) — creating it when the document had no file yet — and then reloads
 * so the editor shows the new content, including the hosted editors, whose
 * session-cached render is cleared by a full reload.
 *
 * The reload would wipe any confirmation the action returned ("Saved as the
 * slides for …"), which is exactly the message an educator needs when the file
 * they picked was named something else. So the note is parked in
 * `sessionStorage` for the moment the reload takes and shown on the way back —
 * where the content landed is never left unsaid.
 */

/** Survives exactly one reload. Keyed by document, so a list of documents
 *  shows the note on the one that was actually written. */
function noticeKey(packageId: string, path: string): string {
  return `alembic:doc-placement:${packageId}:${path}`;
}

export function DocumentActionsBar({
  packageId,
  path,
}: {
  packageId: string;
  /** The document's repo-relative path (e.g. `study-guide/01-energy.md`). */
  path: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const clean = path.replace(/^\/+/, "");
  const space = clean.split("/")[0] ?? "";
  const name = clean.split("/").pop() ?? clean;

  // Pick up (and consume) a note left by the replace that caused this reload.
  useEffect(() => {
    try {
      const key = noticeKey(packageId, clean);
      const parked = window.sessionStorage.getItem(key);
      if (parked) {
        window.sessionStorage.removeItem(key);
        setNotice(parked);
      }
    } catch {
      // Private-mode / storage-disabled: the reload simply shows no note.
    }
  }, [packageId, clean]);

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <a
        href={`/api/asset/${packageId}/${clean}`}
        download={name}
        aria-label="Download to edit offline"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-elevated hover:text-ink"
        title="Download this document to edit offline"
      >
        {/* Download-from-tray — mirrors the Replace glyph (arrow down vs up). */}
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
        >
          <path d="M8 3v7" />
          <path d="M5 7l3 3 3-3" />
          <path d="M3 10.5v1.5A1.5 1.5 0 0 0 4.5 13.5h7a1.5 1.5 0 0 0 1.5-1.5v-1.5" />
        </svg>
      </a>
      <ReplaceFileButton
        packageId={packageId}
        space={space}
        path={clean}
        name={name}
        onDone={(note) => {
          if (note) {
            try {
              window.sessionStorage.setItem(noticeKey(packageId, clean), note);
            } catch {
              // Storage unavailable — show it now instead; the reload follows.
              setNotice(note);
            }
          }
          window.location.reload();
        }}
        onError={setError}
      />
      {error && <span className="ml-1 text-[11px] text-danger">{error}</span>}
      {!error && notice && <span className="ml-1 text-[11px] text-faint">{notice}</span>}
    </div>
  );
}
