"use client";

import { useState, useTransition } from "react";
import { adaptElementAction } from "../workspace/[packageId]/adapt-actions";

export interface AdaptTarget {
  id: string;
  title: string;
}

/**
 * Discover-side "Adapt into my package" (P4 client): copy a shared object into
 * one of the educator's own packages. Only rendered for a signed-in educator
 * with at least one package; the server action re-checks ownership + that the
 * source is a shared public object, so this is purely the picker + feedback.
 */
export function ElementAdapt({
  docId,
  packages,
}: {
  docId: string;
  packages: AdaptTarget[];
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(packages[0]?.id ?? "");
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ ok: boolean; text: string; permalink?: string } | null>(null);

  if (packages.length === 0) return null;

  const submit = () => {
    setDone(null);
    start(async () => {
      const r = await adaptElementAction(target, docId);
      if (!r.ok) {
        setDone({ ok: false, text: r.error ?? "Couldn't add that element." });
        return;
      }
      setOpen(false);
      setDone({
        ok: true,
        text: r.already ? "Already in that package" : "Added to Assets",
        permalink: r.permalink,
      });
    });
  };

  if (done?.ok) {
    return (
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
        {done.text}
        {done.permalink && (
          <a href={done.permalink} target="_blank" rel="noreferrer" className="link">
            Open ↗
          </a>
        )}
      </span>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="link shrink-0 text-sm"
        title="Copy this element into one of your packages"
      >
        Adapt →
      </button>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1">
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        aria-label="Adapt into which package"
        className="field max-w-[10rem] text-xs"
      >
        {packages.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
      <button onClick={submit} disabled={pending || !target} className="btn btn-primary btn-sm">
        {pending ? "…" : "Add"}
      </button>
      <button
        onClick={() => {
          setOpen(false);
          setDone(null);
        }}
        className="btn btn-ghost btn-sm"
      >
        Cancel
      </button>
      {done && !done.ok && <span className="text-xs text-danger">{done.text}</span>}
    </span>
  );
}
