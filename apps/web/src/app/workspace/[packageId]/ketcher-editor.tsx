"use client";

import { useEffect, useRef, useState } from "react";
import { saveAssetAction, suggestStructureAltTextAction } from "./asset-actions";

/**
 * Ketcher structure editor (M11.1), embedded as a lazy, sandboxed iframe of the
 * self-hosted standalone build (see scripts/fetch-ketcher.mjs). The build is
 * same-origin, so we talk to its `window.ketcher` API directly — no postMessage.
 * Publishing never depends on Ketcher; this is an authoring-only editor that
 * produces a `.ketcher.svg` carrier (KetJSON source + rendered SVG).
 *
 * NOTE: the canvas requires the vendored build (`pnpm fetch:ketcher`) and a
 * browser; it cannot be exercised by typecheck/CI. Verify interactively.
 */

const KETCHER_SRC = "/ketcher/standalone/index.html";

interface KetcherApi {
  setMolecule(s: string): Promise<void>;
  getKet(): Promise<string>;
  generateImage(data: string, opts: { outputFormat: "svg" | "png" }): Promise<Blob>;
}

function ketcherFrom(frame: HTMLIFrameElement | null): KetcherApi | null {
  if (!frame?.contentWindow) return null;
  const api = (frame.contentWindow as unknown as { ketcher?: KetcherApi }).ketcher;
  return api ?? null;
}

export function KetcherEditor({
  packageId,
  activePath,
  initialPath,
  initialSource,
  onClose,
  onSaved,
}: {
  packageId: string;
  /** Chapter path, for pedagogically-relevant alt text context. */
  activePath: string;
  /** Existing asset path when editing; undefined when creating. */
  initialPath?: string;
  initialSource?: string;
  onClose: () => void;
  /** Called with the saved asset's repo-relative path + alt text. */
  onSaved: (path: string, altText: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [altText, setAltText] = useState("");
  const [busy, setBusy] = useState<null | "describe" | "save">(null);
  const [error, setError] = useState<string | null>(null);

  // Poll for the same-origin Ketcher API after the iframe loads.
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const tick = () => {
      if (cancelled) return;
      const api = ketcherFrom(frameRef.current);
      if (api) {
        setReady(true);
        if (initialSource) void api.setMolecule(initialSource).catch(() => {});
        return;
      }
      if (tries++ > 100) {
        setError("The structure editor didn't load. Run `pnpm fetch:ketcher` and reload.");
        return;
      }
      setTimeout(tick, 200);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [initialSource]);

  async function readStructure(): Promise<{ source: string; svg: string } | null> {
    const api = ketcherFrom(frameRef.current);
    if (!api) {
      setError("The structure editor isn't ready yet.");
      return null;
    }
    const source = await api.getKet();
    const blob = await api.generateImage(source, { outputFormat: "svg" });
    const svg = await blob.text();
    return { source, svg };
  }

  async function describe() {
    setError(null);
    setBusy("describe");
    try {
      const s = await readStructure();
      if (!s) return;
      const r = await suggestStructureAltTextAction(packageId, s.source, activePath);
      if (r.ok && r.altText) setAltText(r.altText);
      else setError(r.error ?? "Couldn't generate a description.");
    } catch {
      setError("Couldn't read the structure.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setError(null);
    if (!altText.trim()) {
      setError("Add a short description (alt text) — or use “Describe with AI”.");
      return;
    }
    if (!initialPath && !name.trim()) {
      setError("Name this structure so it can be reused.");
      return;
    }
    setBusy("save");
    try {
      const s = await readStructure();
      if (!s) return;
      const res = await saveAssetAction(packageId, {
        kind: "ketcher",
        path: initialPath,
        name,
        source: s.source,
        svg: s.svg,
        altText: altText.trim(),
      });
      if (res.ok && res.path) onSaved(res.path, altText.trim());
      else setError(res.error ?? "Couldn't save the structure.");
    } catch {
      setError("Couldn't save the structure.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)]/95 p-4 backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-serif text-lg text-ink">
          {initialPath ? "Edit structure" : "Draw a structure"}
        </h2>
        <button onClick={onClose} className="btn btn-ghost btn-sm">Close</button>
      </div>

      <div className="relative flex-1 overflow-hidden rounded-lg border border-edge">
        <iframe
          ref={frameRef}
          src={KETCHER_SRC}
          title="Chemical structure editor"
          className="h-full w-full"
        />
        {!ready && !error && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted">
            Loading the structure editor…
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        {!initialPath && (
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="benzene"
              className="field"
            />
          </label>
        )}
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-xs text-muted">Description (alt text)</span>
          <input
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
            placeholder="A six-membered aromatic ring…"
            className="field w-full"
          />
        </label>
        <button onClick={describe} disabled={!ready || busy !== null} className="btn btn-ghost btn-sm">
          {busy === "describe" ? "Describing…" : "Describe with AI"}
        </button>
        <button onClick={save} disabled={!ready || busy !== null} className="btn btn-primary btn-sm">
          {busy === "save" ? "Saving…" : "Save & insert"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
