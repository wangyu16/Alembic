/**
 * Comparing two versions of a text (history-v3 §2): a line diff, unchanged
 * runs folded to a little context. Myers' O(ND) algorithm with caps on lines
 * and on edit distance, so a huge or wholly different pair is refused rather
 * than costing the worker or the page. Pure.
 */

export type DiffLine = { op: "same" | "add" | "remove"; text: string } | { op: "fold"; count: number };

export const MAX_DIFF_LINES = 20_000;
export const MAX_DIFF_EDITS = 2_000;

export type DiffResult = { ok: true; lines: DiffLine[]; added: number; removed: number } | { ok: false; reason: "too-large" };

/** The line diff of `a` → `b`, with `context` unchanged lines kept around each change. */
export function diffLines(a: string, b: string, context = 3): DiffResult {
  const x = a.split("\n");
  const y = b.split("\n");
  if (x.length > MAX_DIFF_LINES || y.length > MAX_DIFF_LINES) return { ok: false, reason: "too-large" };
  // Trim the common head and tail first (cheap, and the usual case is a small edit).
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  const xs = x.slice(head, x.length - tail);
  const ys = y.slice(head, y.length - tail);
  const script = myers(xs, ys);
  if (!script) return { ok: false, reason: "too-large" };
  const raw: Array<{ op: "same" | "add" | "remove"; text: string }> = [
    ...x.slice(0, head).map((text) => ({ op: "same" as const, text })),
    ...script,
    ...x.slice(x.length - tail).map((text) => ({ op: "same" as const, text })),
  ];
  return { ok: true, lines: fold(raw, context), added: script.filter((l) => l.op === "add").length, removed: script.filter((l) => l.op === "remove").length };
}

function myers(x: string[], y: string[]): Array<{ op: "same" | "add" | "remove"; text: string }> | null {
  const n = x.length, m = y.length, max = n + m;
  if (max === 0) return [];
  // Only k in [-D, D] is ever used (D = the edit cap), and only that band is kept per step: memory stays about
  // D² ints (≈16 MB at the cap) however long the texts are.
  const band = Math.min(max, MAX_DIFF_EDITS) + 1;
  const offset = band;
  let v: Int32Array = new Int32Array(2 * band + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max; d++) {
    if (d > MAX_DIFF_EDITS) return null;
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let j = i - k;
      while (i < n && j < m && x[i] === y[j]) { i++; j++; }
      v[offset + k] = i;
      if (i >= n && j >= m) { found = d; break; }
    }
    if (found >= 0) break;
  }
  // Walk the trace back to an edit script.
  const out: Array<{ op: "same" | "add" | "remove"; text: string }> = [];
  let i = n, j = m;
  for (let d = found; d > 0; d--) {
    v = trace[d]!;
    const at = (kk: number) => v[kk + d + 1]!; // the saved band starts at k = -d - 1
    const k = i - j;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevI = at(prevK);
    const prevJ = prevI - prevK;
    while (i > prevI && j > prevJ) out.push({ op: "same", text: x[--i]! }), j--;
    if (i === prevI) out.push({ op: "add", text: y[--j]! });
    else out.push({ op: "remove", text: x[--i]! });
  }
  while (i > 0 && j > 0) out.push({ op: "same", text: x[--i]! }), j--;
  return out.reverse();
}

function fold(lines: Array<{ op: "same" | "add" | "remove"; text: string }>, context: number): DiffLine[] {
  const out: DiffLine[] = [];
  let k = 0;
  while (k < lines.length) {
    if (lines[k]!.op !== "same") { out.push(lines[k]!); k++; continue; }
    let e = k;
    while (e < lines.length && lines[e]!.op === "same") e++;
    const run = lines.slice(k, e);
    const lead = k === 0 ? 0 : context;
    const trail = e === lines.length ? 0 : context;
    if (run.length > lead + trail + 1) {
      out.push(...run.slice(0, lead), { op: "fold", count: run.length - lead - trail }, ...run.slice(run.length - trail));
    } else out.push(...run);
    k = e;
  }
  return out;
}
