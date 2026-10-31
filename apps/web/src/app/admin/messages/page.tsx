import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { LocalTime } from "@/lib/local-time";
import { topicLabel } from "@/lib/contact-topics";
import { CONTACT_VIEWS, contactView, groupDigest, replyHref, type ContactRow } from "@/lib/contact-digest";
import { markContactAction } from "./actions";

export const dynamic = "force-dynamic";

const VIEW_LABEL = { open: "Open", handled: "Handled", spam: "Spam" } as const;
const URGENCY: Record<string, { label: string; cls: string }> = {
  high: { label: "Urgent", cls: "border-danger text-danger" },
  normal: { label: "Normal", cls: "border-edge text-muted" },
  low: { label: "Low", cls: "border-edge text-faint" },
};

export default async function AdminMessagesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { userId, service } = await requireAdmin();
  const view = contactView((await searchParams).view);
  if (!service) return <main className="p-6">The service key isn&apos;t configured.</main>;
  const { data, error } = await service.rpc("contact_list", { p_actor: userId, p_view: view });
  const rows = ((data ?? []) as ContactRow[]);
  const groups = groupDigest(rows);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <p className="text-sm"><Link href="/admin">← Admin</Link></p>
      <header>
        <h1 className="font-serif text-3xl tracking-tight text-ink">Messages</h1>
        <p className="mt-1 text-muted">From the contact form, sorted automatically. Reply by email, then mark them handled.</p>
      </header>

      <nav className="flex gap-2 text-sm" aria-label="Which messages">
        {CONTACT_VIEWS.map((v) => (
          <Link key={v} href={`/admin/messages?view=${v}`} aria-current={v === view ? "page" : undefined}
            className={`btn btn-sm ${v === view ? "btn-primary" : "btn-ghost"}`}>
            {VIEW_LABEL[v]}
          </Link>
        ))}
      </nav>

      {error ? <p className="rounded border p-2 text-sm" role="alert">The messages couldn&apos;t be loaded.</p> : null}

      {groups.length > 0 ? (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="contact-counts">
          {groups.map((g) => (
            <a key={g.key} href={`#${g.key}`} className="panel p-3">
              <div className="text-2xl font-semibold text-ink">{g.rows.length}</div>
              <div className="text-xs text-muted">{g.label}</div>
            </a>
          ))}
        </section>
      ) : !error ? (
        <p className="text-sm text-muted">No {VIEW_LABEL[view].toLowerCase()} messages.</p>
      ) : null}

      {groups.map((g) => (
        <section key={g.key} id={g.key} className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-ink">{g.label} <span className="text-muted">({g.rows.length})</span></h2>
          <ul className="flex flex-col gap-3">
            {g.rows.map((m) => <MessageCard key={m.id} m={m} view={view} />)}
          </ul>
        </section>
      ))}
    </main>
  );
}

function MessageCard({ m, view }: { m: ContactRow; view: string }) {
  const urgency = m.urgency ? URGENCY[m.urgency] : undefined;
  return (
    <li className="panel p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-ink">{m.summary ?? <span className="text-muted">No summary yet</span>}</p>
        {urgency ? <span className={`rounded border px-1.5 text-xs ${urgency.cls}`}>{urgency.label}</span> : null}
      </div>
      <p className="mt-1 text-muted">
        {topicLabel(m.topic)} · {m.name}{m.signed_in ? " (signed in)" : ""} ·{" "}
        <a href={replyHref(m.email, topicLabel(m.topic))} className="underline">{m.email}</a> · <LocalTime at={m.created_at} />
        {m.page ? <> · from {m.page}</> : null}
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-muted">Their message</summary>
        <p className="mt-2 whitespace-pre-wrap break-words text-ink">{m.message}</p>
      </details>
      {m.status === "handled" ? (
        <p className="mt-2 text-muted">
          Handled{m.handled_at ? <> <LocalTime at={m.handled_at} /></> : null}{m.handled_note ? <>: {m.handled_note}</> : null}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        {m.status === "new" || m.status === "sorted" ? (
          <>
            <form action={markContactAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={m.id} />
              <input type="hidden" name="view" value={view} />
              <input type="hidden" name="status" value="handled" />
              <input name="note" maxLength={1000} placeholder="Note (optional)" aria-label="Note (optional)" className="field py-1 text-sm" />
              <button className="btn btn-primary btn-sm">Handled</button>
            </form>
            <form action={markContactAction}>
              <input type="hidden" name="id" value={m.id} />
              <input type="hidden" name="view" value={view} />
              <input type="hidden" name="status" value="spam" />
              <button className="btn btn-ghost btn-sm">Spam</button>
            </form>
          </>
        ) : (
          <form action={markContactAction}>
            <input type="hidden" name="id" value={m.id} />
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="status" value="open" />
            <button className="btn btn-ghost btn-sm">Back to open</button>
          </form>
        )}
      </div>
    </li>
  );
}
