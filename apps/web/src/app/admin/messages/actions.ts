"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { contactView } from "@/lib/contact-digest";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Handled (with an optional note), Spam, or back to open. Operator only (requireAdmin, and contact_mark checks again). */
export async function markContactAction(formData: FormData): Promise<void> {
  const { userId, service } = await requireAdmin();
  const view = contactView(formData.get("view"));
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (service && UUID.test(id) && ["handled", "spam", "open"].includes(status)) {
    const note = String(formData.get("note") ?? "").slice(0, 1000) || null;
    const { error } = await service.rpc("contact_mark", { p_actor: userId, p_id: id, p_status: status, p_note: note });
    if (error) console.error("admin/messages:", error.message);
  }
  revalidatePath("/admin/messages");
  redirect(`/admin/messages?view=${view}`);
}
