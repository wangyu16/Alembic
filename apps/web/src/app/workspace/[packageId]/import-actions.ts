"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  classifyImport,
  loadStudyGuide,
  parseImportedMarkdown,
  reconcileImportedBlocks,
  saveStudyGuide,
} from "@alembic/package-ops";
import { restructureToBlocks } from "@alembic/ai-assist";
import { getKind } from "@alembic/carriers";
import { serializeStudyGuide } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { syncFilesToGitHub } from "@/lib/github";
import { governedProvider, RateLimitError, BudgetExceededError } from "@/lib/ai";
import { recordChange } from "@/lib/changes";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

const ASSET_DIR: Record<string, string> = { ketcher: "structures", plot: "plots" };

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "import";
}

export interface ImportResult {
  ok: boolean;
  /** Educator-facing summary of what happened. */
  message?: string;
  /** For an imported asset: its repo-relative path (to insert a reference). */
  assetPath?: string;
  error?: string;
}

/**
 * Lossless re-import of a single file (M12.1): a carrier or Markdown that
 * Alembic / an orz extension wrote, brought back deterministically (no AI).
 * Asset carriers are stored under `materials/`; document/markdown is appended
 * to the active chapter.
 */
export async function importFileAction(
  packageId: string,
  filename: string,
  content: string,
  activePath: string,
): Promise<ImportResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const events = supabaseEventLogger(supabase);
  try {
    const c = classifyImport(filename, content);

    if (c.type === "unknown") return { ok: false, error: c.reason };

    if (c.type === "asset") {
      const dir = ASSET_DIR[c.kind] ?? "figures";
      const ext = getKind(c.kind)?.extension ?? "";
      const base = slugify(filename.replace(/\.[^.]*$/, "").replace(/\.(ketcher|plot)$/, ""));
      const path = `materials/${dir}/${base}${ext}`;
      await store.putFiles(packageId, [{ repo: "public", path, content: c.carrier }]);
      await syncFilesToGitHub(supabase, store, user.id, packageId, [{ path, content: c.carrier }], "Import asset (Alembic)");
      await events.log({ type: "import.completed", userId: user.id, packageId, detail: { kind: c.kind, mode: "asset", filename }, occurredAt: new Date().toISOString() });
      revalidatePath(`/workspace/${packageId}`);
      return { ok: true, message: `Imported ${base}${ext}.`, assetPath: path };
    }

    // document carrier or plain markdown → reconcile blocks into the active
    // chapter BY BLOCK ID (lossless round-trip): re-imported sections replace
    // their originals in place (IDs preserved); new sections are added. Never
    // append-with-null, which would duplicate a re-uploaded chapter.
    const markdown = c.markdown;
    const incoming = parseImportedMarkdown(markdown);
    if (incoming.length === 0) return { ok: false, error: "No sections found to import." };
    const doc = await loadStudyGuide(store, packageId, activePath);
    const reconciled = reconcileImportedBlocks(doc.blocks, incoming);
    const { blocks } = await saveStudyGuide(store, packageId, {
      path: activePath,
      preamble: doc.preamble,
      blocks: reconciled.blocks,
    });
    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [{ path: activePath, content: serializeStudyGuide(doc.preamble, blocks) }],
      "Import content (Alembic)",
    );
    await events.log({ type: "import.completed", userId: user.id, packageId, detail: { mode: c.type, filename, updated: reconciled.updated, added: reconciled.added }, occurredAt: new Date().toISOString() });
    revalidatePath(`/workspace/${packageId}`);
    const parts = [
      reconciled.updated ? `${reconciled.updated} updated` : "",
      reconciled.added ? `${reconciled.added} new` : "",
    ].filter(Boolean);
    return { ok: true, message: `Imported${parts.length ? ` (${parts.join(", ")})` : ""}.` };
  } catch {
    return { ok: false, error: "Couldn't import that file. Please try again." };
  }
}

export interface RestructureResult {
  ok: boolean;
  error?: string;
}

/**
 * Lossy import (M12.3): restructure pasted/foreign text into study-guide
 * sections with AI, enqueued as a Tier-2 review (never applied directly).
 */
export async function restructureImportAction(
  packageId: string,
  text: string,
  activePath: string,
): Promise<RestructureResult> {
  const { supabase, user } = await requireUser();
  if (!text.trim()) return { ok: false, error: "Paste some text to restructure." };
  try {
    const record = await new SupabaseSandboxStore(supabase).getPackage(packageId);
    const provider = governedProvider(supabase, { userId: user.id, packageId, kind: "import-blocks" });
    const { blocks } = await restructureToBlocks(provider, { text, context: record?.title });
    if (blocks.length === 0) return { ok: false, error: "Couldn't find any sections in that text." };
    await recordChange(supabase, {
      packageId,
      userId: user.id,
      tier: 2,
      kind: "import-blocks",
      summary: `Import: ${blocks.length} restructured section${blocks.length === 1 ? "" : "s"}`,
      detail: { path: activePath, blocks },
      status: "pending",
    });
    await supabaseEventLogger(supabase).log({ type: "review.queued", userId: user.id, packageId, detail: { kind: "import-blocks", sections: blocks.length }, occurredAt: new Date().toISOString() });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof RateLimitError || e instanceof BudgetExceededError) return { ok: false, error: e.message };
    return { ok: false, error: "Couldn't restructure the text. Please try again." };
  }
}
