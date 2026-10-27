import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createTopupCheckout, handleStripeEvent, isLiveKey, verifyStripeSignature, type StripeEvent, type TopupDeps } from "./stripe-topups";

const SECRET = "whsec_test";
const sign = (body: string, t: number, secret = SECRET) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

describe("verifyStripeSignature", () => {
  const body = '{"id":"evt_1"}';
  const now = 1_800_000_000;
  it("accepts a fresh, correct signature (also among several v1 values)", () => {
    expect(verifyStripeSignature(body, sign(body, now), SECRET, now)).toBe(true);
    expect(verifyStripeSignature(body, `v1=${"0".repeat(64)},${sign(body, now)}`, SECRET, now)).toBe(true);
  });
  it("refuses a wrong secret, a changed body, an old timestamp, a missing header, v0 only", () => {
    expect(verifyStripeSignature(body, sign(body, now, "other"), SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body + " ", sign(body, now), SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, now - 301), SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, null, SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, now).replace("v1=", "v0="), SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, now), "", now)).toBe(false);
  });
});

function deps(events: StripeEvent[], livemode = false) {
  const d = {
    fetchEvent: vi.fn(async (id: string) => events.find((e) => e.id === id) ?? null),
    checkoutPaid: vi.fn(async () => undefined),
    paymentRefunded: vi.fn(async () => undefined),
    paymentDispute: vi.fn(async () => undefined),
    livemode,
  } satisfies TopupDeps;
  return d;
}
const session = (over: Record<string, unknown> = {}): StripeEvent => ({
  id: "evt_s", type: "checkout.session.completed", created: 100, livemode: false,
  data: { object: { id: "cs_1", mode: "payment", payment_status: "paid", amount_total: 1000, currency: "usd", payment_intent: "pi_1", client_reference_id: "u1", metadata: { alembic: "topup" }, ...over } },
});

describe("handleStripeEvent", () => {
  it("credits a paid checkout using Stripe's own copy of the event", async () => {
    const d = deps([session()]);
    expect(await handleStripeEvent("evt_s", d)).toEqual({ status: "credited", event: "evt_s" });
    expect(d.checkoutPaid).toHaveBeenCalledWith({ session: "cs_1", event: "evt_s", paymentIntent: "pi_1", usdCents: 1000, reference: "u1" });
  });
  it("ignores unpaid sessions, subscriptions and unrelated events; refuses unknown events and the other mode", async () => {
    expect((await handleStripeEvent("evt_s", deps([session({ payment_status: "unpaid" })]))).status).toBe("ignored");
    expect((await handleStripeEvent("evt_s", deps([session({ mode: "subscription" })]))).status).toBe("ignored");
    expect((await handleStripeEvent("evt_s", deps([{ ...session(), type: "invoice.paid" }]))).status).toBe("ignored");
    expect((await handleStripeEvent("evt_x", deps([session()]))).status).toBe("rejected");
    expect((await handleStripeEvent("evt_s", deps([session()], true))).status).toBe("rejected");
    expect((await handleStripeEvent("../evt", deps([session()]))).status).toBe("rejected");
    expect((await handleStripeEvent("evt_s", deps([session({ currency: "eur" })]))).status).toBe("rejected");
    expect((await handleStripeEvent("evt_s", deps([session({ metadata: {} })]))).status).toBe("ignored"); // not an Alembic top-up
  });
  it("passes refunds as Stripe's running total, and disputes only when money moves", async () => {
    const d = deps([
      { id: "evt_r", type: "charge.refunded", created: 101, data: { object: { payment_intent: "pi_1", amount_refunded: 400, currency: "usd" } } },
      { id: "evt_w", type: "charge.dispute.funds_withdrawn", created: 102, data: { object: { id: "dp_1", payment_intent: { id: "pi_1" }, amount: 600, currency: "usd" } } },
      { id: "evt_b", type: "charge.dispute.funds_reinstated", created: 103, data: { object: { id: "dp_1", payment_intent: "pi_1", amount: 600, currency: "usd" } } },
      { id: "evt_c", type: "charge.dispute.created", created: 104, data: { object: { id: "dp_2", payment_intent: "pi_1", amount: 600 } } },
    ]);
    expect((await handleStripeEvent("evt_r", d)).status).toBe("reversed");
    expect((await handleStripeEvent("evt_w", d)).status).toBe("reversed");
    expect((await handleStripeEvent("evt_b", d)).status).toBe("restored");
    expect((await handleStripeEvent("evt_c", d)).status).toBe("ignored");
    expect(d.paymentRefunded).toHaveBeenCalledWith({ paymentIntent: "pi_1", totalCents: 400, asOf: 101 });
    expect(d.paymentDispute).toHaveBeenNthCalledWith(1, { paymentIntent: "pi_1", dispute: "dp_1", amountCents: 600, withdrawn: true, asOf: 102 });
    // A refund in another currency is not counted against USD credit.
    const e = deps([{ id: "evt_j", type: "charge.refunded", created: 105, data: { object: { payment_intent: "pi_1", amount_refunded: 400, currency: "jpy" } } }]);
    expect((await handleStripeEvent("evt_j", e)).status).toBe("rejected");
    expect(d.paymentDispute).toHaveBeenNthCalledWith(2, { paymentIntent: "pi_1", dispute: "dp_1", amountCents: 600, withdrawn: false, asOf: 103 });
  });
  it("knows live secret and restricted keys", () => {
    expect(isLiveKey("sk_live_x")).toBe(true);
    expect(isLiveKey("rk_live_x")).toBe(true);
    expect(isLiveKey("sk_test_x")).toBe(false);
  });
});

describe("createTopupCheckout", () => {
  it("creates a tagged session for a listed amount and records it before returning the URL", async () => {
    const order: string[] = [];
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      order.push("stripe");
      const f = new URLSearchParams(String(init?.body));
      expect(f.get("client_reference_id")).toBe("u1");
      expect(f.get("metadata[alembic]")).toBe("topup");
      expect(f.get("line_items[0][price_data][unit_amount]")).toBe("1000");
      expect(f.get("adaptive_pricing[enabled]")).toBe("false");
      return Response.json({ id: "cs_9", url: "https://checkout.stripe.com/x" });
    }) as unknown as typeof fetch;
    const record = vi.fn(async () => { order.push("record"); });
    const r = await createTopupCheckout({ userId: "u1", usdCents: 1000, successUrl: "https://a/ok", cancelUrl: "https://a/no" }, { secretKey: "sk_test_x", record, fetchImpl });
    expect(r.url).toBe("https://checkout.stripe.com/x");
    expect(record).toHaveBeenCalledWith("cs_9", "u1", 1000);
    expect(order).toEqual(["stripe", "record"]);
  });
  it("refuses an amount not on the list without calling Stripe", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(createTopupCheckout({ userId: "u1", usdCents: 1, successUrl: "s", cancelUrl: "c" }, { secretKey: "k", record: vi.fn(), fetchImpl })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
