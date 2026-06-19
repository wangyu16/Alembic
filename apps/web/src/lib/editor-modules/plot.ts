import type { EditorContext, EditorHandle, EditorModule } from "@alembic/editor-kit";

/**
 * Plot editor as an `@alembic/editor-kit` module (Phase 2 extraction). The
 * carrier source is a Plotly figure spec (`{ data, layout }`). The module mounts
 * a spec source field + a live Plotly preview (vendored basic build), renders on
 * edit, and reports edits via `onChange`. Framework-agnostic DOM.
 *
 * NOTE: rendering needs the vendored Plotly (`pnpm fetch:plotly`) and a browser;
 * not exercised by typecheck/CI — verify interactively.
 */

const PLOTLY_SRC = "/vendor/plotly-basic.min.js";

interface PlotlyApi {
  newPlot(el: HTMLElement, data: unknown[], layout: unknown): Promise<void>;
  purge(el: HTMLElement): void;
}

function loadPlotly(): Promise<PlotlyApi> {
  const w = window as unknown as { Plotly?: PlotlyApi };
  if (w.Plotly) return Promise.resolve(w.Plotly);
  return new Promise((resolve, reject) => {
    let s = document.querySelector<HTMLScriptElement>(`script[src="${PLOTLY_SRC}"]`);
    if (!s) {
      s = document.createElement("script");
      s.src = PLOTLY_SRC;
      document.head.appendChild(s);
    }
    s.addEventListener("load", () => {
      const api = (window as unknown as { Plotly?: PlotlyApi }).Plotly;
      api ? resolve(api) : reject(new Error("Plotly failed to load"));
    });
    s.addEventListener("error", () => reject(new Error("Plotly failed to load")));
  });
}

export const plotModule: EditorModule = {
  kind: "plot",
  label: "Plot",
  mount(el: HTMLElement, ctx: EditorContext): EditorHandle {
    el.style.display = "grid";
    el.style.gridTemplateColumns = "1fr 1fr";
    el.style.gap = "8px";

    const ta = document.createElement("textarea");
    ta.value = ctx.source;
    ta.spellcheck = false;
    ta.style.width = "100%";
    ta.style.height = "100%";
    ta.style.fontFamily = "monospace";
    ta.style.fontSize = "12px";
    if (ctx.readOnly) ta.readOnly = true;

    const preview = document.createElement("div");
    preview.style.width = "100%";
    preview.style.minHeight = "240px";

    el.appendChild(ta);
    el.appendChild(preview);

    const render = async () => {
      try {
        const spec = JSON.parse(ta.value) as { data?: unknown[]; layout?: unknown };
        const plotly = await loadPlotly();
        await plotly.newPlot(preview, spec.data ?? [], spec.layout ?? {});
      } catch {
        /* invalid spec while typing — leave the last good render */
      }
    };
    void render();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const onInput = () => {
      ctx.onChange({ source: ta.value, rendered: preview.innerHTML });
      if (timer) clearTimeout(timer);
      timer = setTimeout(render, 400);
    };
    ta.addEventListener("input", onInput);

    return {
      getSource: () => ta.value,
      renderPayload: () => preview.innerHTML,
      destroy() {
        if (timer) clearTimeout(timer);
        ta.removeEventListener("input", onInput);
        try {
          (window as unknown as { Plotly?: PlotlyApi }).Plotly?.purge(preview);
        } catch {
          /* ignore */
        }
        el.replaceChildren();
      },
    };
  },
};
