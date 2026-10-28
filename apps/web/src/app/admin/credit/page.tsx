import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { addToCohortAction, createCohortAction, endGrantAction, grantCohortAction, grantUserAction, setPriceAction } from "./actions";

export const dynamic = "force-dynamic";

const input = "rounded border px-2 py-1";
const btn = "rounded bg-black px-3 py-1 text-white";

export default async function AdminCreditPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const { service } = await requireAdmin();
  if (!service) return <main className="p-6">The service key isn&apos;t configured.</main>;
  const [{ data: price }, { data: cohorts }, { data: grants }, { data: problems }] = await Promise.all([
    service.from("credit_prices").select("usd_per_credit, valid_from").order("valid_from", { ascending: false }).limit(1).maybeSingle(),
    service.from("cohorts").select("id, name, created_at").order("created_at", { ascending: false }),
    service.from("credit_grants").select("id, user_id, cohort_id, amount, expires_at, ended_at, note, created_at").is("ended_at", null).order("created_at", { ascending: false }).limit(50),
    service.from("stripe_problems").select("event_id, reason, at").order("at", { ascending: false }).limit(20),
  ]);
  const cohortName = new Map((cohorts ?? []).map((c) => [c.id as string, c.name as string]));

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <p className="text-sm"><Link href="/admin">← Admin</Link></p>
      <h1 className="text-2xl font-semibold">AI credit</h1>
      {msg ? <p className="rounded border p-2 text-sm" role="status">{msg}</p> : null}

      <section>
        <h2 className="text-lg font-medium">Give credit to a person</h2>
        <form action={grantUserAction} className="mt-2 flex flex-wrap items-end gap-2 text-sm">
          <input name="login" required placeholder="GitHub name" className={input} />
          <input name="amount" required type="number" min="0.01" step="0.01" placeholder="credits" className={input} />
          <label className="flex flex-col">expires (optional)<input name="expires" type="date" className={input} /></label>
          <input name="note" placeholder="note (optional)" className={input} />
          <button className={btn}>Give</button>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-medium">Groups (e.g. a workshop)</h2>
        <form action={createCohortAction} className="mt-2 flex gap-2 text-sm">
          <input name="name" required placeholder="group name" className={input} />
          <button className={btn}>Create group</button>
        </form>
        {(cohorts ?? []).length > 0 ? (
          <div className="mt-3 space-y-3">
            {(cohorts ?? []).map((c) => (
              <div key={c.id as string} className="rounded border p-3 text-sm">
                <p className="font-medium">{c.name as string}</p>
                <form action={addToCohortAction} className="mt-2 flex gap-2">
                  <input type="hidden" name="cohort" value={c.id as string} />
                  <input name="login" required placeholder="GitHub name" className={input} />
                  <button className="underline">Add member</button>
                </form>
                <form action={grantCohortAction} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="cohort" value={c.id as string} />
                  <input name="amount" required type="number" min="0.01" step="0.01" placeholder="credits each" className={input} />
                  <label className="flex flex-col">expires (optional)<input name="expires" type="date" className={input} /></label>
                  <input name="note" placeholder="note (optional)" className={input} />
                  <button className="underline">Give each member (now and later joiners)</button>
                </form>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="text-lg font-medium">Running grants</h2>
        {(grants ?? []).length === 0 ? <p className="mt-2 text-sm text-gray-600">None.</p> : (
          <ul className="mt-2 divide-y rounded border text-sm">
            {(grants ?? []).map((g) => (
              <li key={g.id as string} className="flex items-center justify-between p-2">
                <span>
                  {Number(g.amount)} credits · {g.cohort_id ? `group “${cohortName.get(g.cohort_id as string) ?? "?"}”` : "one person"}
                  {g.expires_at ? ` · until ${new Date(g.expires_at as string).toLocaleDateString()}` : ""}
                  {g.note ? ` · ${g.note as string}` : ""}
                </span>
                <form action={endGrantAction}>
                  <input type="hidden" name="grant" value={g.id as string} />
                  <button className="text-red-700 underline">End</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium">Price</h2>
        <p className="mt-1 text-sm">{price ? `$${Number(price.usd_per_credit)} per credit since ${new Date(price.valid_from as string).toLocaleDateString()}` : "No price set: buying credit is off."}</p>
        <form action={setPriceAction} className="mt-2 flex gap-2 text-sm">
          <input name="usd" required type="number" min="0.0001" step="0.0001" placeholder="US$ per credit" className={input} />
          <button className={btn}>Set new price</button>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-medium">Payments that need a look</h2>
        {(problems ?? []).length === 0 ? <p className="mt-2 text-sm text-gray-600">None.</p> : (
          <ul className="mt-2 divide-y rounded border text-sm">
            {(problems ?? []).map((p) => (
              <li key={p.event_id as string} className="p-2">{p.event_id as string} · {p.reason as string} · {new Date(p.at as string).toLocaleString()}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
