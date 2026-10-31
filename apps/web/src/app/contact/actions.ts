"use server";

import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, checkSubjectRateLimit } from "@/lib/rate-limit-server";
import { clientIp, rateSecret } from "@/lib/rate-limit";
import { SEND_MESSAGES, networkHash, sendContact, type FieldErrors } from "@/lib/contact";

export interface ContactState {
  sent?: boolean;
  error?: string;
  errors?: FieldErrors;
  /** What the visitor typed, so a refused form keeps it. */
  values?: { name: string; email: string; topic: string; message: string };
}

/**
 * The contact form (migration 0062). Open to anyone; rate-limited per network
 * and per email; filed through the service-role `contact_submit`. A filled
 * honeypot gets the normal confirmation and nothing is kept.
 */
export async function sendContactAction(_prev: ContactState, formData: FormData): Promise<ContactState> {
  const h = await headers();
  let userId: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    userId = (await supabase.auth.getUser()).data.user?.id ?? null;
  } catch {
    // Not configured or no session: an anonymous message.
  }
  const { outcome, errors } = await sendContact(formData, {
    limitNetwork: () => checkRateLimit("contact", h),
    limitEmail: (email) => checkSubjectRateLimit("contactEmail", `email:${email}`),
    service: createServiceClient(),
    userId,
    netHash: networkHash(clientIp(h), rateSecret()),
  });
  if (outcome === "sent") return { sent: true };
  const str = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v.slice(0, 5000) : "";
  };
  const values = { name: str("name"), email: str("email"), topic: str("topic"), message: str("message") };
  if (outcome === "invalid") return { errors, values };
  return { error: SEND_MESSAGES[outcome], values };
}
