"use server";

import { redirect } from "next/navigation";
import { serverOrigin } from "@/lib/server-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createTopupCheckout } from "@/lib/stripe-topups";

/** Start a Stripe Checkout for one of the listed amounts (E5). */
export async function buyCreditAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin?next=/workspace/credit");
  const key = process.env["STRIPE_SECRET_KEY"];
  const service = createServiceClient();
  if (!key || !service) redirect("/workspace/credit?buy=off");
  const usdCents = Number(formData.get("cents"));
  const origin = await serverOrigin();
  let url: string;
  try {
    ({ url } = await createTopupCheckout(
      { userId: user.id, usdCents, successUrl: `${origin}/workspace/credit?buy=done`, cancelUrl: `${origin}/workspace/credit` },
      {
        secretKey: key,
        record: async (session, userId, cents) => {
          const { error } = await service.rpc("ledger_checkout_created", { p_session: session, p_user: userId, p_usd_cents: cents });
          if (error) throw new Error(error.message);
        },
      },
    ));
  } catch {
    redirect("/workspace/credit?buy=failed");
  }
  redirect(url);
}
