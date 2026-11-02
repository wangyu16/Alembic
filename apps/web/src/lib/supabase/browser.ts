"use client";
import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null = null;

/** The signed-in browser's Supabase client (one per page). */
export function browserSupabase() {
  client ??= createBrowserClient(process.env["NEXT_PUBLIC_SUPABASE_URL"]!, process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!);
  return client;
}
