/**
 * Workshop codes for try mode (C7; design §11.5, migration 0059). A code is
 * ten characters of Crockford base32 (no I, L, O, U), shown in groups
 * ("WKS-7KQ2-XM4P-9A"); typing is forgiving (case, spaces, dashes, O for 0,
 * I/L for 1). Only a keyed hash of the normalised code is stored.
 */
import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 10;

/** A new code to hand out (shown once to the operator). */
export function newWorkshopCode(): string {
  const bytes = randomBytes(LENGTH);
  let body = "";
  for (const b of bytes) body += ALPHABET[b % 32];
  return `WKS-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}`;
}

/** The code as typed, normalised; null when it can't be a code. */
export function normalizeWorkshopCode(input: string): string | null {
  let s = input.toUpperCase().replace(/[\s-]/g, "");
  if (s.length === LENGTH + 3 && s.startsWith("WKS")) s = s.slice(3); // the printed prefix, when typed
  s = s.replace(/O/g, "0").replace(/[IL]/g, "1");
  return s.length === LENGTH && [...s].every((c) => ALPHABET.includes(c)) ? s : null;
}

/** The stored form: a keyed hash, so the table alone can't be used to try codes. */
export function workshopCodeHash(normalized: string, secret: string): string {
  return createHash("sha256").update(`${secret}:workshop:${normalized}`).digest("hex");
}
