"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

interface Issue {
  path?: string;
  message: string;
}

/**
 * Import a whole package the educator authored offline as a `.zip` (e.g. with an
 * AI agent following the `alembic-package` skill). Posts the archive to
 * `/api/import-package`, which validates it and creates a new trial package.
 * On success, opens the new package; on failure, shows the specific problems so
 * the author can fix them and re-upload. Text content imports now; any media
 * files are surfaced as a follow-up.
 */
export function ImportPackage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[] | null>(null);

  async function onPick(file: File) {
    setBusy(true);
    setIssues(null);
    setError(null);
    setSkipped(null);
    try {
      const body = new FormData();
      body.append("package", file);
      const res = await fetch("/api/import-package", { method: "POST", body });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        if (data.skippedBinaries?.length) {
          // Show the note briefly, then open the package.
          setSkipped(data.skippedBinaries as string[]);
          setBusy(false);
          setTimeout(() => router.push(`/workspace/${data.packageId}`), 50);
          return;
        }
        router.push(`/workspace/${data.packageId}`);
        return;
      }
      if (data?.issues) setIssues(data.issues as Issue[]);
      else setError(data?.error ?? "That package couldn't be imported.");
    } catch {
      setError("Something went wrong reading that file. Please try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="mt-4 border-t border-edge pt-4">
      <p className="text-sm text-muted">
        Or <span className="text-ink">import a package</span> you built offline —
        upload a <code className="text-xs">.zip</code> and it opens as a trial you
        can review, then publish.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label
          className={`btn btn-ghost ${busy ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
        >
          {busy ? "Importing…" : "Import a .zip package"}
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPick(f);
            }}
          />
        </label>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {skipped && skipped.length > 0 && (
        <p className="mt-3 text-xs text-ok">
          Imported. {skipped.length} media file{skipped.length === 1 ? "" : "s"} (images/PDFs)
          weren&apos;t added — publish the course, then upload them. Opening the package…
        </p>
      )}

      {issues && issues.length > 0 && (
        <div className="mt-3 rounded-lg border border-danger/40 bg-danger/5 p-3">
          <p className="text-sm font-medium text-danger">
            This package couldn&apos;t be imported. Fix these and try again:
          </p>
          <ul className="mt-2 space-y-1 text-sm text-ink">
            {issues.map((iss, i) => (
              <li key={i}>
                {iss.path && <code className="text-xs text-muted">{iss.path}</code>}{" "}
                {iss.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
