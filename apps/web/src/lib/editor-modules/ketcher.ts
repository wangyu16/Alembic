import type { EditorContext, EditorHandle, EditorModule } from "@alembic/editor-kit";

/**
 * Ketcher structure editor as an `@alembic/editor-kit` module (Phase 2
 * extraction). Framework-agnostic: it mounts the self-hosted standalone build
 * as a same-origin iframe and talks to its `window.ketcher` API directly. The
 * host provides only the carrier source (KetJSON) + persistence via `onChange`.
 *
 * NOTE: the canvas needs the vendored build (`pnpm fetch:ketcher`) and a
 * browser; it cannot be exercised by typecheck/CI — verify interactively.
 */

const KETCHER_SRC = "/ketcher/standalone/index.html";

interface KetcherApi {
  setMolecule(s: string): Promise<void>;
  getKet(): Promise<string>;
  generateImage(data: string, opts: { outputFormat: "svg" | "png" }): Promise<Blob>;
}

function apiFrom(frame: HTMLIFrameElement): KetcherApi | null {
  const w = frame.contentWindow as unknown as { ketcher?: KetcherApi } | null;
  return w?.ketcher ?? null;
}

export const ketcherModule: EditorModule = {
  kind: "ketcher",
  label: "Structure",
  wysiwyg: true,
  mount(el: HTMLElement, ctx: EditorContext): EditorHandle {
    const frame = document.createElement("iframe");
    frame.src = KETCHER_SRC;
    frame.title = "Chemical structure editor";
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.border = "0";
    el.appendChild(frame);

    let cancelled = false;
    // Load the initial molecule once the same-origin API is available.
    const tick = (tries = 0) => {
      if (cancelled) return;
      const api = apiFrom(frame);
      if (api) {
        if (ctx.source) void api.setMolecule(ctx.source).catch(() => {});
        return;
      }
      if (tries < 100) setTimeout(() => tick(tries + 1), 200);
    };
    tick();

    const getSource = async (): Promise<string> => {
      const api = apiFrom(frame);
      if (!api) return ctx.source;
      return api.getKet();
    };

    return {
      getSource,
      async renderPayload(): Promise<string> {
        const api = apiFrom(frame);
        if (!api) return "";
        const ket = await api.getKet();
        const blob = await api.generateImage(ket, { outputFormat: "svg" });
        return blob.text();
      },
      destroy() {
        cancelled = true;
        frame.remove();
      },
    };
  },
};
