import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * A cookie-less ANON client for public reads (RLS applies exactly as for a
 * signed-out visitor). Reading no cookies keeps a route's answer the same for
 * everyone, so it can be cached by the CDN (harvest feeds, Track A.7).
 * Returns null when Supabase isn't configured.
 */
export function createPublicClient(): SupabaseClient | null {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const anonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
