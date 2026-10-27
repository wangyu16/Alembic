import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { handleStripeEvent, isLiveKey, stripeEventFetcher, verifyStripeSignature, type TopupDeps } from "@/lib/stripe-topups";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook for credit top-ups (E5). Not configured → 503. A bad
 * signature → 400. A refusal the ledger made on purpose (amount or user
 * mismatch) → 200 and recorded in `stripe_problems`, since a retry can't
 * change it; anything else,
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
    livemode: isLiveKey(key),
    checkoutPaid: (a) => rpc("ledger_checkout_paid", {
      p_session: a.session, p_event: a.event, p_payment_intent: a.paymentIntent, p_usd_cents: a.usdCents, p_reference: a.reference,
    }),
    paymentRefunded: (a) => rpc("ledger_payment_refunded", { p_payment_intent: a.paymentIntent, p_total_cents: a.totalCents }),
    paymentDispute: (a) => rpc("ledger_payment_dispute", {
      p_payment_intent: a.paymentIntent, p_dispute: a.dispute, p_amount_cents: a.amountCents, p_withdrawn: a.withdrawn,
    }),
  };
  // Kept for the operator: a paid event Alembic could not match never vanishes into a log.
  const problem = (reason: string) => rpc("ledger_stripe_problem", { p_event: eventId, p_reason: reason });
  try {
    const out = await handleStripeEvent(eventId, deps);
    if (out.status === "rejected") {
      console.warn("stripe webhook rejected", eventId, out.reason);
      if (out.reason !== "bad event id" && out.reason !== "event not found at Stripe") await problem(out.reason);
    }
    return Response.json(out);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "22023" || code === "42501") {
      console.warn("stripe webhook refused by the ledger", eventId, (e as Error).message);
      await problem((e as Error).message).catch(() => undefined);
      return Response.json({ status: "rejected", reason: "refused by the ledger" });
    }
    console.error("stripe webhook failed", eventId, e);
    return new Response("retry", { status: 500 });
  }
}
