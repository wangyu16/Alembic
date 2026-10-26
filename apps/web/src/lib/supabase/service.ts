import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * A service-role Supabase client (bypasses RLS). Use ONLY behind an admin gate
 * (`requireAdmin`) for cross-user operations research/admin require — reading the
 * append-only `research_events` (no user select policy by design), the
 * operator-only `portal_reports`, and toggling another user's profile flags.
 * Also, narrowly and never for an educator workflow: the public-file reads of
 * `/d` and Discover's Elements list, a listed course's chapter slugs for its
 * course page (`cachedListedCourseChapters`), the report rate-limit counters and filing reports
 * (`file_portal_report`, migration 0024),
 * anonymous discovery events (data-handling-review.md, "Access model"), and the
 * package columns discovery trusts — storage, repos, archived_at, the a11y
 * record — always scoped to the signed-in owner (lib/package-trust-writes.ts,
 * migration 0025, security loop r1 M2).
 * Returns null when SUPABASE_SECRET_KEY isn't configured.
 */
export function createServiceClient(): SupabaseClient | null {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["SUPABASE_SECRET_KEY"];
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
