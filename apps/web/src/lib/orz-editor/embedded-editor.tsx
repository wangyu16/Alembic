"use client";

/**
 * A course document in the embedded 1.x orz editor (K4 §3 step 3, A7).
 *
 * - The editor's text is kept on the device at every change (IndexedDB).
 * - The sync scheduler decides when it goes to the course (A7 cadence);
 *   Save / Cmd+S and leaving the page sync at once.
 * - `applyRemote(text)` brings in another person's synced change as one
 *   edit, keeping the cursor and the undo history, with a brief highlight.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { SyncScheduler, statusLabel, type SendResult, type SyncStatus } from "@/lib/device-save/scheduler";
import { IndexedDbDraftStore, draftKey, requestPersistentStorage, resumeFrom, type DraftStore } from "@/lib/device-save/store";
import { diffEdit, loadKit, type OrzEditor, type OrzKind } from "./kit";
import { mergeRemote } from "./merge";
import { makeHooks, resolveCoursePath } from "./hooks";
import { assembleDownload, embedFigures } from "./download";

export interface EmbeddedEditorProps {
  kind: OrzKind;
  packageId: string;
  docPath: string;
  /** The synced text and its version (sha256) the editor starts from. */
  text: string;
  baseVersion: string | null;
  /** Instructor-only file: removed from the device once synced. */
  isPrivate: boolean;
  nonce?: string;
  assetUrls?: ReadonlyMap<string, string>;
  readCourseText(path: string): Promise<string | null>;
  mintUid(): Promise<string>;
  /** Send the text to the course (the sync entry); idempotent per syncId. */
  sync(a: { packageId: string; path: string; text: string; baseVersion: string | null; syncId: string }): Promise<SendResult>;
  store?: DraftStore;
}

export interface EmbeddedEditorHandle {
  /** Another person's synced text and its version. */
  applyRemote(text: string, version: string): void;
  syncNow(): Promise<void>;
}

export const EmbeddedEditor = forwardRef<EmbeddedEditorHandle, EmbeddedEditorProps>(function EmbeddedEditor(p, ref) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<OrzEditor | null>(null);
  const scheduler = useRef<SyncScheduler | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ kind: "synced", at: null });
  const [ready, setReady] = useState(false); // the editor is open (before that, say so, not "saved")
  const statusRef = useRef<SyncStatus["kind"]>("synced");
  const [failed, setFailed] = useState<string | null>(null);
  const base = useRef<string | null>(p.baseVersion);
  const baseText = useRef<string>(p.text); // the text of `base`: the merge base for others' changes
  const [conflict, setConflict] = useState<string | null>(null);
  const quiet = useRef(false); // the next change event is a remote update, not typing
  const lastSent = useRef<string | null>(null); // our own text the course accepted last (its echo is not someone else's change)
  const props = useRef(p);
  props.current = p;

  useImperativeHandle(ref, () => ({
    applyRemote(text: string, version: string) {
      const e = editor.current;
      if (!e || version === base.current) return;
      // Our own sync coming back (RC.17): move the merge base forward; typing since then is based on it.
      if (text === lastSent.current) {
        base.current = version;
        baseText.current = text;
        scheduler.current?.rebase(version);
        return;
      }
      const local = e.getText();
      const m = mergeRemote(baseText.current, local, text);
      if (!m.applied) {
        // Same place changed on both sides: leave the screen alone; the next sync keeps both versions.
        setConflict("Someone else also changed the part you are editing. When you sync, both versions are kept.");
        return;
      }
      base.current = version;
      baseText.current = text;
      const edit = diffEdit(local, m.text);
      if (!edit) return;
      quiet.current = !scheduler.current?.hasUnsynced;
      if (e.applyEdits?.([edit], { label: "update from a co-author" })) {
        e.flash?.([{ from: edit.from, to: edit.from + edit.insert.length }]);
      } else {
        e.setText(m.text);
      }
      quiet.current = false;
    },
    syncNow: () => scheduler.current?.syncNow() ?? Promise.resolve(),
  }), []);

  useEffect(() => {
    let disposed = false;
    const c = props.current;
    const store = c.store ?? new IndexedDbDraftStore();
    const key = draftKey(c.packageId, c.docPath);
    void requestPersistentStorage();

    const s = new SyncScheduler({
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      newSyncId: () => crypto.randomUUID(),
      send: (d, syncId) => props.current.sync({ packageId: c.packageId, path: c.docPath, text: d.text, baseVersion: d.baseVersion, syncId }),
      onStatus: (x) => { statusRef.current = x.kind; if (!disposed) setStatus(x); },
      onSynced: (d) => {
        lastSent.current = d.text;
        // The editor's own bar says Saved only once the course has this text (RC.13).
        if (editor.current?.getText() === d.text) editor.current.markSaved();
        // Private text leaves the device once it is in the course (design §7.1).
        void store.get(key).then((cur) => {
          if (cur && cur.text === d.text) return c.isPrivate ? store.delete(key) : store.put({ ...cur, savedAt: Date.now(), synced: true });
        });
      },
    });
    scheduler.current = s;

    const keep = (text: string) => {
      s.edit({ text, baseVersion: base.current });
      return store.put({ key, text, baseVersion: base.current, savedAt: Date.now(), private: c.isPrivate, synced: false });
    };

    void (async () => {
      try {
        const kit = await loadKit(c.kind);
        if (disposed || !host.current) return;
        // Text from an earlier visit that never reached the course wins, and is sent again (RC.17).
        const resume = resumeFrom(await store.get(key), { text: c.text, version: c.baseVersion });
        const startText = resume.text;
        const e = kit.mountEditor(host.current, {
          text: startText,
          mode: "split",
          chrome: "full",
          ...(c.nonce ? { nonce: c.nonce } : {}),
          fileName: c.docPath.split("/").pop() ?? "document.md",
          hooks: makeHooks({
            packageId: c.packageId,
            docPath: c.docPath,
            // The editor's Save sends to the course now; it reports Saved only if the course has the text (RC.22).
            saveToDevice: async (text) => {
              await keep(text);
              await s.syncNow();
              if (s.hasUnsynced) {
                const st = s.current;
                throw new Error(st.kind === "refused" ? `Not saved to the course: ${st.reason}` : st.kind === "retrying" ? "Not in the course yet: it is kept on this device and will be sent when the connection is back." : "Not in the course yet: still sending. It is kept on this device.");
              }
            },
            readCourseText: (path) => props.current.readCourseText(path),
            assetUrls: c.assetUrls ?? new Map(),
            mintUid: () => props.current.mintUid(),
          }) as never,
        });
        editor.current = e;
        setReady(true);
        e.on("change", ({ text }) => {
          if (quiet.current) { e.markSaved(); return; } // a remote update with nothing of ours on top: already synced
          // Kept on the device at once; the editor's bar says Saved only when the course has it (onSynced).
          void keep(text);
        });
        if (resume.pending) {
          // The resumed text is edited from ITS base, not the course's current version (audit r3 HIGH-1): the
          // editor's base follows it, and it goes to the course at once, where the version rule merges it with
          // what changed meanwhile; the merged echo then diffs cleanly against this text.
          base.current = resume.pending.baseVersion;
          baseText.current = resume.text;
          s.edit(resume.pending);
          void s.syncNow();
        }
      } catch (err) {
        if (!disposed) setFailed((err as Error).message || "The editor could not load.");
      }
    })();

    // Leaving the page counts as leaving the document; closing it with text not yet in the course asks first.
    const onHide = () => { if (document.visibilityState === "hidden") void s.syncNow(); };
    const onLeave = (ev: BeforeUnloadEvent) => {
      if (statusRef.current !== "synced") { void s.syncNow(); ev.preventDefault(); }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onLeave);
      void s.syncNow().finally(() => s.dispose());
      editor.current?.destroy();
      editor.current = null;
    };
  }, []);

  /** Present (slides): the deck as its own page in a new tab, where it plays as a slideshow (RC.22). */
  const present = async () => {
    const e = editor.current;
    if (!e) return;
    const kit = await loadKit(p.kind);
    const html = await kit.assemble(await embedFigures(e.getText(), (t) => resolveCoursePath(p.docPath, t), (path) => p.assetUrls?.get(path)), { delivery: "inline" });
    // The deck goes to the Present route, which serves it sandboxed (RC.25): it plays, but course content
    // never runs as Alembic. A form post opens it in a new tab with no link back to this page.
    const form = Object.assign(document.createElement("form"), { method: "POST", action: `/workspace/${encodeURIComponent(p.packageId)}/present`, target: "_blank", rel: "noopener" });
    const field = Object.assign(document.createElement("textarea"), { name: "html", value: html });
    form.append(field);
    form.style.display = "none";
    document.body.append(form);
    form.submit();
    form.remove();
  };

  /** Download (K4 step 4): the current text as a self-contained file that opens and edits itself in a browser. */
  const download = async () => {
    const e = editor.current;
    if (!e) return;
    const kit = await loadKit(p.kind);
    // The figures go inside the file (RC.23): a downloaded document has no course folder next to it.
    const text = await embedFigures(e.getText(), (t) => resolveCoursePath(p.docPath, t), (path) => p.assetUrls?.get(path));
    const html = await assembleDownload(kit, text, { packageId: p.packageId, path: p.docPath, baseVersion: base.current ?? "" });
    const name = (p.docPath.split("/").pop() ?? "document.md").replace(/\.md$/i, "") + ".html";
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name.endsWith(".slides.html") || name.endsWith(".paged.html") ? name : name.replace(/\.html$/, ".md.html") });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const label = statusLabel(status, (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end gap-3 border-b px-3 py-1 text-sm" aria-live="polite">
        <span data-testid="sync-status">{ready ? label : "Opening…"}</span>
        {p.kind === "slides" ? <button type="button" className="underline" data-testid="present" onClick={() => void present()}>Present</button> : null}
        <button type="button" className="underline" data-testid="download" onClick={() => void download()}>Download</button>
      </div>
      {failed ? <p className="p-4 text-red-700" role="alert">{failed}</p> : null}
      {conflict ? (
        <p className="border-b bg-amber-100 px-3 py-1 text-sm text-amber-950" role="status">
          {conflict} <button type="button" className="underline" onClick={() => setConflict(null)}>OK</button>
        </p>
      ) : null}
      <div ref={host} className="min-h-0 flex-1" data-testid="orz-editor-host" />
    </div>
  );
});
