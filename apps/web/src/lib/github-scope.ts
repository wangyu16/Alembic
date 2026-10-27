/** Pure helpers for course GitHub access (workspace v3, A3). No IO. */

/** The repositories a course's token may reach (names only, never from the manifest). */
export function courseRepoScope(row: {
  private_repo: { owner: string; name: string } | null;
  public_repo: { owner: string; name: string } | null;
}): { owner: string; names: string[] } | null {
  const working = row.private_repo;
  if (!working) return null;
  const names = [working.name];
  if (row.public_repo) {
    if (row.public_repo.owner !== working.owner) return null; // both repos live in one account (§6)
    names.push(row.public_repo.name);
  }
  return { owner: working.owner, names };
}

