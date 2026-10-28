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
import { IndexedDbDraftStore, draftKey, requestPersistentStorage, type DraftStore } from "@/lib/device-save/store";
import { diffEdit, loadKit, type OrzEditor, type OrzKind } from "./kit";
import { mergeRemote } from "./merge";
import { makeHooks } from "./hooks";

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
  const [failed, setFailed] = useState<string | null>(null);
  const base = useRef<string | null>(p.baseVersion);
  const baseText = useRef<string>(p.text); // the text of `base`: the merge base for others' changes
  const [conflict, setConflict] = useState<string | null>(null);
  const quiet = useRef(false); // the next change event is a remote update, not typing
  const props = useRef(p);
  props.current = p;

  useImperativeHandle(ref, () => ({
    applyRemote(text: string, version: string) {
      const e = editor.current;
      if (!e || version === base.current) return;
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
      onStatus: (x) => { if (!disposed) setStatus(x); },
      onSynced: (d) => {
        // Private text leaves the device once it is in the course (design §7.1).
        void store.get(key).then((cur) => {
          if (cur && cur.text === d.text) return c.isPrivate ? store.delete(key) : store.put({ ...cur, savedAt: Date.now() });
        });
      },
    });
    scheduler.current = s;

    const keep = (text: string) => {
      s.edit({ text, baseVersion: base.current });
      return store.put({ key, text, baseVersion: base.current, savedAt: Date.now(), private: c.isPrivate });
    };

    void (async () => {
      try {
        const kit = await loadKit(c.kind);
        if (disposed || !host.current) return;
        // Unsynced text from an earlier visit on this device wins over the synced copy.
        const kept = await store.get(key);
        const startText = kept && kept.baseVersion === c.baseVersion ? kept.text : c.text;
        const e = kit.mountEditor(host.current, {
          text: startText,
          mode: "split",
          chrome: "full",
          ...(c.nonce ? { nonce: c.nonce } : {}),
          fileName: c.docPath.split("/").pop() ?? "document.md",
          hooks: makeHooks({
            packageId: c.packageId,
            docPath: c.docPath,
            saveToDevice: async (text) => { await keep(text); await s.syncNow(); },
            readCourseText: (path) => props.current.readCourseText(path),
            assetUrls: c.assetUrls ?? new Map(),
            mintUid: () => props.current.mintUid(),
          }) as never,
        });
        editor.current = e;
        e.on("change", ({ text }) => {
          if (quiet.current) { e.markSaved(); return; } // a remote update with nothing of ours on top: already synced
          // Kept on the device at once: the editor's own bar says Saved too (its Save button syncs now).
          void keep(text).then(() => { if (e.getText() === text) e.markSaved(); });
        });
        if (startText !== c.text) s.edit({ text: startText, baseVersion: c.baseVersion });
      } catch (err) {
        if (!disposed) setFailed((err as Error).message || "The editor could not load.");
      }
    })();

    // Leaving the page counts as leaving the document.
    const onHide = () => { if (document.visibilityState === "hidden") void s.syncNow(); };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onHide);
      void s.syncNow().finally(() => s.dispose());
      editor.current?.destroy();
      editor.current = null;
    };
  }, []);

  const label = statusLabel(status, (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end gap-3 border-b px-3 py-1 text-sm" aria-live="polite">
        <span data-testid="sync-status">{label}</span>
        <button type="button" className="underline" onClick={() => void scheduler.current?.syncNow()}>Sync now</button>
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
