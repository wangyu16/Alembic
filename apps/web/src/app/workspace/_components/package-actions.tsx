"use client";

import { useState, useTransition } from "react";
import {
  archivePackageAction,
  deletePackageAction,
  renamePackageAction,
} from "../lifecycle-actions";

type Mode = "idle" | "menu" | "rename" | "confirm";

export function PackageActions({
  packageId,
  title,
  storage,
}: {
  packageId: string;
  title: string;
  storage: "sandbox" | "github";
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isPublished = storage === "github";

  function close() {
    setMode("idle");
    setError(null);
    setDraft(title);
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) close();
      else setError(res.error ?? "That didn't complete. Please try again.");
    });
  }

  if (mode === "rename") {
    return (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => renamePackageAction(packageId, draft));
        }}
      >
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="field h-8 w-36 min-w-0 text-sm sm:w-48"
          aria-label="New name"
        />
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={close} className="btn btn-ghost btn-sm">
          Cancel
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </form>
    );
  }

  if (mode === "confirm") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">
          {isPublished
            ? "Hide from workspace & unlist publicly? You can restore it."
            : "Delete permanently? This can't be undone."}
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(() =>
              isPublished
                ? archivePackageAction(packageId)
                : deletePackageAction(packageId),
            )
          }
          className="btn btn-danger btn-sm"
        >
          {pending ? "Working…" : isPublished ? "Archive" : "Delete"}
        </button>
        <button type="button" onClick={close} className="btn btn-ghost btn-sm">
          Cancel
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    );
  }

  if (mode === "menu") {
    return (
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setMode("rename")} className="btn btn-ghost btn-sm">
          Rename
        </button>
        <button type="button" onClick={() => setMode("confirm")} className="btn btn-ghost btn-sm">
          {isPublished ? "Archive" : "Delete"}
        </button>
        <button type="button" onClick={close} className="btn btn-ghost btn-sm" aria-label="Close menu">
          ✕
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setMode("menu")}
      className="btn btn-ghost btn-sm"
      aria-label="More actions"
    >
      ⋯
    </button>
  );
}
