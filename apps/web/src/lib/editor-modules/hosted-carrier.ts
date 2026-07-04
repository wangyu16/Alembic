import type { EditorContext, EditorHandle, EditorModule } from "@alembic/editor-kit";
import { createHostSaveClient } from "@alembic/editor-kit";

/**
 * The generic hosted-carrier editor (E1): mounts a self-contained orz file
 * (`.md.html` / `.slides.html` / `.paged.html`) in a sandboxed iframe and
 * speaks `orz-host-save@1` (see orz-mdhtml/PROTOCOL.md). ONE module
 * parameterized by kind — the file brings its own editor; Alembic provides
 * persistence through the validated write path via `ctx.hostSave`.
 *
 * For these kinds `ctx.source` is the FULL FILE (the self-contained document
 * is the editable unit); a save persists the file's re-serialized `rendered`
 * bytes. Files generated before the protocol never answer the hello — the
 * module reports the timeout via `ctx.onDirty`-independent fallback: the
 * file simply stays a viewer (its own chrome still works), and the host can
 * offer "regenerate to edit".
 */
export function hostedCarrierModule(
  kind: "md" | "slides" | "paged",
  label: string,
): EditorModule {
  return {
    kind,
    label,
    wysiwyg: true,
    mount(el: HTMLElement, ctx: EditorContext): EditorHandle {
      const frame = document.createElement("iframe");
      // Sandboxed per the protocol's security rules: scripts run (the file IS
      // an app) but with an opaque origin and no same-origin reach into the
      // workspace. The file's runtime handles the "null"-origin case.
      frame.setAttribute("sandbox", "allow-scripts allow-downloads allow-modals");
      frame.srcdoc = ctx.source;
      frame.title = `${label} editor`;
      frame.style.width = "100%";
      frame.style.height = "100%";
      frame.style.border = "0";

      // The latest full document — seeded with the mounted file, replaced on
      // every accepted save so getSource() always returns current bytes.
      let latest = ctx.source;

      const client = createHostSaveClient({
        post: (m) => frame.contentWindow?.postMessage(m, "*"),
        save: async ({ source, rendered }) => {
          if (ctx.readOnly) return { ok: false, error: "This view is read-only." };
          const result = ctx.hostSave
            ? await ctx.hostSave({ source, rendered })
            : (ctx.onChange({ source, rendered }), { ok: true as const });
          if (result.ok) latest = rendered;
          return result;
        },
        onDirty: (d) => ctx.onDirty?.(d),
        onHelloTimeout: () => {
          // Pre-protocol file: it keeps working as a standalone viewer/editor
          // saving via its own Export; the host just never receives saves.
          ctx.onDirty?.(false);
        },
      });

      const onMessage = (e: MessageEvent) => {
        if (e.source === frame.contentWindow) client.handleMessage(e.data);
      };
      window.addEventListener("message", onMessage);
      frame.addEventListener("load", () => client.start());
      el.appendChild(frame);

      return {
        getSource: () => latest,
        destroy() {
          window.removeEventListener("message", onMessage);
          client.stop();
          frame.remove();
        },
      };
    },
  };
}
