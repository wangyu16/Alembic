import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { handleStripeEvent, stripeEventFetcher, verifyStripeSignature, type TopupDeps } from "@/lib/stripe-topups";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook for credit top-ups (E5). Not configured → 503. A bad
 * signature → 400. A refusal the ledger made on purpose (amount or user
 * mismatch) → 200 and logged, since a retry can't change it; anything else,
 * including a checkout not recorded yet, → 500 so Stripe retries.
 */
export async function POST(req: NextRequest) {
  const secret = process.env["STRIPE_WEBHOOK_SECRET"];
  const key = process.env["STRIPE_SECRET_KEY"];
  const db = createServiceClient();
  if (!secret || !key || !db) return new Response("not configured", { status: 503 });

  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret)) {
    return new Response("bad signature", { status: 400 });
  }
  let eventId: unknown;
  try { eventId = (JSON.parse(raw) as { id?: unknown }).id; } catch { return new Response("bad body", { status: 400 }); }
  if (typeof eventId !== "string") return new Response("bad body", { status: 400 });

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { error } = await db.rpc(fn, args);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
  };
  const deps: TopupDeps = {
    fetchEvent: stripeEventFetcher(key),
    livemode: key.startsWith("sk_live_"),
    checkoutPaid: (a) => rpc("ledger_checkout_paid", {
      p_session: a.session, p_event: a.event, p_payment_intent: a.paymentIntent, p_usd_cents: a.usdCents, p_reference: a.reference,
    }),
    paymentReversed: (a) => rpc("ledger_payment_reversed", {
      p_payment_intent: a.paymentIntent, p_reason_event: a.reasonEvent, p_total_cents: a.totalCents, p_add_cents: a.addCents,
    }),
  };
  try {
    const out = await handleStripeEvent(eventId, deps);
    if (out.status === "rejected") console.warn("stripe webhook rejected", eventId, out.reason);
    return Response.json(out);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "22023" || code === "42501") {
      console.warn("stripe webhook refused by the ledger", eventId, (e as Error).message);
      return Response.json({ status: "rejected", reason: "refused by the ledger" });
    }
    console.error("stripe webhook failed", eventId, e);
    return new Response("retry", { status: 500 });
  }
}
