import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * A service-role Supabase client (bypasses RLS). Use ONLY behind an admin gate
 * (`requireAdmin`) for cross-user operations research/admin require — reading the
 * append-only `research_events` (no user select policy by design), the
 * operator-only `portal_reports`, and toggling another user's profile flags.
 * Returns null when SUPABASE_SECRET_KEY isn't configured.
 */
export function createServiceClient(): SupabaseClient | null {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["SUPABASE_SECRET_KEY"];
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
