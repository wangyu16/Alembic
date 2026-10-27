import "server-only";
import { courseRepoScope } from "./github-scope";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  commitFiles,
  getInstallationAccount,
  installationTokenSource,
  GitHubClient,
  type FileChange,
  type RepoCoords,
} from "@alembic/github-bridge";
import {
  findLeakedPaths,
  reconcilePublicRepo,
  type PackageStore,
  type ReconcileOutcome,
} from "@alembic/package-ops";
import { registerChanges, syncPackageRegistry } from "@/lib/register";
import { refreshManifestAfterReconcile } from "@/lib/reconcile-manifest";
import { recordedPublicRepo } from "@/lib/recorded-repo";
import { recordSyncedSha, syncedShaFor } from "./synced-sha";
import { githubRepoReader } from "./repo-reader";
import { flushDiscovery } from "@/lib/discovery-flush";

export interface GithubConfig {
  appId: string;
  appSlug: string;
  privateKey: string;
  templateOwner: string;
  publicTemplate: string;
  privateTemplate: string;
}

/** Read GitHub App config from env, or null if publishing isn't configured. */
export function githubConfig(): GithubConfig | null {
  const appId = process.env["GITHUB_APP_ID"];
  const appSlug = process.env["GITHUB_APP_SLUG"];
  const rawKey = process.env["GITHUB_APP_PRIVATE_KEY"];
  const templateOwner = process.env["GITHUB_TEMPLATE_OWNER"];
  const publicTemplate = process.env["GITHUB_PUBLIC_TEMPLATE"];
  const privateTemplate = process.env["GITHUB_PRIVATE_TEMPLATE"];
  if (
    !appId || !appSlug || !rawKey || !templateOwner ||
    !publicTemplate || !privateTemplate
  ) {
    return null;
  }
  return {
    appId,
    appSlug,
    // Allow the PEM to be stored with literal \n escapes on one line.
    privateKey: rawKey.replace(/\\n/g, "\n"),
    templateOwner,
    publicTemplate,
    privateTemplate,
  };
}

/**
 * The GitHub URL where an educator installs the App ("Connect publishing").
 * `state` round-trips through the install: GitHub appends it to the Setup URL,
 * so we pass the package id and can return the educator to that package (and
 * resume publishing) instead of dropping them on the generic workspace.
 */
export function installUrl(slug: string, state?: string): string {
  const base = `https://github.com/apps/${slug}/installations/new`;
  return state ? `${base}?state=${encodeURIComponent(state)}` : base;
}

/**
 * The account (user or org) an installation belongs to. This is the
 * authoritative owner for repo creation — it always matches where the App was
 * installed, unlike the OAuth username (which can differ for org installs or be
 * absent). Returns null if publishing isn't configured.
 */
export async function installationAccountLogin(
  installationId: number,
): Promise<string | null> {
  const cfg = githubConfig();
  if (!cfg) return null;
  const account = await getInstallationAccount({
    appId: cfg.appId,
    privateKey: cfg.privateKey,
    installationId,
  });
  return account.login;
}

/** The installation's account (login, type, numeric id), or null if publishing isn't configured. */
export async function installationAccount(
  installationId: number,
): Promise<{ login: string; type: string; id: number | null } | null> {
  const cfg = githubConfig();
  if (!cfg) return null;
  return getInstallationAccount({ appId: cfg.appId, privateKey: cfg.privateKey, installationId });
}

/**
 * A GitHub client authenticated as a specific installation. The token source
 * refreshes the one-hour installation token ahead of expiry and after a 401,
 * so a long publish cannot run past it. The first token is minted here, so a
 * broken installation still fails at this call, as before.
 */
export async function clientForInstallation(
  cfg: GithubConfig,
  installationId: number,
): Promise<GitHubClient> {
  const tokens = installationTokenSource({
    appId: cfg.appId,
    privateKey: cfg.privateKey,
    installationId,
  });
  await tokens.token();
  return new GitHubClient(tokens);
}

/**
 * A GitHub client + account login for the signed-in user, or null if
 * publishing isn't configured or the user hasn't connected an installation.
 */
export async function clientForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ client: GitHubClient; owner: string } | null> {
  const cfg = githubConfig();
  if (!cfg) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("github_installation_id, github_username")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.github_installation_id || !profile.github_username) return null;
  const client = await clientForInstallation(cfg, profile.github_installation_id);
  return { client, owner: profile.github_username };
}

/**
 * A GitHub client for a COURSE (workspace v3): the installation of the account
 * that owns its repositories, with tokens scoped to exactly those repositories
 * (permissions §4.4). Used for every course GitHub call, whoever acts. Reads
 * the service-role-only columns, so it takes the admin client. Null when the
 * course has no installation or repositories recorded yet.
 */
export async function clientForCourse(
  admin: SupabaseClient,
  packageId: string,
): Promise<{ client: GitHubClient; owner: string; repos: string[] } | null> {
  const cfg = githubConfig();
  if (!cfg) return null;
  const [{ data }, { data: inst }] = await Promise.all([
    admin.from("packages").select("private_repo, public_repo").eq("id", packageId).maybeSingle(),
    admin.from("course_installations").select("installation_id").eq("package_id", packageId).maybeSingle(),
  ]);
  if (!data || !inst?.installation_id) return null;
  const scope = courseRepoScope(data as Parameters<typeof courseRepoScope>[0]);
  if (!scope) return null;
  const tokens = installationTokenSource({
    appId: cfg.appId,
    privateKey: cfg.privateKey,
    installationId: inst.installation_id as number,
    repositories: scope.names,
  });
  await tokens.token();
  return { client: new GitHubClient(tokens), owner: scope.owner, repos: scope.names };
}

export { advanceSyncedSha, recordOwnCommit, recordSyncedSha, syncedShaFor } from "./synced-sha";

/**
 * Reconcile a GitHub-backed package's public repo against external edits (M20):
 * detect foreign commits past the last-synced SHA, rebuild the projection, and
 * re-validate the two-repo invariant + block-ID integrity — quarantining on
 * violation (never absorbing a bad state). Returns null when the package isn't
 * GitHub-backed or publishing isn't connected. On a clean reconcile the synced
 * SHA advances to the new head.
 */
export async function reconcilePackage(
  supabase: SupabaseClient,
  store: PackageStore,
  userId: string,
  packageId: string,
): Promise<ReconcileOutcome | null> {
  const record = await store.getPackage(packageId);
  const repo = recordedPublicRepo(record);
  if (!repo) return null;
  const gh = await clientForUser(supabase, userId);
  if (!gh) return null;
  const coords: RepoCoords = { owner: repo.owner, repo: repo.name };
  const lastSyncedSha = await syncedShaFor(supabase, packageId);
  const outcome = await reconcilePublicRepo(store, packageId, {
    lastSyncedSha,
    // Falls back to a whole-tree comparison when GitHub's compare cannot
    // list everything (loop r3, P5.B.3.g / P5.B.3.j).
    reader: githubRepoReader(gh.client, coords, { store, packageId }),
  });
  // Advance the synced pointer only when the repo state is clean (up-to-date or
  // cleanly absorbed). A quarantine leaves it untouched so the divergence stays
  // visible until resolved.
  if (outcome.status === "up-to-date" || outcome.status === "absorbed") {
    // A foreign alembic.json was absorbed through updateManifest: refresh the
    // packages.manifest read cache from it BEFORE the synced pointer moves, so
    // a failure here is retried by the next reconcile (P5.B.3.e).
    await refreshManifestAfterReconcile(supabase, packageId, outcome);
    await flushDiscovery(supabase, packageId);
    await recordSyncedSha(supabase, packageId, outcome.headSha);
    // Door #3: register the absorbed external-commit files (best-effort).
    // The diff names exactly what changed; a large foreign commit falls back
    // to one full rebuild rather than hundreds of single-row reads.
    if (outcome.status === "absorbed") {
      if (outcome.changedPaths.length <= 50) {
        await registerChanges(
          supabase,
          packageId,
          outcome.changedPaths.map((path) => ({ repo: "public" as const, path })),
          "external-commit",
        );
      } else {
        await syncPackageRegistry(supabase, packageId, "external-commit");
      }
    }
  }
  return outcome;
}

/**
 * M21 — audit the WHOLE public repo tree (not just a diff) for paths that
 * violate the two-repo invariant: private content that has leaked into the
 * public repo. Returns null when the package isn't GitHub-backed/connected.
 * `truncated` means the tree exceeded GitHub's limit and the audit is
 * inconclusive. A non-empty `leaked` means remediation is required — see
 * docs/specs/leakage-remediation.md.
 */
export async function scanPublicRepoForLeaks(
  supabase: SupabaseClient,
  store: PackageStore,
  userId: string,
  packageId: string,
): Promise<{ leaked: string[]; truncated: boolean } | null> {
  const record = await store.getPackage(packageId);
  const repo = recordedPublicRepo(record);
  if (!repo) return null;
  const gh = await clientForUser(supabase, userId);
  if (!gh) return null;
  const coords: RepoCoords = { owner: repo.owner, repo: repo.name };
  const head = await gh.client.getBranchHead(coords);
  const { paths, truncated } = await gh.client.listTree(coords, head.commitSha);
  return { leaked: findLeakedPaths(paths), truncated };
}
