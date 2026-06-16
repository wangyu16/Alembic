import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  commitFiles,
  getInstallationToken,
  GitHubClient,
  type FileChange,
  type RepoCoords,
} from "@alembic/github-bridge";
import {
  findLeakedPaths,
  reconcilePublicRepo,
  type PackageStore,
  type ReconcileOutcome,
  type RepoReader,
} from "@alembic/package-ops";

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

/** The GitHub URL where an educator installs the App ("Connect publishing"). */
export function installUrl(slug: string): string {
  return `https://github.com/apps/${slug}/installations/new`;
}

/** A GitHub client authenticated as a specific installation. */
export async function clientForInstallation(
  cfg: GithubConfig,
  installationId: number,
): Promise<GitHubClient> {
  const { token } = await getInstallationToken({
    appId: cfg.appId,
    privateKey: cfg.privateKey,
    installationId,
  });
  return new GitHubClient(token);
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
 * Commit files to the package's PRIVATE repo (e.g. answer keys), only if it's
 * GitHub-backed and connected. No-op for sandbox packages. The commit plan is
 * `repo:"private"`, so `validateCommitPlan` fails closed if any path isn't a
 * private-layer path — answer keys can never be mis-routed to the public repo.
 */
export async function syncPrivateFilesToGitHub(
  supabase: SupabaseClient,
  store: PackageStore,
  userId: string,
  packageId: string,
  changes: FileChange[],
  summary: string,
): Promise<void> {
  if (changes.length === 0) return;
  const record = await store.getPackage(packageId);
  const repo = record?.storage === "github" ? record.manifest.privateRepo : null;
  if (!repo) return;
  const gh = await clientForUser(supabase, userId);
  if (!gh) return;
  await commitFiles(
    gh.client,
    { owner: repo.owner, repo: repo.name },
    { repo: "private", summary, changes },
  );
}

/**
 * Commit files to the package's public repo, but only if it's GitHub-backed
 * and publishing is connected. No-op for sandbox packages. Shared by the
 * study-guide save, chapter, and change (tidy/review) actions.
 */
export async function syncFilesToGitHub(
  supabase: SupabaseClient,
  store: PackageStore,
  userId: string,
  packageId: string,
  changes: FileChange[],
  summary: string,
): Promise<void> {
  if (changes.length === 0) return;
  const record = await store.getPackage(packageId);
  const repo = record?.storage === "github" ? record.manifest.publicRepo : null;
  if (!repo) return;
  const gh = await clientForUser(supabase, userId);
  if (!gh) return;
  const { commitSha } = await commitFiles(
    gh.client,
    { owner: repo.owner, repo: repo.name },
    { repo: "public", summary, changes },
  );
  // Track what we last synced so external (foreign) commits become detectable.
  await recordSyncedSha(supabase, packageId, commitSha);
}

/** Persist the last commit SHA Alembic synced for a package (M20). */
export async function recordSyncedSha(
  supabase: SupabaseClient,
  packageId: string,
  sha: string,
): Promise<void> {
  await supabase.from("packages").update({ last_synced_sha: sha }).eq("id", packageId);
}

/** The last SHA Alembic synced, or null if never synced / unknown. */
export async function syncedShaFor(
  supabase: SupabaseClient,
  packageId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("packages")
    .select("last_synced_sha")
    .eq("id", packageId)
    .maybeSingle();
  return (data?.last_synced_sha as string | null) ?? null;
}

/** A network-backed RepoReader over the public repo (keeps package-ops IO-free). */
function githubRepoReader(client: GitHubClient, coords: RepoCoords): RepoReader {
  return {
    getHeadSha: async () => (await client.getBranchHead(coords)).commitSha,
    listChangedPaths: (base, head) => client.compareCommits(coords, base, head),
    readFileAtRef: (path, ref) => client.getFileAtRef(coords, path, ref),
  };
}

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
  const repo = record?.storage === "github" ? record.manifest.publicRepo : null;
  if (!repo) return null;
  const gh = await clientForUser(supabase, userId);
  if (!gh) return null;
  const coords: RepoCoords = { owner: repo.owner, repo: repo.name };
  const lastSyncedSha = await syncedShaFor(supabase, packageId);
  const outcome = await reconcilePublicRepo(store, packageId, {
    lastSyncedSha,
    reader: githubRepoReader(gh.client, coords),
  });
  // Advance the synced pointer only when the repo state is clean (up-to-date or
  // cleanly absorbed). A quarantine leaves it untouched so the divergence stays
  // visible until resolved.
  if (outcome.status === "up-to-date" || outcome.status === "absorbed") {
    await recordSyncedSha(supabase, packageId, outcome.headSha);
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
  const repo = record?.storage === "github" ? record.manifest.publicRepo : null;
  if (!repo) return null;
  const gh = await clientForUser(supabase, userId);
  if (!gh) return null;
  const coords: RepoCoords = { owner: repo.owner, repo: repo.name };
  const head = await gh.client.getBranchHead(coords);
  const { paths, truncated } = await gh.client.listTree(coords, head.commitSha);
  return { leaked: findLeakedPaths(paths), truncated };
}
