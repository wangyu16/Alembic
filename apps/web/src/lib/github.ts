import "server-only";
import {
  getInstallationToken,
  GitHubClient,
} from "@alembic/github-bridge";

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
