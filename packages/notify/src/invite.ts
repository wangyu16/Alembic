/** The invitation email (design §17, migration 0036 invitations). */
import { esc, type Email } from "./mailer";

export interface InviteInput {
  invitationId: string;
  to: string;
  inviterName: string;
  courseTitle: string;
  role: "co-author";
  /** The accept page, carrying the one-time token. */
  acceptUrl: string;
  expiresAt: Date;
}

export function buildInvitation(i: InviteInput): Email {
  const until = i.expiresAt.toISOString().slice(0, 10);
  const subject = `${i.inviterName} invited you to work on “${i.courseTitle}”`;
  const lines = [
    `${i.inviterName} invited you to be a co-author of “${i.courseTitle}” on Alembic.`,
    "",
    `Accept: ${i.acceptUrl}`,
    "",
    `You sign in with your GitHub account. The invitation works until ${until}.`,
    "If you weren't expecting this, you can ignore it.",
  ];
  const html = [
    `<p>${esc(i.inviterName)} invited you to be a co-author of “${esc(i.courseTitle)}” on Alembic.</p>`,
    `<p><a href="${esc(i.acceptUrl)}">Accept the invitation</a></p>`,
    `<p>You sign in with your GitHub account. The invitation works until ${esc(until)}.</p>`,
    `<p style="color:#666;font-size:12px">If you weren't expecting this, you can ignore it.</p>`,
  ];
  return { to: i.to, subject, text: lines.join("\n"), html: html.join("\n"), idempotencyKey: `invite:${i.invitationId}` };
}
