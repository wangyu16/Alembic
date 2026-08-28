"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  MAX_PACKAGE_ZIP_BYTES,
  MAX_PACKAGE_ZIP_LABEL,
  packageTooLargeMessage,
} from "@alembic/package-ops";

interface Issue {
  path?: string;
  message: string;
}

/** The server's plan summary — what this upload would do to this course. */
interface PlanDiff {
  counts: {
    adds: number;
    replaces: number;
    unchanged: number;
    removes: number;
    blockers: number;
    images: number;
  };
  adds: string[];
  replaces: string[];
  blockers: string[];
}

type Phase =
  | { kind: "idle" }
  | { kind: "sending"; percent: number }
  | { kind: "checking" }
  | { kind: "confirm"; diff: PlanDiff; warnings: Issue[]; stagingPath: string }
  | { kind: "writing"; note: string }
  | { kind: "resumable"; message: string; stagingPath: string; emptyFirst: boolean }
  | { kind: "done"; message: string };

/**
 * Upload a whole course package (`.zip`) into a published course.
 *
 * ## How the upload actually travels (rewritten 2026-08-28)
 *
 * The file no longer goes through the API route: it is uploaded straight to the
 * private staging area with a signed URL, and only a short reference is posted
 * to `/api/populate-package`. That is what makes a 20 MB package with images
 * work at all — posting it through a serverless function hit a ~4.5 MB platform
 * ceiling and came back as an unexplained failure.
 *
 * ## What the educator sees
 *
 * Four steps, each with its own state and its own plain-language failure:
 *  1. **Sending** — a real progress percentage, because a large file takes a
 *     while and silence reads as a hang.
 *  2. **Checking** — the server plans the upload and answers with a diff.
 *  3. **Confirm** — exactly what will be added, replaced and cleared out
 *     before anything is written (the Tier-3 approval this action needs). If
 *     the course already holds work the package doesn't cover, that work is
 *     listed as a blocker with one deliberate way past it: empty the course.
 *  4. **Adding to your course** — the run itself, which resumes automatically
 *     if the server runs out of time, and can be resumed by hand if anything
 *     else interrupts it. Re-running never duplicates anything: the server
 *     re-plans and skips whatever already landed.
 */
export function PopulatePackageBanner({ packageId }: { packageId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy =
    phase.kind === "sending" || phase.kind === "checking" || phase.kind === "writing";

  function reset() {
    setIssues(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  /* ------------------------------------------------------------ step 1–2 --- */

  async function onPick(file: File) {
    reset();

    if (file.size === 0) {
      setPhase({ kind: "idle" });
      setError("That file is empty. Choose the .zip you exported.");
      return;
    }
    if (file.size > MAX_PACKAGE_ZIP_BYTES) {
      setPhase({ kind: "idle" });
      setError(packageTooLargeMessage(file.size));
      return;
    }

    setPhase({ kind: "sending", percent: 0 });
    let stagingPath: string;
    try {
      stagingPath = await sendToStaging(packageId, file, (percent) =>
        setPhase({ kind: "sending", percent }),
      );
    } catch (err) {
      setPhase({ kind: "idle" });
      setError(
        err instanceof Error
          ? err.message
          : "The upload didn't finish. Nothing in your course changed — please try again.",
      );
      return;
    }

    setPhase({ kind: "checking" });
    const res = await post({ packageId, stagingPath, mode: "preview" });
    if (!res.ok) {
      setPhase({ kind: "idle" });
      showFailure(res.data, "We couldn't read that package.");
      return;
    }
    setPhase({
      kind: "confirm",
      diff: res.data.diff as PlanDiff,
      warnings: Array.isArray(res.data.warnings) ? (res.data.warnings as Issue[]) : [],
      stagingPath,
    });
  }

  /* -------------------------------------------------------------- step 4 --- */

  async function run(stagingPath: string, emptyFirst: boolean) {
    reset();
    setPhase({ kind: "writing", note: "Adding your package to the course…" });

    let total = 0;
    // Each pass commits as much as it can inside the server's time budget and
    // reports what is left; we simply ask again until it is done.
    for (let pass = 0; pass < 12; pass += 1) {
      const res = await post({ packageId, stagingPath, mode: "apply", emptyFirst });
      const data = res.data;

      if (!res.ok) {
        // Stopped, but everything already added is saved: offer to continue.
        if (data?.stage === "interrupted") {
          setPhase({
            kind: "resumable",
            message: String(
              data.error ??
                "The upload stopped partway. Nothing was lost — pick up where it left off.",
            ),
            stagingPath,
            emptyFirst,
          });
          return;
        }
        // Something in the package itself needs fixing, so continuing would hit
        // the same wall. Say what to fix and let them upload a corrected .zip;
        // what already went in stays in.
        if (data?.stage === "incomplete") {
          if (data.issues) setIssues(data.issues as Issue[]);
          setError(typeof data.error === "string" ? data.error : null);
          setPhase({ kind: "idle" });
          void post({ packageId, stagingPath, mode: "cancel" });
          return;
        }
        setPhase({ kind: "idle" });
        showFailure(data, "That package couldn't be added to the course.");
        return;
      }

      total += Number(data.filesCommitted ?? 0);
      if (data.stage === "partial") {
        setPhase({
          kind: "writing",
          note: `Added ${total} file${total === 1 ? "" : "s"} so far — ${data.remaining} to go…`,
        });
        continue;
      }

      const images = Number(data.imagesCommitted ?? 0);
      const skippedCount = Number(data.skipped ?? 0);
      const nothingToDo = total === 0 && skippedCount > 0;
      setPhase({
        kind: "done",
        message: nothingToDo
          ? "Everything in this package is already in your course. Nothing needed to change."
          : `Added ${total} file${total === 1 ? "" : "s"}` +
            (images ? ` (including ${images} image${images === 1 ? "" : "s"})` : "") +
            (skippedCount ? `, and ${skippedCount} were already in place` : "") +
            ". Opening your course…",
      });
      setTimeout(() => router.refresh(), 800);
      return;
    }

    setPhase({
      kind: "resumable",
      message:
        "This is a big package, so it's taking more than one round. Everything added so far is saved — continue when you're ready.",
      stagingPath,
      emptyFirst,
    });
  }

  async function cancelUpload(stagingPath: string) {
    setPhase({ kind: "idle" });
    reset();
    await post({ packageId, stagingPath, mode: "cancel" });
  }

  function showFailure(data: ResponseBody, fallback: string) {
    if (Array.isArray(data?.issues)) setIssues(data.issues as Issue[]);
    else setError(typeof data?.error === "string" ? data.error : fallback);
  }

  if (dismissed) return null;

  /* ------------------------------------------------------------- render --- */

  return (
    <div className="fixed left-1/2 top-16 z-40 w-[min(92vw,42rem)] -translate-x-1/2">
      <div className="panel border-[var(--accent)]/50 bg-elevated p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-medium text-ink">Fill this course from a package</h2>
            <p className="mt-1 text-sm text-muted">
              Built a course package offline? Upload the{" "}
              <code className="text-xs">.zip</code> to fill this course in —
              study guides, slides, and{" "}
              <span className="text-ink">images and all</span>. You&apos;ll see
              exactly what it adds before anything changes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            disabled={busy}
            className="shrink-0 text-sm text-faint hover:text-ink disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>

        {/* Step 1–2: pick and send. */}
        {(phase.kind === "idle" || phase.kind === "done") && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="btn btn-primary cursor-pointer">
              Choose package .zip
              <input
                ref={inputRef}
                type="file"
                accept=".zip,application/zip"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPick(f);
                }}
              />
            </label>
            <span className="text-xs text-faint">
              Up to {MAX_PACKAGE_ZIP_LABEL}. Uploading the same package again is
              always safe — it picks up where it left off.
            </span>
          </div>
        )}

        {phase.kind === "sending" && (
          <div className="mt-4">
            <p className="text-sm text-muted">Sending your package… {phase.percent}%</p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-edge-soft">
              <div
                className="h-full bg-[var(--accent)] transition-[width] duration-200"
                style={{ width: `${Math.max(2, phase.percent)}%` }}
              />
            </div>
          </div>
        )}

        {phase.kind === "checking" && (
          <p className="mt-4 text-sm text-muted">Checking the package…</p>
        )}

        {phase.kind === "writing" && (
          <p className="mt-4 text-sm text-muted">{phase.note}</p>
        )}

        {/* Step 3: the plan diff + explicit confirmation. */}
        {phase.kind === "confirm" && (
          <ConfirmPlan
            diff={phase.diff}
            warnings={phase.warnings}
            onCancel={() => void cancelUpload(phase.stagingPath)}
            onConfirm={(emptyFirst) => void run(phase.stagingPath, emptyFirst)}
          />
        )}

        {phase.kind === "resumable" && (
          <div className="mt-4 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-3">
            <p className="text-sm text-ink">{phase.message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void run(phase.stagingPath, phase.emptyFirst)}
              >
                Continue the upload
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void cancelUpload(phase.stagingPath)}
              >
                Stop here
              </button>
            </div>
          </div>
        )}

        {phase.kind === "done" && <p className="mt-3 text-sm text-ok">{phase.message}</p>}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        {issues && issues.length > 0 && (
          <div className="mt-3 rounded-lg border border-danger/40 bg-danger/5 p-3">
            <p className="text-sm font-medium text-danger">
              Fix these in your package, then upload it again:
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

/* ------------------------------------------------------------------------- */

/**
 * The confirmation: what this upload does, in files, before it does it. When the
 * course already holds work the package doesn't cover, that work is listed and
 * the only way forward is the deliberate, separately-typed "empty this course"
 * choice — nothing is deleted by implication.
 */
function ConfirmPlan({
  diff,
  warnings,
  onConfirm,
  onCancel,
}: {
  diff: PlanDiff;
  warnings: Issue[];
  onConfirm: (emptyFirst: boolean) => void;
  onCancel: () => void;
}) {
  const { counts } = diff;
  const blocked = counts.blockers > 0;

  return (
    <div className="mt-4 rounded-lg border border-edge bg-surface/60 p-3">
      <p className="text-sm font-medium text-ink">
        {blocked ? "Before this can go ahead" : "Ready to add to your course"}
      </p>

      <ul className="mt-2 space-y-1 text-sm text-muted">
        <li>
          <span className="text-ink">{counts.adds}</span> new file
          {counts.adds === 1 ? "" : "s"}
          {counts.images > 0 && ` (${counts.images} of them images)`}
        </li>
        {counts.replaces > 0 && (
          <li>
            <span className="text-ink">{counts.replaces}</span> file
            {counts.replaces === 1 ? "" : "s"} already in this course would be{" "}
            <span className="text-ink">overwritten</span>
          </li>
        )}
        {counts.unchanged > 0 && (
          <li>
            <span className="text-ink">{counts.unchanged}</span> already match the
            package and will be left alone
          </li>
        )}
        {counts.removes > 0 && (
          <li>
            <span className="text-ink">{counts.removes}</span> starter placeholder
            {counts.removes === 1 ? "" : "s"} cleared out
          </li>
        )}
      </ul>

      {diff.replaces.length > 0 && (
        <FileList label="Overwritten" paths={diff.replaces} total={counts.replaces} />
      )}

      {warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-edge bg-elevated p-3">
          <p className="text-xs font-medium text-muted">
            Worth knowing (this won&apos;t stop the upload):
          </p>
          <ul className="mt-1 space-y-1 text-sm text-muted">
            {warnings.map((w, i) => (
              <li key={i}>
                {w.path && <code className="text-xs">{w.path}</code>} {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {blocked && (
        <div className="mt-3 rounded-lg border border-danger/40 bg-danger/5 p-3">
          <p className="text-sm text-ink">
            This course already has {counts.blockers} file
            {counts.blockers === 1 ? "" : "s"} that this package doesn&apos;t
            include. Uploading now would mix the two together.
          </p>
          <FileList label="Already here" paths={diff.blockers} total={counts.blockers} />
          <p className="mt-2 text-sm text-muted">
            Keep them by uploading into a different course — or empty this course
            first and start from the package.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {blocked ? (
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              if (
                window.confirm(
                  `Empty this course and upload?\n\nThe ${counts.blockers} file(s) listed as already here will be deleted from this course — including from its saved copy online — and replaced with the package. This can't be undone from here.`,
                )
              ) {
                onConfirm(true);
              }
            }}
          >
            Empty this course and upload
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => onConfirm(false)}>
            Add to my course
          </button>
        )}
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function FileList({
  label,
  paths,
  total,
}: {
  label: string;
  paths: string[];
  total: number;
}) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-muted">
        {label} ({total})
      </summary>
      <ul className="mt-1 space-y-0.5">
        {paths.map((p) => (
          <li key={p}>
            <code className="text-xs text-muted">{p}</code>
          </li>
        ))}
        {total > paths.length && (
          <li className="text-xs text-faint">…and {total - paths.length} more</li>
        )}
      </ul>
    </details>
  );
}

/* ---------------------------------------------------------------- plumbing */

type ResponseBody = Record<string, unknown> & { issues?: unknown; error?: unknown };

/** POST JSON to the populate route; never throws, always yields a body to read. */
async function post(
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; data: ResponseBody }> {
  try {
    const res = await fetch("/api/populate-package", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = ((await res.json().catch(() => null)) ?? {}) as ResponseBody;
    return { ok: res.ok && data.ok === true, data };
  } catch {
    return {
      ok: false,
      data: {
        error:
          "We couldn't reach Alembic just then — check your connection and try again. Your course is unchanged.",
      },
    };
  }
}

/** Why the staging area turned the file away — said in the educator's terms. */
function refusedMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Your sign-in expired while the file was going up. Reload the page, sign in again, and upload once more — your course is unchanged.";
  }
  if (status === 413) {
    return `That file is too large to upload (the limit is ${MAX_PACKAGE_ZIP_LABEL}). Your course is unchanged.`;
  }
  return `The upload was turned away (code ${status}). Nothing in your course changed — please try again in a moment.`;
}

/**
 * Put the archive in the staging area with a one-shot signed URL and return the
 * path the server will read it from. `XMLHttpRequest`, not `fetch`, purely
 * because it reports upload progress.
 */
async function sendToStaging(
  packageId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<string> {
  const res = await fetch("/api/staging-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packageId, filename: file.name, sizeBytes: file.size }),
  }).catch(() => null);
  const ticket = ((await res?.json().catch(() => null)) ?? {}) as {
    ok?: boolean;
    path?: string;
    signedUrl?: string;
    error?: string;
  };
  if (!res || !ticket.ok || !ticket.signedUrl || !ticket.path) {
    throw new Error(
      ticket.error ??
        "We couldn't start the upload. Check your connection and try again — your course is unchanged.",
    );
  }

  // Same request the Supabase SDK's `uploadToSignedUrl` makes — a PUT of a
  // multipart body to the signed URL (the token in the URL is the credential).
  // XMLHttpRequest instead of the SDK only because it reports upload progress.
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", file);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", ticket.signedUrl!);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(refusedMessage(xhr.status)));
    xhr.onerror = () =>
      reject(
        new Error(
          "The upload didn't finish — check your connection and try again. Nothing in your course changed.",
        ),
      );
    xhr.onabort = () =>
      reject(new Error("The upload was stopped. Nothing in your course changed."));
    xhr.send(form);
  });

  onProgress(100);
  return ticket.path;
}
