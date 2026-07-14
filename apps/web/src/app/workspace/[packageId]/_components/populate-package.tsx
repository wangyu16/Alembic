"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

interface Issue {
  path?: string;
  message: string;
}

/**
 * Empty-state call-to-action shown inside a PUBLISHED, still-EMPTY package: the
 * educator built a package offline (e.g. with an AI agent) and now fills this
 * course in by uploading the `.zip`. Posts to `/api/populate-package`, which
 * commits every valid file — images included — into the paired repos and clears
 * the starter placeholders. Rendered as a fixed card so it never disturbs the
 * editor shell's height; dismissible, so the placeholder can also be edited by
 * hand. Disappears once the package has content (the server stops rendering it).
 */
export function PopulatePackageBanner({ packageId }: { packageId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onPick(file: File) {
    if (
      !window.confirm(
        "Upload this package into the course? It replaces the starter placeholders with your files.",
      )
    ) {
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setBusy(true);
    setIssues(null);
    setError(null);
    setDone(null);
    try {
      const body = new FormData();
      body.append("package", file);
      body.append("packageId", packageId);
      const res = await fetch("/api/populate-package", { method: "POST", body });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        const imgs = data.imagesCommitted as number;
        setDone(
          `Uploaded ${data.filesCommitted} file${data.filesCommitted === 1 ? "" : "s"}` +
            (imgs ? ` (including ${imgs} image${imgs === 1 ? "" : "s"})` : "") +
            ". Opening your course…",
        );
        setTimeout(() => router.refresh(), 600);
        return;
      }
      if (data?.issues) setIssues(data.issues as Issue[]);
      else setError(data?.error ?? "That package couldn't be uploaded.");
    } catch {
      setError("Something went wrong reading that file. Please try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  if (dismissed) return null;

  return (
    <div className="fixed left-1/2 top-16 z-40 w-[min(92vw,42rem)] -translate-x-1/2">
      <div className="panel border-[var(--accent)]/50 bg-elevated p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-medium text-ink">This course is empty</h2>
            <p className="mt-1 text-sm text-muted">
              Built a package offline? Upload the{" "}
              <code className="text-xs">.zip</code> to fill this course in —
              study guides, slides, and <span className="text-ink">images and all</span>.
              It replaces the starter placeholders.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="shrink-0 text-sm text-faint hover:text-ink"
          >
            Dismiss
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label
            className={`btn btn-primary ${busy ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
          >
            {busy ? "Uploading…" : "Upload package .zip"}
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
          <span className="text-xs text-faint">Up to 50 MB.</span>
        </div>

        {done && <p className="mt-3 text-sm text-ok">{done}</p>}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        {issues && issues.length > 0 && (
          <div className="mt-3 rounded-lg border border-danger/40 bg-danger/5 p-3">
            <p className="text-sm font-medium text-danger">
              This package couldn&apos;t be uploaded. Fix these and try again:
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
    </div>
  );
}
