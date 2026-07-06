"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { publishToGitHubAction } from "../github-actions";

export interface PackageVersion {
  sha: string;
  message: string;
  date: string;
}

export interface PublishingState {
  configured: boolean;
  connected: boolean;
  published: boolean;
  publicRepoUrl: string | null;
  installUrl: string | null;
  versions: PackageVersion[];
  registered: boolean;
  /** The live public page URL once the website exists (gh-pages detected). */
  siteUrl: string | null;
  /** Returned from the GitHub-App install (?publish=1): auto-resume publishing. */
  autoPublish?: boolean;
}
import { publishSiteAction } from "../site-actions";
import { registerPackageAction, unregisterPackageAction } from "../portal-actions";

type GateFailure = { name: string; message: string };

/* ── icons (currentColor, ~16px) ─────────────────────────────────────────── */
const ico = "h-4 w-4 shrink-0";
function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" className={ico} fill="currentColor" aria-hidden>
      <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.34c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.52.56.83 1.28.83 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
    </svg>
  );
}
function GlobeIcon() {
  return (
    <svg viewBox="0 0 16 16" className={ico} fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M1.5 8h13M8 1.5c1.8 1.7 2.8 4 2.8 6.5S9.8 12.8 8 14.5C6.2 12.8 5.2 10.5 5.2 8S6.2 3.2 8 1.5Z" />
    </svg>
  );
}
function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" className={ico} fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M6.5 9.5l3-3M7 4.5l.8-.8a2.4 2.4 0 0 1 3.4 3.4l-.8.8M9 11.5l-.8.8a2.4 2.4 0 0 1-3.4-3.4l.8-.8" />
    </svg>
  );
}
function BroadcastIcon() {
  return (
    <svg viewBox="0 0 16 16" className={ico} fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
      <path d="M4.6 4.6a4.8 4.8 0 0 0 0 6.8M11.4 4.6a4.8 4.8 0 0 1 0 6.8M2.6 2.6a7.6 7.6 0 0 0 0 10.8M13.4 2.6a7.6 7.6 0 0 1 0 10.8" strokeLinecap="round" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className={ico} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M3 8.5l3.2 3.2L13 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Icon-forward control: prominent icon, small supplementary label. */
function Control({
  icon,
  label,
  onClick,
  href,
  disabled,
  title,
  tone = "ghost",
  busy,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  title?: string;
  tone?: "ghost" | "accent" | "ok" | "muted";
  busy?: boolean;
}) {
  const toneClass =
    tone === "accent"
      ? "border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-ink)]"
      : tone === "ok"
        ? "border-[var(--edge)] text-ok"
        : tone === "muted"
          ? "border-[var(--edge-soft)] text-faint"
          : "border-[var(--edge)] text-ink hover:bg-elevated";
  const cls = `inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:hover:bg-transparent ${toneClass}`;
  const body = (
    <>
      {busy ? <span className={`${ico} animate-pulse`}>…</span> : icon}
      <span>{label}</span>
    </>
  );
  if (href && !disabled) {
    return (
      <Link href={href} className={cls} title={title}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={cls}>
      {body}
    </button>
  );
}

export function PublishHeader({
  packageId,
  publishing,
  dirty,
  onChanged,
}: {
  packageId: string;
  publishing: PublishingState;
  dirty: boolean;
  onChanged: () => void;
}) {
  const [published, setPublished] = useState(publishing.published);
  const [siteUrl, setSiteUrl] = useState<string | null>(publishing.siteUrl);
  const [repoBusy, startRepo] = useTransition();
  const [siteBusy, startSite] = useTransition();
  const [listBusy, startList] = useTransition();

  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [gateFailures, setGateFailures] = useState<GateFailure[]>([]);
  const [copied, setCopied] = useState(false);

  function clearMessages() {
    setError(null);
    setWarning(null);
    setGateFailures([]);
  }

  // ① Save to GitHub — create the repo pair + commit content.
  const onSaveToGitHub = () => {
    clearMessages();
    startRepo(async () => {
      const r = await publishToGitHubAction(packageId);
      if (r.ok) {
        setPublished(true);
        onChanged();
      } else setError(r.error ?? "Couldn't save to GitHub.");
    });
  };

  // Resume after the GitHub-App install (?publish=1) returns here.
  const resumed = useRef(false);
  useEffect(() => {
    if (
      publishing.autoPublish &&
      publishing.connected &&
      !published &&
      !dirty &&
      !resumed.current
    ) {
      resumed.current = true;
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("publish");
        window.history.replaceState(null, "", url.toString());
      }
      onSaveToGitHub();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishing.autoPublish, publishing.connected, published, dirty]);

  // ② Publish web page — build the static site → GitHub Pages. Re-runnable:
  // saving commits source only, so the live page updates when this runs again.
  const onPublishPage = () => {
    const confirmMsg = siteUrl
      ? "Update the public web page with your latest saved changes?"
      : "Publish the public web page? Anyone with the link will be able to view it.";
    if (!window.confirm(confirmMsg)) return;
    clearMessages();
    startSite(async () => {
      const r = await publishSiteAction(packageId);
      if (r.ok) {
        setSiteUrl(r.siteUrl ?? null);
        if (r.warning) setWarning(r.warning);
      } else if (r.gateFailures?.length) setGateFailures(r.gateFailures);
      else setError(r.error ?? "Publishing the web page failed.");
    });
  };

  const onCopyLink = async () => {
    if (!siteUrl) return;
    try {
      await navigator.clipboard.writeText(siteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy — long-press the link to copy it manually.");
    }
  };

  // List publicly — register / unregister on the discovery index.
  const onToggleList = () => {
    clearMessages();
    const registered = publishing.registered;
    if (registered && !window.confirm("Remove this from the public index?")) return;
    startList(async () => {
      const r = registered
        ? await unregisterPackageAction(packageId)
        : await registerPackageAction(packageId);
      if (r.ok) onChanged();
      else if ("gateFailures" in r && r.gateFailures?.length)
        setGateFailures(r.gateFailures);
      else setError(r.error ?? "That didn't complete. Please try again.");
    });
  };

  if (!publishing.configured) {
    return (
      <p className="text-xs text-faint">Publishing isn’t set up on this deployment.</p>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {/* ① Save to GitHub */}
        {published ? (
          <Control
            icon={<CheckIcon />}
            label="Saved online"
            tone="ok"
            href={publishing.publicRepoUrl ?? undefined}
            title="Your project is saved to its online home — click to view it"
          />
        ) : publishing.connected ? (
          <Control
            icon={<GitHubIcon />}
            label={repoBusy ? "Saving…" : "Save online"}
            tone="accent"
            onClick={onSaveToGitHub}
            disabled={repoBusy || dirty}
            title={
              dirty
                ? "Finish saving your edits in the editor first"
                : "Create your project's online home and save your content there"
            }
          />
        ) : (
          <Control
            icon={<GitHubIcon />}
            label="Save online"
            tone="accent"
            href={publishing.installUrl ?? undefined}
            title="Connect your online account, then save"
          />
        )}

        {/* ② Publish web page */}
        {siteUrl ? (
          <>
            <Control icon={<CheckIcon />} label="Page live" tone="ok" />
            <Control
              icon={<GlobeIcon />}
              label={siteBusy ? "Updating…" : "Update page"}
              tone="ghost"
              onClick={onPublishPage}
              disabled={siteBusy}
              title="Rebuild the public page with your latest saved changes"
            />
            <Control
              icon={<LinkIcon />}
              label={copied ? "Copied!" : "Copy link"}
              tone={copied ? "ok" : "ghost"}
              onClick={onCopyLink}
              title={siteUrl}
            />
            <a
              href={siteUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-[var(--edge)] px-2 py-1.5 text-xs text-muted transition-colors hover:bg-elevated hover:text-ink"
              title="Open the public page"
            >
              ↗
            </a>
          </>
        ) : (
          <Control
            icon={<GlobeIcon />}
            label={siteBusy ? "Publishing…" : "Publish web page"}
            tone={published ? "accent" : "muted"}
            onClick={onPublishPage}
            disabled={!published || siteBusy}
            title={published ? "Build the public web page and link" : "Save online first"}
          />
        )}

        {/* List publicly */}
        {published && (
          <Control
            icon={<BroadcastIcon />}
            label={
              listBusy ? "Working…" : publishing.registered ? "Listed publicly" : "List publicly"
            }
            tone={publishing.registered ? "ok" : "ghost"}
            onClick={onToggleList}
            disabled={listBusy}
            title={
              publishing.registered
                ? "Listed on the public index — click to remove"
                : "List this on the public discovery index"
            }
          />
        )}
      </div>

      {(error || warning || gateFailures.length > 0) && (
        <div className="max-w-sm text-right text-xs">
          {gateFailures.length > 0 && (
            <div className="rounded border border-[var(--edge)] bg-elevated p-2 text-left text-warn">
              <div className="font-medium">Fix these before publishing:</div>
              <ul className="mt-1 list-disc pl-4">
                {gateFailures.map((g) => (
                  <li key={g.name}>{g.message}</li>
                ))}
              </ul>
            </div>
          )}
          {warning && <p className="text-warn">{warning}</p>}
          {error && <p className="text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
