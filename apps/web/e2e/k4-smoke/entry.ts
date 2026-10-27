import { mountEditor } from "orz-mdhtml-browser";
import { makeHooks } from "../../src/lib/orz-editor/hooks";
import { diffEdit } from "../../src/lib/orz-editor/kit";
import { SyncScheduler } from "../../src/lib/device-save/scheduler";

const w = window as unknown as Record<string, unknown>;
const sent: Array<{ text: string; syncId: string }> = [];
const changes: string[] = [];
const s = new SyncScheduler({
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as number),
  newSyncId: () => crypto.randomUUID(),
  send: async (d, syncId) => { sent.push({ text: d.text, syncId }); return { ok: true }; },
});
const text = "{{nyml\nkind: document\nformat: 1\ntitle: Smoke\n}}\n\n# Smoke\n\nFirst paragraph.\n\n{{md parts/a.md}}\n\nLast paragraph.\n";
const editor = mountEditor(document.getElementById("host")!, {
  text,
  mode: "split",
  hooks: makeHooks({
    packageId: "pkg-1",
    docPath: "chapters/01/notes.md",
    saveToDevice: async (t) => { s.edit({ text: t, baseVersion: null }); await s.syncNow(); },
    readCourseText: async (p) => (p === "chapters/01/parts/a.md" ? "Included **paragraph** from the course." : null),
    assetUrls: new Map(),
    mintUid: async () => "doc-smoketest01",
  }) as never,
}) as ReturnType<typeof mountEditor> & { applyEdits?: (e: unknown[], o?: unknown) => boolean; flash?: (r: unknown[]) => void };
editor.on("change", ({ text }) => { changes.push(text); s.edit({ text, baseVersion: null }); });
w["k4"] = {
  editor, sent, changes,
  hasApplyEdits: typeof editor.applyEdits === "function",
  applyRemote(t: string) {
    const e = diffEdit(editor.getText(), t);
    if (!e) return "none";
    if (editor.applyEdits?.([e], { label: "remote" })) { editor.flash?.([{ from: e.from, to: e.from + e.insert.length }]); return "edits"; }
    editor.setText(t); return "settext";
  },
  syncNow: () => s.syncNow(),
};
