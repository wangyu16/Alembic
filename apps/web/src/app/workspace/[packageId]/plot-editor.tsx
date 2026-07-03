"use client";

import { useEffect, useRef, useState } from "react";
import { saveAssetAction } from "./asset-actions";

/**
 * Plot/chart editor (M11b) — a second carrier kind on the same pipeline as
 * structures, proving the registry generalizes. Plotly is lazy-loaded from the
 * vendored basic build (`pnpm fetch:plotly` → /vendor/plotly-basic.min.js;
 * authoring-only). The editable source is the Plotly spec (JSON); the carrier
 * embeds it and stores the rendered SVG, so the published site needs no runtime.
 *
 * NOTE: rendering requires the vendored Plotly + a browser; not exercised by CI.
 */

const PLOTLY_SRC = "/vendor/plotly-basic.min.js";

interface PlotlyApi {
  newPlot(el: HTMLElement, data: unknown[], layout: unknown, config?: unknown): Promise<unknown>;
  toImage(el: HTMLElement, opts: { format: string; width: number; height: number }): Promise<string>;
  purge(el: HTMLElement): void;
}

const DEFAULT_SPEC = `{
  "data": [
    { "type": "bar", "x": ["A", "B", "C"], "y": [4, 7, 2] }
  ],
  "layout": { "title": "Untitled chart", "width": 700, "height": 450 }
}`;

function loadPlotly(): Promise<PlotlyApi> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { Plotly?: PlotlyApi };
    if (w.Plotly) return resolve(w.Plotly);
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PLOTLY_SRC}"]`);
    const onload = () => (w.Plotly ? resolve(w.Plotly) : reject(new Error("Plotly missing")));
    if (existing) {
      existing.addEventListener("load", onload);
      existing.addEventListener("error", () => reject(new Error("Plotly failed to load")));
      return;
    }
    const s = document.createElement("script");
    s.src = PLOTLY_SRC;
    s.onload = onload;
    s.onerror = () => reject(new Error("Plotly failed to load"));
    document.head.appendChild(s);
  });
}

export function PlotEditor({
  packageId,
  initialPath,
  initialSource,
  onClose,
  onSaved,
}: {
  packageId: string;
  initialPath?: string;
  initialSource?: string;
  onClose: () => void;
  onSaved: (path: string, altText: string) => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const plotlyRef = useRef<PlotlyApi | null>(null);
  const [spec, setSpec] = useState(initialSource || DEFAULT_SPEC);
  const [name, setName] = useState("");
  const [altText, setAltText] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPlotly()
      .then((p) => {
        if (cancelled) return;
        plotlyRef.current = p;
        setReady(true);
      })
      .catch(() =>
        setError("The plot library didn't load. Run `pnpm fetch:plotly` and reload."),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  // Live preview: re-render on spec change once Plotly is ready (debounced).
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => {
      const p = plotlyRef.current;
      const el = previewRef.current;
      if (!p || !el) return;
      try {
        const parsed = JSON.parse(spec) as { data?: unknown[]; layout?: unknown };
        void p.newPlot(el, parsed.data ?? [], parsed.layout ?? {}, {
          staticPlot: true,
          displayModeBar: false,
        });
        setError(null);
      } catch {
        setError("The spec isn't valid JSON yet.");
      }
    }, 400);
    return () => clearTimeout(id);
  }, [spec, ready]);

  async function save() {
    setError(null);
    if (!altText.trim()) {
      setError("Add a short description (alt text) before saving.");
      return;
    }
    if (!initialPath && !name.trim()) {
      setError("Name this chart so it can be reused.");
      return;
    }
    const p = plotlyRef.current;
    const el = previewRef.current;
    if (!p || !el) {
      setError("The plot editor isn't ready yet.");
      return;
    }
    setBusy(true);
    try {
      const parsed = JSON.parse(spec) as { layout?: { width?: number; height?: number } };
      const width = parsed.layout?.width ?? 700;
      const height = parsed.layout?.height ?? 450;
      const dataUrl = await p.toImage(el, { format: "svg", width, height });
      const svg = decodeURIComponent(dataUrl.slice(dataUrl.indexOf(",") + 1));
      const res = await saveAssetAction(packageId, {
        kind: "plot",
        path: initialPath,
        name,
        source: spec,
        svg,
        altText: altText.trim(),
      });
      if (res.ok && res.path) onSaved(res.path, altText.trim());
      else setError(res.error ?? "Couldn't save the chart.");
    } catch {
      setError("Couldn't render or save the chart. Check the spec.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)]/95 p-4 backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-serif text-lg text-ink">{initialPath ? "Edit chart" : "New chart"}</h2>
        <button onClick={onClose} className="btn btn-ghost btn-sm">Close</button>
      </div>

      <div className="grid flex-1 grid-cols-1 grid-rows-2 gap-4 overflow-hidden md:grid-cols-2 md:grid-rows-1">
        <textarea
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          spellCheck={false}
          className="field h-full w-full resize-none font-mono text-xs"
          placeholder="Plotly spec: { data: [...], layout: {...} }"
        />
        <div className="relative overflow-auto rounded-lg border border-edge bg-white">
          <div ref={previewRef} className="h-full w-full" />
          {!ready && !error && (
            <div className="absolute inset-0 grid place-items-center text-sm text-muted">
              Loading the plot library…
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        {!initialPath && (
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="titration-curve" className="field" />
          </label>
        )}
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-xs text-muted">Description (alt text)</span>
          <input
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
            placeholder="Bar chart comparing…"
            className="field w-full"
          />
        </label>
        <button onClick={save} disabled={!ready || busy} className="btn btn-primary btn-sm">
          {busy ? "Saving…" : "Save & insert"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
