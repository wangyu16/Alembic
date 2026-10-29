"use client";

import { useActionState } from "react";
import { CONTACT_TOPICS, HONEYPOT_FIELD, LIMITS } from "@/lib/contact-topics";
import { sendContactAction, type ContactState } from "./actions";

export function ContactForm({ page }: { page: string | null }) {
  const [state, action, pending] = useActionState<ContactState, FormData>(sendContactAction, {});

  if (state.sent) {
    return (
      <div className="panel mt-8 p-5" role="status" data-testid="contact-sent">
        <p className="font-medium text-ink">Thank you, your message is on its way.</p>
        <p className="mt-1 text-sm text-muted">We read every message and will reply to the email address you gave.</p>
      </div>
    );
  }

  const v = state.values;
  const err = state.errors ?? {};
  const hint = (id: string, text?: string) =>
    text ? <p id={id} className="mt-1 text-sm text-red-700">{text}</p> : null;

  return (
    <form action={action} className="mt-8 flex flex-col gap-5">
      {page ? <input type="hidden" name="page" value={page} /> : null}
      {/* Hidden from people (and from screen readers); automated form fillers fill it. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>
          Leave this empty
          <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm text-ink">
        Your name
        <input name="name" required maxLength={LIMITS.name} autoComplete="name" defaultValue={v?.name}
          className="field" aria-invalid={err.name ? true : undefined} aria-describedby={err.name ? "err-name" : undefined} />
        {hint("err-name", err.name)}
      </label>

      <label className="flex flex-col gap-1 text-sm text-ink">
        Your email
        <input name="email" type="email" required maxLength={LIMITS.email} autoComplete="email" defaultValue={v?.email}
          className="field" aria-invalid={err.email ? true : undefined} aria-describedby={err.email ? "err-email" : undefined} />
        {hint("err-email", err.email)}
      </label>

      <label className="flex flex-col gap-1 text-sm text-ink">
        What is it about?
        <select name="topic" required defaultValue={v?.topic ?? ""} className="field"
          aria-invalid={err.topic ? true : undefined} aria-describedby={err.topic ? "err-topic" : undefined}>
          <option value="" disabled>Choose one</option>
          {CONTACT_TOPICS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        {hint("err-topic", err.topic)}
      </label>

      <label className="flex flex-col gap-1 text-sm text-ink">
        Your message
        <textarea name="message" required maxLength={LIMITS.message} rows={7} defaultValue={v?.message}
          className="field" aria-invalid={err.message ? true : undefined} aria-describedby={err.message ? "err-message" : undefined} />
        {hint("err-message", err.message)}
      </label>

      <p className="text-xs text-muted" data-testid="contact-privacy">
        We keep your name, email, message and the page you came from, so we can reply. Only the people who run Alembic
        read them. An automated assistant reads each message first to sort it and write a one-line summary for us; it
        doesn&apos;t reply or act on what you write. We don&apos;t keep your network address, only a scrambled code that
        helps us stop floods of messages.
      </p>

      {state.error ? <p className="text-sm text-red-700" role="alert">{state.error}</p> : null}

      <div>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Sending…" : "Send message"}
        </button>
      </div>
    </form>
  );
}
