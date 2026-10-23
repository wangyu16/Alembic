"use server";

import { redirect } from "next/navigation";
import { discoveryChanged } from "@/lib/discovery-cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordDiscoveryEvent } from "@/lib/record-discovery-event";
import { canOfferShare, SHARE_NEEDS_PUBLISH } from "@/lib/share-policy";
import { REGISTRY_TEXT_LIMITS } from "@alembic/package-contract";

/**
 * P2 — "share this": the per-file discoverability toggle (document-model.md
 * §4). Opt-in, one click, owner-only (registry RLS enforces ownership).
 * Objects need a short description before they can be shared (it becomes the
 * element-search text and the a11y alt text — package-layout.md §6). The
 * `private` and `current` spaces can never be discoverable (contract v2 §2).
 * A trial course cannot share at all — the UI hides the control and these
 * actions refuse (owner ruling 2026-10-23, P5.R.2); unsharing always works.
 */

export interface ShareResult {
  ok: boolean;
  error?: string;
  /** The shareable permalink, when now discoverable. */
  permalink?: string;
}

const NEVER_DISCOVERABLE = new Set(["private", "current"]);

type Session = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** P5.R.2: may this package's files be made discoverable? (Owner read via RLS.) */
async function packageCanShare(supabase: Session, packageId: string): Promise<boolean> {
  const { data } = await supabase.from("packages").select("storage").eq("id", packageId).maybeSingle();
  return canOfferShare((data as { storage?: string } | null)?.storage);
}

/** A.7: a de-identified share/unshare event, only when the flag really flips. */
function logShareChange(
  row: { package_id: string; kind?: string | null; space?: string | null; discoverable?: boolean | null },
  next: boolean,
  userId: string,
  session: Session,
): void {
  if (Boolean(row.discoverable) === next) return;
  recordDiscoveryEvent(
    {
      type: next ? "element.shared" : "element.unshared",
      packageId: row.package_id,
      kind: row.kind ?? null,
      space: row.space ?? null,
    },
    { userId, session },
  );
}

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
    .select("doc_id, package_id, space, kind, permalink_class, description, discoverable, tombstoned")
    .eq("doc_id", docId)
    .eq("package_id", packageId)
    .maybeSingle();
  if (!row || row.tombstoned) {
    return { ok: false, error: "That file isn't registered (open the package once, then retry)." };
  }

  if (share && NEVER_DISCOVERABLE.has(row.space)) {
    return { ok: false, error: "Files in this space can't be shared." };
  }
  if (share && !(await packageCanShare(supabase, packageId))) {
    return { ok: false, error: SHARE_NEEDS_PUBLISH };
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
  logShareChange(row, share, user.id, supabase);

  discoveryChanged();
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
    .select("doc_id, package_id, space, kind, permalink_class, description, discoverable, tombstoned")
    .eq("doc_id", docId)
    .eq("package_id", packageId)
    .maybeSingle();
  if (!row || row.tombstoned) {
    return { ok: false, error: "That file isn't registered (open the package once, then retry)." };
  }

  // `discoverable` omitted → leave sharing as it is (the trial UI has no
  // share control, so it saves metadata without it).
  const discoverable = input.discoverable ?? Boolean(row.discoverable);
  if (input.discoverable && NEVER_DISCOVERABLE.has(row.space)) {
    return { ok: false, error: "Files in this space can't be shared." };
  }
  if (input.discoverable && !(await packageCanShare(supabase, packageId))) {
    return { ok: false, error: SHARE_NEEDS_PUBLISH };
  }
  const description = input.description?.trim() || row.description || null;
  // Bounded at the source (loop r2, P5.A.1.o; the database refuses more).
  if (description && description.length > REGISTRY_TEXT_LIMITS.description) {
    return { ok: false, error: `Keep the description to ${REGISTRY_TEXT_LIMITS.description.toLocaleString("en-US")} characters or fewer.` };
  }
  const tags = input.tags?.map((t) => t.trim()).filter(Boolean);
  if (tags && (tags.length > REGISTRY_TEXT_LIMITS.tags || tags.some((t) => t.length > REGISTRY_TEXT_LIMITS.tagLength))) {
    return { ok: false, error: `Use at most ${REGISTRY_TEXT_LIMITS.tags} tags of up to ${REGISTRY_TEXT_LIMITS.tagLength} characters each.` };
  }
  if (discoverable && row.permalink_class === "object" && !description) {
    return { ok: false, error: "Add a short description first — it's what others will find it by." };
  }

  const patch: Record<string, unknown> = {};
  if (input.discoverable !== undefined) patch["discoverable"] = input.discoverable;
  patch["description"] = description;
  if (tags) patch["tags"] = tags;
  if (input.license !== undefined) patch["license"] = input.license.trim() || null;

  const { error } = await supabase
    .from("documents")
    .update(patch)
    .eq("doc_id", docId)
    .eq("package_id", packageId);
  if (error) return { ok: false, error: "Couldn't save. Please try again." };
  logShareChange(row, discoverable, user.id, supabase);

  discoveryChanged();
  return { ok: true, permalink: discoverable ? `/d/${docId}` : undefined };
}
