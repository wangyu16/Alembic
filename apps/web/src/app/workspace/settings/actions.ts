"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CHOICES = ["week", "day", "off"] as const;

export async function setEmailEveryAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  const every = String(formData.get("every") ?? "");
  if (!(CHOICES as readonly string[]).includes(every)) return;
  const { error } = await supabase.rpc("set_email_every", { p_every: every });
  if (error) throw new Error("Couldn't save the setting. Please try again.");
  revalidatePath("/workspace/settings");
}
