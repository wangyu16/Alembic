import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requestOrigin } from "@/lib/request-origin";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  // The public origin, not request.url (a self-hosted server sees its bind address there).
  return NextResponse.redirect(new URL("/", requestOrigin(request)), { status: 302 });
}
