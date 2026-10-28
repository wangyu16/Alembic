/**
 * Whose GitHub App installation is this? (Security fix, 2026-10-27.)
 *
 * The post-install redirect carries `installation_id` in the URL, which
 * anyone can type. Before Alembic records an installation on a profile, the
 * installation's account must be the signed-in person's own GitHub account,
 * compared by GitHub's immutable numeric id:
 * - the installation's account id comes from GitHub, asked as the App;
 * - the person's id comes from their GitHub sign-in identity
 *   (`user.identities`, written by the auth provider). Never from
 *   `user_metadata`, which a signed-in user can edit.
 * Organization installations are refused until membership can be verified
 * (it needs the person's own GitHub authorization).
 */

export interface SessionUserLike {
  identities?: Array<{ provider?: string; identity_data?: Record<string, unknown> | null }> | null;
}

/** The GitHub numeric user id from the sign-in identity, or null. */
export function githubUserIdOf(user: SessionUserLike): string | null {
  const gh = (user.identities ?? []).find((i) => i.provider === "github");
  const data = gh?.identity_data ?? null;
  const raw = data?.["sub"] ?? data?.["provider_id"];
  const id = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : null;
  return id && /^[1-9][0-9]{0,19}$/.test(id) ? id : null;
}

export type OwnershipVerdict = "own" | "organization" | "someone-else" | "unknown";

export function installationOwnership(
  account: { type: string; id: number | null },
  githubUserId: string | null,
): OwnershipVerdict {
  if (githubUserId === null || account.id === null) return "unknown";
  if (account.type !== "User") return "organization";
  return String(account.id) === githubUserId ? "own" : "someone-else";
}
