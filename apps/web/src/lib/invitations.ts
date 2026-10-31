/**
 * Co-author invitations (E1). The link carries a 32-byte random token; the
 * database keeps only its SHA-256 (migration 0036). The owner sees the link
 * once, to share; if the invited GitHub account already uses Alembic, it is
 * emailed too.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { ResendMailer, type Mailer } from "@alembic/notify";

export function newInvitationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: invitationHash(token) };
}

export function invitationHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Tokens are exactly what newInvitationToken makes; anything else is refused before the database. */
export function isInvitationToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** GitHub user names: 1–39 characters, letters, digits, single hyphens, not at the ends. */
export function isGithubLogin(login: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(login);
}

/** The web app's mailer, or null when email isn't configured. */
export function webMailer(): Mailer | null {
  const key = process.env["RESEND_API_KEY"]?.trim();
  const from = process.env["EMAIL_FROM"]?.trim();
  return key && from ? new ResendMailer(key, from) : null;
}
