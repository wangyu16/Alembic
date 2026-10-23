/**
 * Loop r1b HIGH-1 (P5.B.1.m), conformance: registration is part of the ONE
 * write path, so no server action can forget it. Before r1b, ~17 content
 * saves (hosted editors, edit page, change review, assets, assessments,
 * planning, metadata, adaptation) called writeThrough and never registered.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseSandboxStore } from "./sandbox-store";
import { SupabaseDocumentRegistryStore } from "./document-registry-store";

const SRC = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("every web write registers what it wrote", () => {
  it("[P5.B.1.m] [P5.B.1.l] the production store carries the registry the write path registers in", () => {
    const store = new SupabaseSandboxStore({} as SupabaseClient);
    expect(store.registry).toBeInstanceOf(SupabaseDocumentRegistryStore);
  });

  it("[P5.B.1.m] [P5.B.1.l] no web code writes through any other store, and no write site re-registers by hand", () => {
    const writers: string[] = [];
    for (const file of sources(SRC)) {
      const text = readFileSync(file, "utf8");
      const rel = relative(SRC, file);
      expect(text, `${rel} builds an in-memory store`).not.toMatch(/new MemoryPackageStore\b/);
      if (/\b(writeThrough|updateManifest|writeChanges)\(/.test(text)) writers.push(rel);
      // Hand registration after a write-path write is gone (the write path does it).
      if (/\b(writeThrough|writeChanges)\(/.test(text)) {
        expect(text, `${rel} registers by hand after writing`).not.toMatch(/\bregisterChanges\(/);
      }
    }
    expect(writers.length).toBeGreaterThan(15); // the scan actually saw the writers
  });
});
