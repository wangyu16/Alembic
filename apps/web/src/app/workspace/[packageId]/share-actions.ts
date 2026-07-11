"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * P2 — "share this": the per-file discoverability toggle (document-model.md
 * §4). Opt-in, one click, owner-only (registry RLS enforces ownership).
 * Objects need a short description before they can be shared (it becomes the
 * element-search text and the a11y alt text — package-layout.md §6). The
 * `private` and `current` spaces can never be discoverable (contract v2 §2).
 */

export interface ShareResult {
  ok: boolean;
  error?: string;
  /** The shareable permalink, when now discoverable. */
  permalink?: string;
}

const NEVER_DISCOVERABLE = new Set(["private", "current"]);

export async function shareFileAction(
  packageId: string,
  docId: string,
  share: boolean,
  description?: string,
): Promise<ShareResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  // Owner read via session RLS — a non-owner simply finds nothing.
  const { data: row } = await supabase
    .from("documents")
    .select("doc_id, package_id, space, permalink_class, description, tombstoned")
    .eq("doc_id", docId)
    .eq("package_id", packageId)
    .maybeSingle();
  if (!row || row.tombstoned) {
    return { ok: false, error: "That file isn't registered (open the package once, then retry)." };
  }

  if (share && NEVER_DISCOVERABLE.has(row.space)) {
    return { ok: false, error: "Files in this space can't be shared." };
  }

  const nextDescription = description?.trim() || row.description || null;
  if (share && row.permalink_class === "object" && !nextDescription) {
    return {
      ok: false,
      error: "Add a short description first — it's what others will find it by.",
    };
  }

  const { error } = await supabase
    .from("documents")
    .update({
      discoverable: share,
      ...(nextDescription !== row.description ? { description: nextDescription } : {}),
    })
    .eq("doc_id", docId)
    .eq("package_id", packageId);
  if (error) return { ok: false, error: "Couldn't update sharing. Please try again." };

  return { ok: true, permalink: share ? `/d/${docId}` : undefined };
}

/**
 * CF4 — set an asset's shareable metadata in one call: description, tags,
 * license, and the discoverable flag. Extends the share gate: an object must
 * have a description before it can be made discoverable (element search + a11y).
 * Owner-only via registry RLS; `private`/`current` can never be discoverable.
 */
export interface AssetMetadataInput {
  description?: string;
  tags?: string[];
  license?: string;
  discoverable?: boolean;
}

export async function setAssetMetadataAction(
  packageId: string,
  docId: string,
  input: AssetMetadataInput,
): Promise<ShareResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const { data: row } = await supabase
    .from("documents")
    .select("doc_id, package_id, space, permalink_class, description, tombstoned")
    .eq("doc_id", docId)
    .eq("package_id", packageId)
    .maybeSingle();
  if (!row || row.tombstoned) {
    return { ok: false, error: "That file isn't registered (open the package once, then retry)." };
  }

  const discoverable = input.discoverable ?? false;
  if (discoverable && NEVER_DISCOVERABLE.has(row.space)) {
    return { ok: false, error: "Files in this space can't be shared." };
  }
  const description = input.description?.trim() || row.description || null;
  if (discoverable && row.permalink_class === "object" && !description) {
    return { ok: false, error: "Add a short description first — it's what others will find it by." };
  }

  const patch: Record<string, unknown> = { discoverable };
  patch["description"] = description;
  if (input.tags) patch["tags"] = input.tags.map((t) => t.trim()).filter(Boolean);
  if (input.license !== undefined) patch["license"] = input.license.trim() || null;

  const { error } = await supabase
    .from("documents")
    .update(patch)
    .eq("doc_id", docId)
    .eq("package_id", packageId);
  if (error) return { ok: false, error: "Couldn't save. Please try again." };

  return { ok: true, permalink: discoverable ? `/d/${docId}` : undefined };
}
