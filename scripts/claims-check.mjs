#!/usr/bin/env node
// Claims checker (no dependencies). Reads docs/claims/*.toml (or the files
// given as arguments) and checks every claim's binding against the test
// sources:
//
//   bound           every bound_to "<file> :: <title>" has a test title in
//                   <file> that carries "[<id>]" and whose text (tags
//                   stripped) equals <title>
//   UNBOUND         bound_to = []  — no test proves the claim yet
//   bound-but-missing  a binding whose file, tag or title is not found
//
// Also warns about "[P5…]" tags in test files that no claim declares.
// Exits 1 if any claim is UNBOUND or bound-but-missing.
//
// TOML subset: comments (#), [table] and [[array-of-tables]] headers,
// key = "basic string" (escapes \" \\ \n \t), key = [ "string", ... ] across
// lines. Nothing else is needed by the registry.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

// ── minimal TOML subset ─────────────────────────────────────────────────
function parseToml(text, file) {
  const out = {};
  let cur = out;
  let i = 0;
  let line = 1;
  const err = (m) => {
    throw new Error(`${file}:${line}: ${m}`);
  };
  const ws = () => {
    for (;;) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\r") i++;
      else if (c === "#") while (i < text.length && text[i] !== "\n") i++;
      else break;
    }
  };
  const wsNl = () => {
    for (;;) {
      ws();
      if (text[i] === "\n") (i++, line++);
      else break;
    }
  };
  const str = () => {
    if (text[i] !== '"') err("expected a string");
    i++;
    let s = "";
    for (;;) {
      const c = text[i++];
      if (c === undefined || c === "\n") err("unterminated string");
      if (c === '"') return s;
      if (c === "\\") {
        const e = text[i++];
        s += e === "n" ? "\n" : e === "t" ? "\t" : e === '"' || e === "\\" ? e : err(`bad escape \\${e}`);
      } else s += c;
    }
  };
  const value = () => {
    if (text[i] === '"') return str();
    if (text[i] === "[") {
      i++;
      const arr = [];
      for (;;) {
        wsNl();
        if (text[i] === "]") return (i++, arr);
        arr.push(str());
        wsNl();
        if (text[i] === ",") i++;
        else if (text[i] !== "]") err("expected , or ]");
      }
    }
    err("unsupported value (strings and arrays of strings only)");
  };
  for (;;) {
    wsNl();
    if (i >= text.length) return out;
    if (text[i] === "[") {
      const many = text[i + 1] === "[";
      const m = /^\[\[?([A-Za-z0-9_.-]+)\]\]?/.exec(text.slice(i));
      if (!m) err("bad table header");
      i += m[0].length;
      const name = m[1];
      if (many) (out[name] ??= []).push((cur = {}));
      else cur = out[name] = {};
    } else {
      const m = /^([A-Za-z0-9_-]+)\s*=\s*/.exec(text.slice(i));
      if (!m) err("expected key = value");
      i += m[0].length;
      if (m[1] in cur) err(`duplicate key ${m[1]}`);
      cur[m[1]] = value();
    }
    ws();
    if (i < text.length && text[i] !== "\n") err("trailing characters");
  }
}

// ── test sources ────────────────────────────────────────────────────────
const TAG = /\[((?:P5|RC|K1)\.[A-Za-z0-9.]+)\]/g;
// A string literal that starts with one or more [id] tags.
const TAGGED_LITERAL = /(["'`])((?:\[(?:P5|RC|K1)\.[A-Za-z0-9.]+\]\s*)+)((?:\\.|(?!\1)[^\\\n])*)\1/g;

function taggedTitles(source) {
  const found = [];
  for (const m of source.matchAll(TAGGED_LITERAL)) {
    const ids = [...m[2].matchAll(TAG)].map((t) => t[1]);
    found.push({ ids, title: m[3].trim() });
  }
  return found;
}

function testFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) testFiles(p, acc);
    else if (/\.test\.[cm]?[jt]sx?$/.test(name)) acc.push(p);
  }
  return acc;
}

// ── check ───────────────────────────────────────────────────────────────
const registries = process.argv.slice(2).length
  ? process.argv.slice(2).map((p) => resolve(p))
  : readdirSync(join(ROOT, "docs/claims"))
      .filter((f) => f.endsWith(".toml"))
      .map((f) => join(ROOT, "docs/claims", f));

const claims = [];
for (const reg of registries) {
  const doc = parseToml(readFileSync(reg, "utf8"), relative(ROOT, reg));
  for (const c of doc.claim ?? []) claims.push({ ...c, registry: relative(ROOT, reg) });
}

const problems = [];
const ids = new Set();
for (const c of claims) {
  if (!c.id || !c.claim || !c.oracle || !Array.isArray(c.bound_to)) problems.push(`${c.id ?? "?"}: missing id/claim/oracle/bound_to`);
  if (ids.has(c.id)) problems.push(`${c.id}: duplicate id`);
  ids.add(c.id);
  if (!["invariant", "conformance", "scenario", "probe", "human"].includes(c.oracle)) problems.push(`${c.id}: unknown oracle ${c.oracle}`);
}

const cache = new Map();
const titlesOf = (file) => {
  if (!cache.has(file)) {
    const p = join(ROOT, file);
    cache.set(file, existsSync(p) ? taggedTitles(readFileSync(p, "utf8")) : null);
  }
  return cache.get(file);
};

const rows = [];
for (const c of claims) {
  if (c.bound_to.length === 0) {
    rows.push({ c, status: "UNBOUND", detail: c.note ?? "" });
    continue;
  }
  const missing = [];
  for (const b of c.bound_to) {
    const sep = b.indexOf(" :: ");
    if (sep < 0) {
      missing.push(`malformed binding "${b}"`);
      continue;
    }
    const file = b.slice(0, sep).trim();
    const title = b.slice(sep + 4).trim();
    const titles = titlesOf(file);
    if (titles === null) missing.push(`no file ${file}`);
    else if (!titles.some((t) => t.ids.includes(c.id) && t.title === title)) missing.push(`${file}: no "[${c.id}] ${title}"`);
  }
  rows.push(
    missing.length
      ? { c, status: "bound-but-missing", detail: missing.join("; ") }
      : { c, status: "bound", detail: `${c.bound_to.length} test${c.bound_to.length > 1 ? "s" : ""}` },
  );
}

// Tags in tests that no claim declares (or that bind a title the claim doesn't list).
const orphans = [];
for (const f of [...testFiles(join(ROOT, "apps")), ...testFiles(join(ROOT, "packages"))]) {
  const rel = relative(ROOT, f);
  for (const t of titlesOf(rel) ?? []) {
    for (const id of t.ids) {
      const c = claims.find((x) => x.id === id);
      if (!c) orphans.push(`${rel}: [${id}] is not in any registry`);
      else if (!c.bound_to.includes(`${rel} :: ${t.title}`)) orphans.push(`${rel}: [${id}] "${t.title}" is not listed in ${id}.bound_to`);
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────
const w = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
console.log(`${w("id", 11)} ${w("oracle", 11)} ${w("status", 17)} detail`);
console.log("-".repeat(100));
for (const r of rows) console.log(`${w(r.c.id, 11)} ${w(r.c.oracle, 11)} ${w(r.status, 17)} ${r.detail}`);
console.log("-".repeat(100));

const count = (s) => rows.filter((r) => r.status === s).length;
console.log(`${claims.length} claims: ${count("bound")} bound, ${count("UNBOUND")} UNBOUND, ${count("bound-but-missing")} bound-but-missing`);
const byOracle = {};
for (const r of rows) {
  const o = (byOracle[r.c.oracle] ??= { bound: 0, red: 0 });
  r.status === "bound" ? o.bound++ : o.red++;
}
console.log("by oracle: " + Object.entries(byOracle).map(([o, v]) => `${o} ${v.bound}/${v.bound + v.red}`).join(", "));
for (const p of problems) console.log(`ERROR ${p}`);
for (const o of orphans) console.log(`WARN  ${o}`);

process.exit(problems.length || count("UNBOUND") || count("bound-but-missing") ? 1 : 0);
