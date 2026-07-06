import "server-only";
import {
  buildMdHtml,
  buildSlidesHtml,
  type RenderTheme,
} from "@alembic/renderer";

/**
 * Web → worker seam for generating self-contained files. The upstream
 * generators are Node-only (read package assets), so they run in the worker
 * tier, never in this Vercel serverless runtime. When `WORKER_URL` is set the
 * web app calls the worker (producing LIVE, in-file-editable files); when it
 * is not — dev without a worker, or before the worker tier is deployed — it
 * falls back to the renderer's in-process builders (rendered docs, no in-file
 * editor) so exports keep working. `server-only` guards against a client bundle
 * ever pulling this in.
 */

export type GenerateKind = "md" | "slides" | "paged";

export interface GenerateFileInput {
  kind: GenerateKind;
  /** orz-markdown source (deck source for slides). */
  markdown: string;
  title?: string;
  /** Alembic's theme abstraction; mapped to an orz theme id for the worker. */
  theme?: RenderTheme;
}

/** Map Alembic's RenderTheme to an orz theme id (md; other kinds use defaults). */
function orzThemeId(theme: RenderTheme | undefined): string | undefined {
  if (theme === "dark") return "dark-elegant-1";
  if (theme === "light") return "light-academic-1";
  return undefined;
}

/** True when a worker is configured — callers can prefer the live path. */
export function workerConfigured(): boolean {
  return Boolean(process.env["WORKER_URL"]);
}

async function callWorker(input: GenerateFileInput): Promise<string> {
  const base = process.env["WORKER_URL"]!;
  const token = process.env["WORKER_TOKEN"];
  const res = await fetch(`${base.replace(/\/$/, "")}/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      kind: input.kind,
      markdown: input.markdown,
      title: input.title,
      theme: input.kind === "md" ? orzThemeId(input.theme) : undefined,
    }),
  });
  const data = (await res.json()) as { ok: boolean; html?: string; message?: string };
  if (!res.ok || !data.ok || !data.html) {
    throw new Error(data.message ?? `Worker generation failed (${res.status}).`);
  }
  return data.html;
}

/** In-process fallback (rendered docs, no in-file editor) for md/slides. */
function fallback(input: GenerateFileInput): string {
  if (input.kind === "md") {
    return buildMdHtml({ title: input.title ?? "Untitled", markdown: input.markdown, theme: input.theme });
  }
  if (input.kind === "slides") {
    return buildSlidesHtml({ title: input.title ?? "Slides", source: input.markdown });
  }
  // `.paged.html` has no legacy in-process builder — it only exists via the worker.
  throw new Error("Paged documents need the worker tier (set WORKER_URL).");
}

/**
 * Generate a self-contained file. Uses the worker when configured (live,
 * in-file-editable output); otherwise the in-process fallback. If the worker
 * is configured but unreachable, md/slides degrade to the fallback rather than
 * failing the export; paged surfaces the error (no fallback path).
 */
export async function generateSelfContainedFile(input: GenerateFileInput): Promise<string> {
  if (workerConfigured()) {
    try {
      return await callWorker(input);
    } catch (err) {
      if (input.kind === "paged") throw err;
      // md/slides: keep the export working on a fresh in-process build.
      return fallback(input);
    }
  }
  return fallback(input);
}

/**
 * Generate an EDITABLE self-contained file — worker only (E3 hosted editing).
 * The in-process fallback produces a rendered document with NO in-file editor
 * and no `orz-host-save` protocol, so it can't be hosted for editing. This
 * therefore THROWS when no worker is configured or the worker is unreachable,
 * letting the caller fall back to another editing surface rather than silently
 * mounting a view-only file the educator can't save.
 */
export async function generateEditableFile(input: GenerateFileInput): Promise<string> {
  if (!workerConfigured()) throw new Error("No worker configured for editable generation.");
  return callWorker(input);
}
