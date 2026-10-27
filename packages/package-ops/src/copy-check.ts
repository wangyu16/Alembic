/**
 * Copying and answer-key checks (design §9.4; owner ruling R27: strict —
 * 50 words per quotation, any 12-word run from an answer key blocks).
 *
 * Fingerprints hold no readable content: each is a set of hashes of
 * overlapping word runs ("shingles"), so they can be kept after a source file
 * is deleted or its uploader leaves, and the check keeps working.
 * Pure: hashing uses a small non-cryptographic hash (FNV-1a 64-bit as two
 * 32-bit halves) — collisions only cause a false "too close", never a leak.
 */

import type { UnitCheck } from "./publish-job";

export const QUOTE_LIMIT_WORDS = 50; // R27
export const ANSWER_KEY_RUN_WORDS = 12; // R27 (O19)
export const SHINGLE = 8; // words per shingle for source fingerprints

/** Lower-case words; punctuation and markup stripped; digits kept. */
export function words(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ") // code fences are not prose
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

function fnv1a(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x050c5d1f;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** Shingle hashes of `n`-word runs. */
export function shingles(ws: readonly string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= ws.length; i++) out.add(fnv1a(ws.slice(i, i + n).join(" ")));
  return out;
}

/** A fingerprint: shingle hashes only, never text. */
export interface Fingerprint {
  sourceId: string;
  n: number;
  hashes: string[];
}

export function fingerprint(sourceId: string, text: string, n = SHINGLE): Fingerprint {
  return { sourceId, n, hashes: [...shingles(words(text), n)] };
}

/** A run of consecutive matching words in a public-bound file. */
export interface MatchRun {
  sourceId: string;
  startWord: number;
  length: number; // words
  excerpt: string; // from the PUBLIC file (never source text)
}

/**
 * Longest runs of the public text that also appear in the fingerprint:
 * consecutive shingle hits are joined into runs of n + k - 1 words.
 */
export function matchRuns(publicText: string, fp: Fingerprint): MatchRun[] {
  const ws = words(publicText);
  const set = new Set(fp.hashes);
  const runs: MatchRun[] = [];
  let start = -1;
  for (let i = 0; i + fp.n <= ws.length + 1; i++) {
    const hit = i + fp.n <= ws.length && set.has(fnv1a(ws.slice(i, i + fp.n).join(" ")));
    if (hit && start < 0) start = i;
    if (!hit && start >= 0) {
      const length = i - 1 - start + fp.n;
      runs.push({ sourceId: fp.sourceId, startWord: start, length, excerpt: ws.slice(start, start + Math.min(length, 20)).join(" ") });
      start = -1;
    }
  }
  return runs;
}

export interface CopyFinding {
  path: string;
  check: "copying" | "answer-key";
  severity: "always";
  message: string;
  sourceId?: string;
}

/**
 * Copying check for one public-bound file: any run longer than the quotation
 * limit blocks; so does a per-source total above 300 words in the file.
 */
export function checkCopying(path: string, text: string, fps: readonly Fingerprint[], opts: { quoteLimit?: number; perSourceTotal?: number } = {}): CopyFinding[] {
  const limit = opts.quoteLimit ?? QUOTE_LIMIT_WORDS;
  const total = opts.perSourceTotal ?? 300;
  const out: CopyFinding[] = [];
  for (const fp of fps) {
    const runs = matchRuns(text, fp);
    const long = runs.filter((r) => r.length > limit);
    for (const r of long) {
      out.push({ path, check: "copying", severity: "always", sourceId: fp.sourceId, message: `A passage of ${r.length} words matches a source ("${r.excerpt}…"); quotations are limited to ${limit} words` });
    }
    const sum = runs.reduce((a, r) => a + r.length, 0);
    if (!long.length && sum > total) {
      out.push({ path, check: "copying", severity: "always", sourceId: fp.sourceId, message: `${sum} words in this file match one source; the limit is ${total} per source` });
    }
  }
  return out;
}

/**
 * Answer-key check: any run of ANSWER_KEY_RUN_WORDS words shared with a
 * private instructor file blocks. `privateTexts` are read at check time from
 * the pinned working tree and never leave the check.
 */
export function checkAnswerKeys(path: string, text: string, privateTexts: ReadonlyArray<{ path: string; text: string }>, run = ANSWER_KEY_RUN_WORDS): CopyFinding[] {
  const out: CopyFinding[] = [];
  const pub = words(text);
  if (pub.length < run) return out;
  for (const p of privateTexts) {
    const fp = { sourceId: p.path, n: run, hashes: [...shingles(words(p.text), run)] };
    const runs = matchRuns(text, fp);
    if (runs.length) {
      out.push({ path, check: "answer-key", severity: "always", message: `${runs.length} passage(s) of ${run}+ words also appear in a private instructor file` });
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- *
 * Publish check plug-ins (publisher §4; interface I8)
 * -------------------------------------------------------------------------- */


/**
 * Answer-key and copying checks as Publish plug-ins. `privateTexts` are the
 * pinned working tree's `private/instructor/` files; `fingerprints` the
 * course's source fingerprints (kept after a file is removed). Both always
 * block (R27). Findings never quote private text; a copying finding shows up
 * to 20 words of the matching passage *from the course file itself*.
 */
export function copyChecks(privateTexts: ReadonlyArray<{ path: string; text: string }>, fingerprints: readonly Fingerprint[]): UnitCheck[] {
  const textual = (p: string) => /\.(md|txt|html|svg|json|csv)$/i.test(p);
  return [
    {
      id: "answer-key",
      async run(unit, files) {
        return files
          .filter((f) => f.text !== null && textual(f.path))
          .flatMap((f) => checkAnswerKeys(f.path, f.text!, privateTexts))
          .map((x) => ({ unit, path: x.path, check: x.check, severity: x.severity, message: x.message }));
      },
    },
    {
      id: "copying",
      async run(unit, files) {
        return files
          .filter((f) => f.text !== null && textual(f.path))
          .flatMap((f) => checkCopying(f.path, f.text!, fingerprints))
          .map((x) => ({ unit, path: x.path, check: x.check, severity: x.severity, message: x.message }));
      },
    },
  ];
}
