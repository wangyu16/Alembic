/**
 * Stripe top-ups (E5; ledger-v3 §3.2, L-12).
 *
 * The webhook trusts nothing in the posted body beyond the event id:
 * 1. the `Stripe-Signature` header must verify (HMAC-SHA256, 5-minute window);
 * 2. the event is then re-fetched from Stripe by id, and only that copy is used;
 * 3. the user comes from the checkout row Alembic wrote when it created the
 *    session (`ledger_checkout_paid` checks `client_reference_id` against it).
 * Money moves only inside the SQL functions of migration 0044.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_TOLERANCE_SECONDS = 300;
/** Metadata tag on every Checkout Session Alembic creates for a top-up. */
export const TOPUP_TAG = "topup";
/** The amounts a person can buy, in US cents. */
export const TOPUP_AMOUNTS_CENTS = [500, 1000, 2000, 5000] as const;

/** Verify a `Stripe-Signature` header (`t=…,v1=…[,v1=…]`) over the raw body. */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!header || !secret) return false;
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t" && /^\d+$/.test(v)) t = Number(v);
    else if (k === "v1" && /^[0-9a-f]{64}$/.test(v)) v1.push(v);
  }
  if (t === null || v1.length === 0) return false;
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"), "hex");
  return v1.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** The fields of a Stripe event this module reads. */
export interface StripeEvent {
  id: string;
  type: string;
  livemode?: boolean;
  data: { object: Record<string, unknown> };
}

/** Everything that leaves the process: Stripe's API and the ledger RPCs. */
export interface TopupDeps {
  fetchEvent(id: string): Promise<StripeEvent | null>;
  checkoutPaid(a: { session: string; event: string; paymentIntent: string | null; usdCents: number; reference: string | null }): Promise<void>;
  paymentReversed(a: { paymentIntent: string; reasonEvent: string; totalCents: number | null; addCents: number | null }): Promise<void>;
  /** Live or test mode this deployment accepts. */
  livemode: boolean;
}

export type TopupOutcome =
  | { status: "credited" | "reversed" | "ignored"; event: string }
  | { status: "rejected"; reason: string };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
/** A charge's or dispute's payment intent may be an id or an expanded object. */
const intentOf = (v: unknown): string | null =>
  str(v) ?? (v && typeof v === "object" ? str((v as { id?: unknown }).id) : null);

/** Handle one verified webhook delivery, given only the event id from its body. */
export async function handleStripeEvent(eventId: string, deps: TopupDeps): Promise<TopupOutcome> {
  if (!/^evt_[A-Za-z0-9]+$/.test(eventId)) return { status: "rejected", reason: "bad event id" };
  const ev = await deps.fetchEvent(eventId);
  if (!ev || ev.id !== eventId) return { status: "rejected", reason: "event not found at Stripe" };
  if (Boolean(ev.livemode) !== deps.livemode) return { status: "rejected", reason: "wrong mode" };
  const o = ev.data.object;

  switch (ev.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const meta = o["metadata"] as Record<string, unknown> | null | undefined;
      if (meta?.["alembic"] !== TOPUP_TAG) return { status: "ignored", event: ev.id };  // not ours
      if (o["mode"] !== "payment" || o["payment_status"] !== "paid") return { status: "ignored", event: ev.id };
      const session = str(o["id"]);
      const usdCents = int(o["amount_total"]);
      if (!session || usdCents === null || String(o["currency"]).toLowerCase() !== "usd") {
        return { status: "rejected", reason: "malformed checkout" };
      }
      await deps.checkoutPaid({
        session,
        event: ev.id,
        paymentIntent: intentOf(o["payment_intent"]),
        usdCents,
        reference: str(o["client_reference_id"]),
      });
      return { status: "credited", event: ev.id };
    }
    case "charge.refunded": {
      const pi = intentOf(o["payment_intent"]);
      const total = int(o["amount_refunded"]);
      if (!pi || total === null) return { status: "rejected", reason: "malformed refund" };
      await deps.paymentReversed({ paymentIntent: pi, reasonEvent: ev.id, totalCents: total, addCents: null });
      return { status: "reversed", event: ev.id };
    }
    case "charge.dispute.created": {
      const pi = intentOf(o["payment_intent"]);
      const amount = int(o["amount"]);
      if (!pi || amount === null) return { status: "rejected", reason: "malformed dispute" };
      await deps.paymentReversed({ paymentIntent: pi, reasonEvent: ev.id, totalCents: null, addCents: amount });
      return { status: "reversed", event: ev.id };
    }
    default:
      return { status: "ignored", event: ev.id };
  }
}

/** Re-fetch an event from Stripe's API (no SDK; one GET). */
export function stripeEventFetcher(secretKey: string, fetchImpl: typeof fetch = fetch) {
  return async (id: string): Promise<StripeEvent | null> => {
    const res = await fetchImpl(`https://api.stripe.com/v1/events/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${secretKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Stripe returned ${res.status}`);
    return (await res.json()) as StripeEvent;
  };
}

/**
 * Create a Checkout Session for a top-up and record it before handing back the
 * URL. The webhook can only credit a session recorded here.
 */
export async function createTopupCheckout(
  a: { userId: string; usdCents: number; successUrl: string; cancelUrl: string },
  deps: {
    secretKey: string;
    record(session: string, userId: string, usdCents: number): Promise<void>;
    fetchImpl?: typeof fetch;
  },
): Promise<{ url: string }> {
  if (!(TOPUP_AMOUNTS_CENTS as readonly number[]).includes(a.usdCents)) throw new Error("Choose one of the listed amounts");
  const form = new URLSearchParams({
    mode: "payment",
    client_reference_id: a.userId,
    "metadata[alembic]": TOPUP_TAG,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(a.usdCents),
    "line_items[0][price_data][product_data][name]": "Alembic AI credit",
    success_url: a.successUrl,
    cancel_url: a.cancelUrl,
  });
  const res = await (deps.fetchImpl ?? fetch)("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${deps.secretKey}`, "content-type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Stripe returned ${res.status}`);
  const s = (await res.json()) as { id?: unknown; url?: unknown };
  if (typeof s.id !== "string" || typeof s.url !== "string") throw new Error("Stripe returned no session");
  await deps.record(s.id, a.userId, a.usdCents);
  return { url: s.url };
}
