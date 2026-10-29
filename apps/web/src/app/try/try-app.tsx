"use client";

/**
 * Try mode (C7; design §12.5): a demo, not a workspace. The visitor names a
 * topic, watches a short sample chapter being made in the real authoring
 * order, and opens each file in the real orz editor. Nothing is saved.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { loadKit, type OrzEditor } from "@/lib/orz-editor/kit";

type Status = "working" | "done" | "example";
interface Step { part: string; title: string; purpose: string; status: Status }
interface File { part: string; path: string; kind: "md" | "slides"; text: string }

const ORDER = ["concepts", "assessment", "study-guide", "slides", "practice"];

export function TryApp() {
  const [phase, setPhase] = useState<"intro" | "form" | "making" | "made">("intro");
  const [topic, setTopic] = useState("");
  const [code, setCode] = useState("");
  const [level, setLevel] = useState("");
  const [steps, setSteps] = useState<Record<string, Step>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<Array<{ title: string; url: string }>>([]);
  const [open, setOpen] = useState<string | null>(null);

  async function make(e: React.FormEvent) {
    e.preventDefault();
    setPhase("making"); setSteps({}); setFiles([]); setNotice(null); setError(null); setSources([]); setOpen(null);
    try {
      const res = await fetch("/api/try", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic, level, ...(code.trim() ? { code } : {}) }) });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Try mode isn't available right now.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as { type: string } & Record<string, unknown>;
          if (ev.type === "step") setSteps((s) => ({ ...s, [ev["part"] as string]: ev as unknown as Step }));
          else if (ev.type === "file") setFiles((f) => [...f.filter((x) => x.part !== ev["part"]), ev as unknown as File]);
          else if (ev.type === "sources") setSources(ev["items"] as Array<{ title: string; url: string }>);
          else if (ev.type === "notice" || ev.type === "refused") setNotice(ev["message"] as string);
          else if (ev.type === "error") setError(ev["message"] as string);
        }
      }
      setPhase("made");
    } catch (err) {
      setError((err as Error).message);
      setPhase("form");
    }
  }

  const ordered = ORDER.map((p) => steps[p]).filter(Boolean) as Step[];
  const fileByPart = new Map(files.map((f) => [f.part, f]));

  return (
    <main className="mx-auto w-full max-w-5xl p-6">
      <p className="rounded border border-amber-500 bg-amber-100 p-2 text-sm text-amber-950" role="note">
        <b>This is a demo.</b> Nothing you make here is saved. Demo output is not checked as a real course would be.
      </p>

      {phase === "intro" ? (
        <section className="mt-6 space-y-3">
          <h1 className="text-3xl font-semibold">See how a course chapter comes together</h1>
          <p>In Alembic, an educator and an AI assistant build a course together, one chapter at a time, in a fixed order:</p>
          <ol className="list-decimal space-y-1 pl-6">
            <li><b>Concept map</b>: the chapter&apos;s key ideas and how they connect. The educator approves it first.</li>
            <li><b>Assessment guide</b>: what students should be able to do, and how it is checked.</li>
            <li><b>Study guide</b>: the main reading, with equations, tables and diagrams.</li>
            <li><b>Slides</b>: a deck to teach it in class.</li>
            <li><b>Practice</b>: questions with worked answers.</li>
          </ol>
          <p>Everything is written as plain-text documents that open in the orz editors, are kept in the educator&apos;s own GitHub account, and publish as an open course website.</p>
          <p>Name any topic, and a fast, low-cost AI model will make a short sample chapter while you watch. It uses its own knowledge and Wikipedia; no textbooks or uploads.</p>
          <button type="button" className="rounded bg-black px-4 py-2 text-white" onClick={() => setPhase("form")}>Try it</button>
        </section>
      ) : null}

      {phase === "form" || phase === "making" || phase === "made" ? (
        <form onSubmit={make} className="mt-6 flex flex-wrap items-end gap-2">
          <label className="flex flex-1 flex-col text-sm">Topic
            <input value={topic} onChange={(e) => setTopic(e.target.value)} required minLength={2} maxLength={120} placeholder="e.g. Photosynthesis, Supply and demand, Newton's laws" className="mt-1 rounded border px-2 py-1.5" disabled={phase === "making"} />
          </label>
          <label className="flex flex-col text-sm">Level (optional)
            <input value={level} onChange={(e) => setLevel(e.target.value)} maxLength={60} placeholder="first-year university" className="mt-1 rounded border px-2 py-1.5" disabled={phase === "making"} />
          </label>
          <label className="flex flex-col text-sm">Workshop code (if you have one)
            <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} placeholder="WKS-…" autoComplete="off" className="mt-1 w-40 rounded border px-2 py-1.5 font-mono" disabled={phase === "making"} />
          </label>
          <button type="submit" disabled={phase === "making"} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">{phase === "making" ? "Making…" : phase === "made" ? "Make another" : "Make a sample chapter"}</button>
        </form>
      ) : null}

      {error ? <p className="mt-3 text-red-700" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 rounded border p-2 text-sm" role="status">{notice}</p> : null}

      {ordered.length ? (
        <ol className="mt-6 space-y-2" aria-live="polite">
          {ordered.map((s) => (
            <li key={s.part} className="rounded border p-3">
              <div className="flex items-center justify-between gap-2">
                <b>{s.title}</b>
                <span className="text-sm">{s.status === "working" ? "Writing…" : s.status === "done" ? "Done" : "Ready-made example"}</span>
              </div>
              <p className="text-sm text-muted">{s.purpose}</p>
              {s.part === "concepts" && s.status !== "working" ? <p className="mt-1 text-sm">✓ Plan approved (a click in the real product).</p> : null}
              {fileByPart.get(s.part) ? (
                <button type="button" className="mt-2 text-sm underline" onClick={() => setOpen(open === s.part ? null : s.part)}>{open === s.part ? "Close" : "Open in the editor"}</button>
              ) : null}
              {open === s.part && fileByPart.get(s.part) ? <TryEditor file={fileByPart.get(s.part)!} /> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {phase === "made" ? (
        <section className="mt-8 space-y-2 rounded border p-4">
          {sources.length ? <p className="text-sm">Sources: {sources.map((s, i) => <span key={s.url}>{i ? ", " : ""}<a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.title}</a></span>)} (Wikipedia, CC BY-SA 4.0).</p> : null}
          <h2 className="text-xl font-semibold">Use it for real</h2>
          <p>Real courses are made with you approving each step, with your own sources, kept in your GitHub account and published as an open course website.</p>
          <ul className="list-disc pl-6">
            <li>Join a workshop: the best way to start (ask the Alembic team for the next date).</li>
            <li><Link className="underline" href="/guide">Read the guide</Link> to explore on your own.</li>
            <li><Link className="underline" href="/signin">Sign in with GitHub</Link> to make your first course.</li>
          </ul>
        </section>
      ) : null}
    </main>
  );
}

/** A sample file in its real orz editor. Edits stay in this page; nothing is saved. */
function TryEditor({ file }: { file: File }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let ed: OrzEditor | null = null;
    let gone = false;
    void loadKit(file.kind).then((kit) => {
      if (gone || !host.current) return;
      ed = kit.mountEditor(host.current, {
        text: file.text,
        mode: "split",
        chrome: "full",
        fileName: file.path.split("/").pop() ?? "sample.md",
        // A demo keeps nothing here: Save gives the visitor their own copy, a file that opens and edits itself.
        hooks: {
          save: async (text: string) => {
            const html = await kit.assemble(text, { delivery: "inline" });
            const name = (file.path.split("/").pop() ?? "sample.md").replace(/\.md$/i, "") + (file.kind === "slides" ? ".html" : ".md.html");
            const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
            const a = Object.assign(document.createElement("a"), { href: url, download: name.replace(/\.slides\.html$/, ".slides.html") });
            document.body.append(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
          },
        },
      });
    }).catch((e: Error) => setFailed(e.message));
    return () => { gone = true; ed?.destroy(); };
  }, [file]);
  return (
    <div className="mt-2">
      <p className="text-xs text-muted">You can edit this. Nothing is kept here when you leave; Save downloads your own copy to your computer.</p>
      {failed ? <p className="text-red-700">{failed}</p> : null}
      <div ref={host} className="h-[70vh] rounded border" />
    </div>
  );
}
