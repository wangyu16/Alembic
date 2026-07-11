"use client";

import { useState } from "react";
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
 * overwrites it at the same path (so the permalink is preserved) and then reloads
 * so the editor shows the new content — including the hosted editors, whose
 * session-cached render is cleared by a full reload.
 */
export function DocumentActionsBar({
  packageId,
  path,
}: {
  packageId: string;
  /** The document's repo-relative path (e.g. `study-guide/01-energy.md`). */
  path: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const clean = path.replace(/^\/+/, "");
  const space = clean.split("/")[0] ?? "";
  const name = clean.split("/").pop() ?? clean;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={`/api/asset/${packageId}/${clean}`}
        download={name}
        className="btn btn-ghost btn-xs"
        title="Download this document to edit offline"
      >
        Download
      </a>
      <ReplaceFileButton
        packageId={packageId}
        space={space}
        path={clean}
        name={name}
        onDone={() => window.location.reload()}
        onError={setError}
      />
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </div>
  );
}
