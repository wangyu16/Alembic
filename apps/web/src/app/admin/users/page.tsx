import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { UsersTable, type AdminUserRow } from "./users-client";

export const dynamic = "force-dynamic";

/**
 * Admin → registered users (UG4; docs/specs/user-governance.md §3).
 *
 * Two facts live in two places, on purpose:
 *   - "can this account sign in?"  -> auth.users.banned_until, via the admin API
 *   - "may it use the assistant?"  -> profiles.ai_status
 * They are joined here for display only. Nothing is mirrored into one table.
 */
export default async function AdminUsersPage() {
  const { userId, service } = await requireAdmin();

  if (!service) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <h1 className="font-serif text-3xl tracking-tight text-ink">Users</h1>
        <p className="mt-2 text-muted">
          This page needs the service key. Set <code>SUPABASE_SECRET_KEY</code> in the deployment.
        </p>
      </main>
    );
  }

  // Accounts + ban state. Supabase paginates; 1000 covers the pilot with room to
  // spare, and the page tells the truth when it doesn't (below).
  const { data: authData, error: authError } = await service.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const authUsers = authError ? [] : authData.users;

  const { data: profileRows } = await service
    .from("profiles")
    .select("id, github_username, display_name, is_admin, ai_status, ai_requested_at, created_at");

  // Package counts per owner. `storage = 'sandbox'` means the course exists ONLY
  // in Supabase — suspending that account destroys it, so the admin sees the
  // number before confirming (spec §3).
  const { data: packageRows } = await service.from("packages").select("owner_id, storage");

  const packagesByOwner = new Map<string, { total: number; unpublished: number }>();
  for (const p of (packageRows as { owner_id: string; storage: string }[] | null) ?? []) {
    const entry = packagesByOwner.get(p.owner_id) ?? { total: 0, unpublished: 0 };
    entry.total += 1;
    if (p.storage !== "github") entry.unpublished += 1;
    packagesByOwner.set(p.owner_id, entry);
  }

  type ProfileRow = {
    id: string;
    github_username: string | null;
    display_name: string | null;
    is_admin: boolean;
    ai_status: "none" | "requested" | "approved";
    ai_requested_at: string | null;
    created_at: string;
  };
  const profiles = new Map(
    ((profileRows as ProfileRow[] | null) ?? []).map((p) => [p.id, p] as const),
  );

  const rows: AdminUserRow[] = authUsers.map((u) => {
    const p = profiles.get(u.id);
    const counts = packagesByOwner.get(u.id) ?? { total: 0, unpublished: 0 };
    const bannedUntil = u.banned_until ?? null;
    return {
      id: u.id,
      githubUsername: p?.github_username ?? null,
      displayName: p?.display_name ?? null,
      isAdmin: p?.is_admin ?? false,
      aiStatus: p?.ai_status ?? "none",
      aiRequestedAt: p?.ai_requested_at ?? null,
      createdAt: u.created_at,
      // A past timestamp is an expired ban, i.e. the account is active again.
      suspended: bannedUntil !== null && new Date(bannedUntil).getTime() > Date.now(),
      packages: counts.total,
      unpublishedPackages: counts.unpublished,
      isSelf: u.id === userId,
    };
  });

  // Pending requests first, then suspended, then everyone by join date.
  rows.sort((a, b) => {
    const rank = (r: AdminUserRow) => (r.aiStatus === "requested" ? 0 : r.suspended ? 1 : 2);
    return rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt);
  });

  const pending = rows.filter((r) => r.aiStatus === "requested").length;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-serif text-3xl tracking-tight text-ink">Users</h1>
        <Link href="/admin" className="text-sm text-muted hover:text-ink">
          ← Admin
        </Link>
      </div>
      <p className="mt-2 text-sm text-muted">
        {rows.length} account{rows.length === 1 ? "" : "s"}
        {pending > 0 && (
          <>
            {" · "}
            <span className="text-[var(--accent)]">
              {pending} awaiting assistant approval
            </span>
          </>
        )}
      </p>

      {authError && (
        <p className="mt-4 rounded-lg border border-edge bg-elevated p-3 text-sm text-ink">
          Couldn&apos;t read the account list. Ban state is unavailable, so no account is shown
          as suspended below — do not act on this page until it loads.
        </p>
      )}
      {!authError && authData.users.length === 1000 && (
        <p className="mt-4 rounded-lg border border-edge bg-elevated p-3 text-sm text-ink">
          Showing the first 1000 accounts. There may be more — this page needs pagination.
        </p>
      )}

      <div className="mt-6">
        <UsersTable rows={rows} />
      </div>
    </main>
  );
}
