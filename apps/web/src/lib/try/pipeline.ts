/**
 * The try-mode demo pipeline (C7; design §12.5): one short sample chapter in
 * the real authoring order, each part shown as it is made. Light checks only:
 * the file must parse as an orz document without errors; a failed part is
 * made once more, then replaced by the ready-made example. Nothing is saved.
 */
import { PARTS, systemPrompt, type PartId, type PartSpec } from "./guides";
import { sourcesSection, type WikiSource } from "./wikipedia";

export type TryEvent =
  | { type: "step"; part: PartId; title: string; purpose: string; status: "working" | "done" | "example" }
  | { type: "file"; part: PartId; path: string; kind: "md" | "slides"; text: string }
  | { type: "sources"; items: Array<{ title: string; url: string }> }
  | { type: "refused"; message: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface TryDeps {
  /** One model call: system + user → the text answer. */
  write(system: string, user: string, maxTokens: number): Promise<string>;
  /** Is the topic fine for a classroom demo? */
  topicOk(topic: string): Promise<boolean>;
  sources(topic: string): Promise<WikiSource[]>;
  /** Errors from parsing the file as an orz document (empty = fine). */
  check(kind: "md" | "slides", text: string): string[];
  /** The ready-made example for a part, used when a part fails twice. */
  example(part: PartId): { path: string; text: string };
}

export const slugOf = (topic: string) =>
  topic.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "sample";

/** Strip anything a model might wrap around the file (a fence, a preamble before the header). */
export function cleanFile(text: string): string {
  let t = text.trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(t);
  if (fence) t = fence[1]!.trim();
  const i = t.indexOf("{{nyml");
  if (i > 0) t = t.slice(i);
  return `${t}\n`;
}

export async function runTry(input: { topic: string; level?: string }, deps: TryDeps, emit: (e: TryEvent) => void): Promise<void> {
  const topic = input.topic.trim().slice(0, 120);
  const level = (input.level ?? "").trim().slice(0, 60) || "first-year university";
  if (!(await deps.topicOk(input.level ? `${topic} (level: ${level})` : topic))) {
    emit({ type: "refused", message: "That topic isn't one this demo can make a sample about. Here is a ready-made sample instead." });
    for (const spec of PARTS) emitExample(spec, deps, emit);
    emit({ type: "done" });
    return;
  }
  const slug = slugOf(topic);
  const sources = await deps.sources(topic).catch(() => [] as WikiSource[]);
  const reading = sources.map((s) => `Source: ${s.title} (Wikipedia)\n${s.extract}`).join("\n\n").slice(0, 7000);
  const made: Record<string, string> = {};

  for (const spec of PARTS) {
    emit({ type: "step", part: spec.id, title: spec.title, purpose: spec.purpose, status: "working" });
    const title = `${spec.title}: ${topic}`;
    const context = [
      `Topic: ${topic}`, `Level: ${level}`,
      made["concepts"] ? `The chapter's concept map (follow it):\n${made["concepts"]}` : "",
      reading ? `Background from Wikipedia (use it; don't copy long passages):\n${reading}` : "",
    ].filter(Boolean).join("\n\n");
    let text: string | null = null;
    for (let attempt = 0; attempt < 2 && text === null; attempt++) {
      try {
        const out = cleanFile(await deps.write(systemPrompt(spec, title), context, spec.maxTokens));
        if (deps.check(spec.kind, out).length === 0) text = out;
      } catch {
        /* try once more, then the example */
      }
    }
    if (text === null) { emitExample(spec, deps, emit); continue; }
    if (spec.id === "study-guide") text = text.trimEnd() + "\n" + sourcesSection(sources);
    made[spec.id] = text;
    emit({ type: "file", part: spec.id, path: spec.path(slug), kind: spec.kind, text });
    emit({ type: "step", part: spec.id, title: spec.title, purpose: spec.purpose, status: "done" });
  }
  if (sources.length) emit({ type: "sources", items: sources.map(({ title, url }) => ({ title, url })) });
  emit({ type: "done" });
}

function emitExample(spec: PartSpec, deps: TryDeps, emit: (e: TryEvent) => void) {
  const ex = deps.example(spec.id);
  emit({ type: "file", part: spec.id, path: ex.path, kind: spec.kind, text: ex.text });
  emit({ type: "step", part: spec.id, title: spec.title, purpose: spec.purpose, status: "example" });
}
