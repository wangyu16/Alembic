/** The one way Alembic sends email. Resend in production; a memory fake in tests. */

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Same key → sent at most once (Resend keeps keys for 24 h). */
  idempotencyKey: string;
}

export interface Mailer {
  send(email: Email): Promise<{ id: string }>;
}

export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(email: Email): Promise<{ id: string }> {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": email.idempotencyKey,
      },
      body: JSON.stringify({ from: this.from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Email service returned ${res.status}`);
    const body = (await res.json()) as { id?: unknown };
    if (typeof body.id !== "string") throw new Error("Email service returned no id");
    return { id: body.id };
  }
}

export class MemoryMailer implements Mailer {
  readonly sent: Email[] = [];
  async send(email: Email) {
    if (!this.sent.some((e) => e.idempotencyKey === email.idempotencyKey)) this.sent.push(email);
    return { id: `mem_${this.sent.length}` };
  }
}

/** Escape text for HTML bodies. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
