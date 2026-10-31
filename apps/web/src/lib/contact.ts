/**
 * The contact form (migration 0062): checking a submission and filing it.
 *
 * Pure apart from `node:crypto` and its injected dependencies, so validation,
 * the honeypot and the rate limits are unit-tested (`contact.test.ts`). The
 * server action (`app/contact/actions.ts`) wires in the real limits
 * (`lib/rate-limit-server.ts`) and the service-role `contact_submit`.
 */
import { createHmac } from "node:crypto";
import type { RateDecision, RpcClient } from "./rate-limit";
import { CONTACT_TOPICS, HONEYPOT_FIELD, LIMITS, type ContactTopic } from "./contact-topics";

export { CONTACT_TOPICS, HONEYPOT_FIELD, LIMITS, topicLabel, type ContactTopic } from "./contact-topics";

export interface ContactFields {
  name: string;
  email: string;
  topic: ContactTopic;
  message: string;
  page: string | null;
}

export type FieldErrors = Partial<Record<"name" | "email" | "topic" | "message", string>>;

export type Checked =
  | { kind: "ok"; value: ContactFields }
  | { kind: "invalid"; errors: FieldErrors }
  | { kind: "trap" };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const text = (v: unknown): string => (typeof v === "string" ? v.replace(CONTROL, "").trim() : "");

/** A loose email check: something@something.something, no spaces. */
export function looksLikeEmail(v: string): boolean {
  return v.length <= LIMITS.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/**
 * Where the visitor came from (`?from=`): a path on this site only, at most
 * 300 characters; anything else (another site, a script address) is dropped.
 */
export function contactPage(raw: unknown): string | null {
  const v = text(raw);
  if (!v || v.length > LIMITS.page) return null;
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\") || /\s/.test(v)) return null;
  return v;
}

/** Check a submission. A filled honeypot is a `trap`: the caller pretends it went through. */
export function checkContact(form: { get(name: string): unknown }): Checked {
  if (text(form.get(HONEYPOT_FIELD))) return { kind: "trap" };
  const name = text(form.get("name"));
  const email = text(form.get("email"));
  const topic = text(form.get("topic"));
  // Keep the visitor's line breaks in the message.
  const message = typeof form.get("message") === "string" ? (form.get("message") as string).replace(CONTROL, "").replace(/\r\n?/g, "\n").trim() : "";
  const errors: FieldErrors = {};
  if (!name) errors.name = "Please tell us your name.";
  else if (name.length > LIMITS.name) errors.name = `Please keep your name under ${LIMITS.name} characters.`;
  if (!email) errors.email = "Please give an email address so we can reply.";
  else if (!looksLikeEmail(email)) errors.email = "That email address doesn't look right.";
  if (!CONTACT_TOPICS.some((t) => t.value === topic)) errors.topic = "Please choose what your message is about.";
  if (!message) errors.message = "Please write your message.";
  else if (message.length > LIMITS.message) errors.message = `Please keep your message under ${LIMITS.message} characters (it has ${message.length}).`;
  if (Object.keys(errors).length) return { kind: "invalid", errors };
  return { kind: "ok", value: { name, email, topic: topic as ContactTopic, message, page: contactPage(form.get("page")) } };
}

/** The one-way network key the database counts under (never the address). 64 hex chars. */
export function networkHash(network: string, secret: string): string {
  return createHmac("sha256", secret).update(`contact-net|${network}`).digest("hex");
}

export type SendOutcome = "sent" | "invalid" | "limited" | "unavailable";

export interface SendDeps {
  /** Count one message against the per-network limit. */
  limitNetwork(): Promise<RateDecision>;
  /** Count one message against the per-email limit. */
  limitEmail(email: string): Promise<RateDecision>;
  /** The service-role client, or null when the deployment has none. */
  service: RpcClient | null;
  /** The signed-in person, if any. */
  userId: string | null;
  netHash: string;
}

/** Check, limit and file one submission. Never throws. */
export async function sendContact(
  form: { get(name: string): unknown },
  deps: SendDeps,
): Promise<{ outcome: SendOutcome; errors?: FieldErrors }> {
  const checked = checkContact(form);
  // An automated filler gets the same answer a person gets, and nothing is kept.
  if (checked.kind === "trap") return { outcome: "sent" };
  if (checked.kind === "invalid") return { outcome: "invalid", errors: checked.errors };
  const v = checked.value;
  try {
    const [net, mail] = [await deps.limitNetwork(), await deps.limitEmail(v.email.toLowerCase())];
    if (!net.ok || !mail.ok) return { outcome: "limited" };
    if (!deps.service) return { outcome: "unavailable" };
    const { data, error } = await deps.service.rpc("contact_submit", {
      p_name: v.name,
      p_email: v.email,
      p_user: deps.userId,
      p_topic: v.topic,
      p_message: v.message,
      p_page: v.page,
      p_net_hash: deps.netHash,
    });
    if (error) return { outcome: "unavailable" };
    if (data === "busy") return { outcome: "limited" };
    return data === "ok" ? { outcome: "sent" } : { outcome: "unavailable" };
  } catch {
    return { outcome: "unavailable" };
  }
}

export const SEND_MESSAGES: Record<Exclude<SendOutcome, "sent" | "invalid">, string> = {
  limited: "You've sent several messages in a short time. Please wait a while and try again.",
  unavailable: "We can't take messages right now. Please try again a little later.",
};
