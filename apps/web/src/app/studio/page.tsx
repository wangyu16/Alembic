"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { extractSource, hasCarrier } from "@alembic/carriers";
import { ANONYMOUS, resolveEntitlements } from "@/lib/entitlements";

/**
 * Local studio (M17) — anonymous, no account, no cloud, no AI. Open a Markdown
 * or `.md.html` file from your disk, edit it, and save it back. Files never
 * leave your machine except for stateless server rendering (preview + building
 * the `.md.html` carrier); nothing is stored. See docs/specs/local-mode.md.
 *
 * v1 edits Markdown / `.md.html`. Structures, plots, and slides open in the
 * signed-in workspace (their editors are being made storage-agnostic next).
 */

// Anonymous identity is entitled to local-file editing only (the seam).
const ENTITLED_LOCAL = resolveEntitlements(ANONYMOUS).has("localFile");

const NEW_NOTE = "# Untitled note\n\nStart writing in Markdown…\n";

interface SaveWindow {
  showSaveFilePicker?: (opts: unknown) => Promise<{
    createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
  }>;
}

export default function StudioPage() {
  const [markdown, setMarkdown] = useState(NEW_NOTE);
  const [fileName, setFileName] = useState("untitled");
  const [html, setHtml] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Live preview via the stateless server renderer (orz-markdown isn't
  // browser-safe). Nothing is stored.
  useEffect(() => {
    const id = setTimeout(async () => {
      try {
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: markdown }),
        });
        const data = (await res.json()) as { html?: string };
        setHtml(data.html ?? "");
      } catch {
        /* preview is best-effort */
      }
    }, 350);
    return () => clearTimeout(id);
  }, [markdown]);

  function stem(name: string): string {
    return name.replace(/\.(md\.html|slides\.html|ketcher\.svg|plot\.svg|md|markdown|txt|html|svg)$/i, "") || "untitled";
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setNote(null);
    try {
      const content = await file.text();
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".txt")) {
        setMarkdown(content);
        setFileName(stem(file.name));
        setNote(`Opened ${file.name}.`);
        return;
      }
      if (hasCarrier(content)) {
        const { kind, source } = extractSource(content);
        if (kind === "md") {
          setMarkdown(source);
          setFileName(stem(file.name));
          setNote(`Opened ${file.name}.`);
        } else {
          setError(
            `“${file.name}” is a ${kind} file. The studio edits Markdown and .md.html for now — open structures, plots, and slides in your workspace.`,
          );
        }
        return;
      }
      setError("Unsupported file. Open a .md or .md.html file.");
    } catch {
      setError("Couldn't read that file.");
    }
  }

  async function saveBlob(content: string, suggestedName: string, mime: string) {
    const w = window as unknown as SaveWindow;
    try {
      if (w.showSaveFilePicker) {
        const handle = await w.showSaveFilePicker({ suggestedName });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        setNote(`Saved ${suggestedName}.`);
        return;
      }
    } catch {
      // user cancelled the picker, or it failed → fall through to download
    }
    // Fallback: download
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(url);
    setNote(`Downloaded ${suggestedName}.`);
  }

  async function saveMarkdown() {
    setError(null);
    await saveBlob(markdown, `${fileName}.md`, "text/markdown");
  }

  async function saveMdHtml() {
    setError(null);
    setNote("Building…");
    try {
      const res = await fetch("/api/build/md-html", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown, title: fileName }),
      });
      if (!res.ok) throw new Error("build failed");
      const { html: carrier } = (await res.json()) as { html: string };
      await saveBlob(carrier, `${fileName}.md.html`, "text/html");
    } catch {
      setError("Couldn't build the .md.html file.");
    }
  }

  if (!ENTITLED_LOCAL) return null; // defensive; anonymous always has localFile

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-muted hover:text-ink">← Alembic</Link>
          <h1 className="font-serif text-2xl tracking-tight text-ink">Studio</h1>
          <p className="text-sm text-muted">
            Edit Markdown &amp; <code>.md.html</code> files on your own computer — no account, nothing stored.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => { setMarkdown(NEW_NOTE); setFileName("untitled"); setNote("New note."); setError(null); }}
            className="btn btn-ghost btn-sm"
          >
            New note
          </button>
          <label className="btn btn-ghost btn-sm cursor-pointer">
            Open file…
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,.txt,.md.html,text/markdown,text/plain,text/html"
              onChange={onFile}
              className="hidden"
            />
          </label>
          <button onClick={saveMarkdown} className="btn btn-ghost btn-sm">Save .md</button>
          <button onClick={saveMdHtml} className="btn btn-primary btn-sm">Save .md.html</button>
        </div>
      </header>

      {(note || error) && (
        <p className={`text-sm ${error ? "text-danger" : "text-ok"}`}>{error ?? note}</p>
      )}

      <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="text-sm text-muted">
            Name{" "}
            <input
              value={fileName}
              onChange={(e) => setFileName(e.target.value.replace(/[^a-zA-Z0-9._-]+/g, "-"))}
              className="field ml-1 text-sm"
            />
          </label>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            spellCheck
            className="field h-[70vh] w-full resize-none font-mono text-sm"
            placeholder="Write in Markdown — chemistry (H~2~O) and math ($E=mc^2$) supported."
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-muted">Preview</span>
          <iframe
            title="Preview"
            srcDoc={html}
            className="h-[70vh] w-full rounded-xl border border-[var(--border)] bg-[var(--bg)]"
          />
        </div>
      </div>

      <p className="text-xs text-faint">
        Anonymous &amp; local: your file is read and written on your device. Preview and
        building <code>.md.html</code> render on the server but store nothing. Sign in to
        publish, use AI, or work on full course packages.
      </p>
    </main>
  );
}
