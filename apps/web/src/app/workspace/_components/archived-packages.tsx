"use client";

import { useState, useTransition } from "react";
import { restorePackageAction } from "../lifecycle-actions";

export interface ArchivedPackage {
  id: string;
  title: string;
  archivedAt: string;
}

export function ArchivedPackages({ packages }: { packages: ArchivedPackage[] }) {
  const [open, setOpen] = useState(false);

  if (packages.length === 0) return null;

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-lg font-medium text-ink"
        aria-expanded={open}
      >
        <span className="text-faint">{open ? "▾" : "▸"}</span>
        Archived ({packages.length})
      </button>

      {open && (
        <>
          <p className="mt-2 text-sm text-muted">
            Archived packages are hidden from your workspace and unlisted from the
            public index. Their published sites stay live — restore anytime. To
            delete one for good, delete its repositories on GitHub; Alembic clears
            it from here once it sees them gone.
          </p>
          <ul className="panel mt-3 divide-y divide-[var(--edge-soft)]">
            {packages.map((pkg) => (
              <ArchivedRow key={pkg.id} pkg={pkg} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ArchivedRow({ pkg }: { pkg: ArchivedPackage }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <li className="flex items-center justify-between px-4 py-3">
      <div>
        <div className="font-medium text-ink">{pkg.title}</div>
        <div className="text-xs text-faint">
          archived {new Date(pkg.archivedAt).toLocaleDateString()}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {error && <span className="text-xs text-danger">{error}</span>}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              const res = await restorePackageAction(pkg.id);
              if (!res.ok) setError(res.error ?? "Could not restore.");
            });
          }}
          className="btn btn-ghost btn-sm"
        >
          {pending ? "Restoring…" : "Restore"}
        </button>
      </div>
    </li>
  );
}
