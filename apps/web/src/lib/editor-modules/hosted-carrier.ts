import type { EditorContext, EditorHandle, EditorModule } from "@alembic/editor-kit";
import { createHostSaveClient, createHostAIClient } from "@alembic/editor-kit";

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
      // Sandboxed, but WITH `allow-same-origin` — the self-contained file needs
      // its own origin to work: it renders its preview into a NESTED iframe via
      // `contentDocument.write` and lazy-loads its editor, both of which fail
      // under an opaque origin (the file shows blank and the pencil does
      // nothing). This is safe here because Alembic GENERATES the hosted file
      // from the educator's own source (the trusted orz runtime, not attacker
      // content). NOTE: on a `srcdoc` iframe `allow-same-origin` resolves to the
      // HOST origin, so the file can reach `window.parent`. Hosting UNTRUSTED
      // documents this way (e.g. previewing another educator's file in-app)
      // would instead require serving them from a separate content origin.
      frame.setAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-downloads allow-modals allow-popups",
      );
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
        save: async ({ source, rendered, theme }) => {
          if (ctx.readOnly) return { ok: false, error: "This view is read-only." };
          const result = ctx.hostSave
            ? await ctx.hostSave({ source, rendered, theme })
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

      // The AI bridge (orz-host-ai@1): when the host offers operations + a
      // runner, advertise them to the file's in-file assistant and relay its
      // requests. Files without the assistant (or hosts without AI) simply
      // never complete the handshake — additive, no effect on save.
      const aiClient =
        ctx.runAIOperation && ctx.aiOperations && ctx.aiOperations.length > 0
          ? createHostAIClient({
              post: (m) => frame.contentWindow?.postMessage(m, "*"),
              operations: ctx.aiOperations,
              run: (req) => ctx.runAIOperation!(req),
            })
          : null;

      const onMessage = (e: MessageEvent) => {
        if (e.source !== frame.contentWindow) return;
        client.handleMessage(e.data);
        aiClient?.handleMessage(e.data);
      };
      window.addEventListener("message", onMessage);
      frame.addEventListener("load", () => {
        client.start();
        aiClient?.start();
      });
      el.appendChild(frame);

      return {
        getSource: () => latest,
        destroy() {
          window.removeEventListener("message", onMessage);
          client.stop();
          aiClient?.stop();
          frame.remove();
        },
      };
    },
  };
}
