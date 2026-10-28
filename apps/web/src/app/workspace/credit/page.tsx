import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TOPUP_AMOUNTS_CENTS } from "@/lib/stripe-topups";
import { buyCreditAction } from "./actions";

export const dynamic = "force-dynamic";

const ENTRY: Record<string, string> = {
  grant: "Credit given to you",
  "top-up": "Bought",
  hold: "Set aside for a task",
  capture: "Used by a task",
  overrun: "A task went over its estimate",
  release: "Returned from a task",
  refund: "Payment refunded or disputed",
  expiry: "Expired",
  "debt-paid": "Balance owed cleared",
  "transfer-in": "Returned from a course allowance",
  "transfer-out": "Moved to a course allowance",
};

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default async function CreditPage({ searchParams }: { searchParams: Promise<{ buy?: string }> }) {
  const { buy } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin?next=/workspace/credit");

  const { data: account } = await supabase.from("ledger_accounts").select("id, debt").eq("kind", "user").eq("user_id", user.id).maybeSingle();
  const now = new Date();
  const [{ data: lots }, { data: entries }, { data: price }] = await Promise.all([
    account
      ? supabase.from("credit_lots").select("credit_kind, remaining, expires_at").eq("account_id", account.id).gt("remaining", 0)
      : Promise.resolve({ data: [] as Array<{ credit_kind: string; remaining: number; expires_at: string | null }> }),
    account
      ? supabase.from("ledger_entries").select("kind, amount, created_at").eq("account_id", account.id).order("created_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [] as Array<{ kind: string; amount: number; created_at: string }> }),
    supabase.from("credit_prices").select("usd_per_credit").lte("valid_from", now.toISOString()).order("valid_from", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const live = (lots ?? []).filter((l) => !l.expires_at || new Date(l.expires_at) > now);
  const granted = live.filter((l) => l.credit_kind === "granted").reduce((n, l) => n + Number(l.remaining), 0);
  const paid = live.filter((l) => l.credit_kind !== "granted").reduce((n, l) => n + Number(l.remaining), 0);
  const debt = Number(account?.debt ?? 0);
  const balance = granted + paid - debt;
  const soonest = live.filter((l) => l.credit_kind === "granted" && l.expires_at).map((l) => l.expires_at!).sort()[0];
  const canBuy = Boolean(process.env["STRIPE_SECRET_KEY"]) && price !== null;
  const usdPerCredit = price ? Number(price.usd_per_credit) : null;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <p className="text-sm"><Link href="/workspace">← Your courses</Link></p>
      <h1 className="mt-2 text-2xl font-semibold">AI credit</h1>
      {buy === "done" ? <p className="mt-3 rounded border border-green-700 p-2 text-sm" role="status">Thank you. Your credit appears here as soon as the payment is confirmed (usually within a minute).</p> : null}
      {buy === "failed" ? <p className="mt-3 text-sm text-red-700" role="alert">The payment page couldn&apos;t be opened. Please try again.</p> : null}
      <p className="mt-4 text-4xl font-semibold" data-testid="balance">{fmt(balance)}</p>
      <p className="text-sm text-gray-600">
        credits available{granted > 0 ? ` · ${fmt(granted)} given to you` : ""}{paid > 0 ? ` · ${fmt(paid)} bought` : ""}
        {soonest ? ` · given credit expires from ${new Date(soonest).toLocaleDateString()}` : ""}
      </p>
      {debt > 0 ? (
        <p className="mt-3 rounded border border-amber-600 p-2 text-sm">
          You owe {fmt(debt)} credits (a refunded payment, or a task that cost more than set aside). New AI tasks wait until it is cleared; buying credit clears it first.
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-medium">Buy credit</h2>
        {canBuy ? (
          <form action={buyCreditAction} className="mt-2 flex flex-wrap gap-2">
            {TOPUP_AMOUNTS_CENTS.map((c) => (
              <button key={c} type="submit" name="cents" value={c} className="rounded border px-3 py-1.5">
                ${c / 100}{usdPerCredit ? ` · about ${fmt(c / 100 / usdPerCredit)} credits` : ""}
              </button>
            ))}
          </form>
        ) : (
          <p className="mt-2 text-sm text-gray-600">Buying credit isn&apos;t available yet. Credit given by the Alembic team appears here.</p>
        )}
        <p className="mt-2 text-xs text-gray-600">Payments go through Stripe. The price is fixed when the payment page opens. Bought credit doesn&apos;t expire.</p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Recent activity</h2>
        {(entries ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">Nothing yet.</p>
        ) : (
          <ul className="mt-2 divide-y rounded border text-sm">
            {(entries ?? []).map((e, i) => (
              <li key={i} className="flex justify-between p-2">
                <span>{ENTRY[e.kind] ?? e.kind}</span>
                <span className="text-gray-600">{fmt(Number(e.amount))} · {new Date(e.created_at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
