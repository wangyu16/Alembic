import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  commitFiles,
  getInstallationToken,
  GitHubClient,
  type FileChange,
} from "@alembic/github-bridge";
import type { PackageStore } from "@alembic/package-ops";

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
  await commitFiles(
    gh.client,
    { owner: repo.owner, repo: repo.name },
    { repo: "public", summary, changes },
  );
}
