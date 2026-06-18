"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseStudyGuide } from "@alembic/package-contract";
import {
  DEFAULT_STUDY_GUIDE_PATH,
  saveStudyGuide,
} from "@alembic/package-ops";
import { commitFiles, GitHubError } from "@alembic/github-bridge";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import {
  clientForInstallation,
  clientForUser,
  githubConfig,
} from "@/lib/github";
import { slugForFile } from "@/lib/export";

/**
 * Create a repo from a template, but tolerate a re-run after a partial publish:
 * if the name already exists (422 "already exists"), the repo is from a prior
 * attempt — reuse it instead of dead-ending. Other 422s (e.g. "not a template
 * repository") still surface.
 */
async function ensureRepoFromTemplate(
  client: Awaited<ReturnType<typeof clientForInstallation>>,
  cfg: NonNullable<ReturnType<typeof githubConfig>>,
  input: {
    templateRepo: string;
    owner: string;
    name: string;
    private: boolean;
    description: string;
  },
): Promise<void> {
  try {
    await client.generateFromTemplate({
      templateOwner: cfg.templateOwner,
      templateRepo: input.templateRepo,
      owner: input.owner,
      name: input.name,
      private: input.private,
      description: input.description,
    });
  } catch (e) {
    if (
      e instanceof GitHubError &&
      e.status === 422 &&
      /already exists/i.test(e.detail ?? "")
    ) {
      return; // repo exists from an earlier attempt — reuse it
    }
    throw e;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Commit to a just-created repo, tolerating GitHub's template-init delay:
 * `generateFromTemplate` returns before the repo is populated, so the first ref
 * read can hit an empty repo (409 "Git Repository is empty") or a not-yet-ready
 * ref (404). Retry with backoff until the branch exists. Existing-repo commit
 * paths (e.g. study-guide save) never see this, so the retry lives only here.
 */
async function commitFilesWhenReady(
  client: Awaited<ReturnType<typeof clientForInstallation>>,
  coords: { owner: string; repo: string },
  plan: Parameters<typeof commitFiles>[2],
): Promise<void> {
  const backoff = [500, 1000, 2000, 3000, 4000]; // ~10.5s worst case
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    try {
      await commitFiles(client, coords, plan);
      return;
    } catch (e) {
      const initializing =
        e instanceof GitHubError && (e.status === 409 || e.status === 404);
      if (!initializing || attempt === backoff.length) throw e;
      await sleep(backoff[attempt]!);
    }
  }
}

/** Turn a publish failure into an educator-facing message with a real hint. */
function publishErrorMessage(e: unknown): string {
  if (e instanceof GitHubError) {
    if (e.status === 404) {
      // The common case: a template repo can't be read by this installation —
      // typically the PRIVATE template is itself private (the public one worked).
      return "Publishing couldn't read a template repository. Make sure both template repos exist and are marked as templates, and that the private template is public (the generated private repo is still private) so your account can use it.";
    }
    if (e.status === 403) {
      return "GitHub refused the request (permissions). Reinstall the Alembic GitHub App and grant it access, then try again.";
    }
    if (e.status === 409) {
      return "GitHub is still finishing setting up the new repositories. Give it a few seconds and click Publish again.";
    }
    if (e.status === 422 && /not a template/i.test(e.detail ?? "")) {
      return "A template repository isn't marked as a template. In each template repo's Settings, enable “Template repository”, then try again.";
    }
    return `Publishing didn't complete (GitHub HTTP ${e.status}). Check that the GitHub App is installed and the template repositories exist.`;
  }
  return "Publishing didn't complete. Check that the GitHub App is installed and the template repositories exist.";
}

export interface PublishResult {
  ok: boolean;
  publicRepoUrl?: string;
  error?: string;
}

export async function publishToGitHubAction(
  packageId: string,
): Promise<PublishResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const cfg = githubConfig();
  if (!cfg) {
    return { ok: false, error: "GitHub publishing isn't configured on this deployment." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("github_installation_id, github_username")
    .eq("id", user.id)
    .maybeSingle();
  const installationId = profile?.github_installation_id as number | null;
  if (!installationId) {
    return { ok: false, error: "Connect publishing first." };
  }
  const owner: string | undefined =
    profile?.github_username ??
    (user.user_metadata?.["user_name"] as string | undefined);
  if (!owner) {
    return { ok: false, error: "Could not determine your GitHub account." };
  }

  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) return { ok: false, error: "Package not found." };
  if (record.storage === "github" && record.manifest.publicRepo) {
    const r = record.manifest.publicRepo;
    return { ok: true, publicRepoUrl: `https://github.com/${r.owner}/${r.name}` };
  }

  const events = supabaseEventLogger(supabase);
  await events.log({
    type: "publish.requested",
    userId: user.id,
    packageId,
    detail: {},
    occurredAt: new Date().toISOString(),
  });

  try {
    const client = await clientForInstallation(cfg, installationId);
    const frag = packageId.slice(-8);
    const base = slugForFile(record.title);
    const publicName = `${base}-${frag}-oer`;
    const privateName = `${base}-${frag}-private`;

    await ensureRepoFromTemplate(client, cfg, {
      templateRepo: cfg.publicTemplate,
      owner,
      name: publicName,
      private: false,
      description: record.title,
    });
    await ensureRepoFromTemplate(client, cfg, {
      templateRepo: cfg.privateTemplate,
      owner,
      name: privateName,
      private: true,
      description: `${record.title} (private)`,
    });

    // Update the manifest with the repo pair and write it into the public commit.
    const manifest = {
      ...record.manifest,
      publicRepo: { owner, name: publicName },
      privateRepo: { owner, name: privateName },
    };
    const files = await store.listFiles(packageId);
    const publicChanges = files
      .filter((f) => f.repo === "public")
      .map((f) =>
        f.path === "alembic.json"
          ? { path: f.path, content: JSON.stringify(manifest, null, 2) + "\n" }
          : { path: f.path, content: f.content },
      );
    const privateChanges = files
      .filter((f) => f.repo === "private")
      .map((f) => ({ path: f.path, content: f.content }));

    // Each commit re-validates the two-repo invariant before any write.
    // Retry-when-ready absorbs GitHub's async template initialization.
    await commitFilesWhenReady(
      client,
      { owner, repo: publicName },
      { repo: "public", summary: "Publish from Alembic", changes: publicChanges },
    );
    if (privateChanges.length > 0) {
      await commitFilesWhenReady(
        client,
        { owner, repo: privateName },
        { repo: "private", summary: "Publish from Alembic", changes: privateChanges },
      );
    }

    await supabase
      .from("packages")
      .update({
        storage: "github",
        public_repo: { owner, name: publicName },
        private_repo: { owner, name: privateName },
        manifest,
      })
      .eq("id", packageId);

    await events.log({
      type: "publish.completed",
      userId: user.id,
      packageId,
      detail: { publicRepo: publicName, privateRepo: privateName },
      occurredAt: new Date().toISOString(),
    });

    revalidatePath(`/workspace/${packageId}`);
    return { ok: true, publicRepoUrl: `https://github.com/${owner}/${publicName}` };
  } catch (e) {
    await events.log({
      type: "publish.failed",
      userId: user.id,
      packageId,
      detail: { reason: e instanceof Error ? e.message : "unknown" },
      occurredAt: new Date().toISOString(),
    });
    return { ok: false, error: publishErrorMessage(e) };
  }
}

export interface RestoreResult {
  ok: boolean;
  error?: string;
}

/**
 * Restore the study guide to a previous saved version (a commit on the public
 * repo): read the file at that commit, rebuild the local projection, and
 * commit the restored content forward as a new commit.
 */
export async function restoreStudyGuideAction(
  packageId: string,
  commitSha: string,
): Promise<RestoreResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  const repo = record?.storage === "github" ? record.manifest.publicRepo : null;
  if (!repo) return { ok: false, error: "This package isn't published to GitHub." };

  const gh = await clientForUser(supabase, user.id);
  if (!gh) return { ok: false, error: "Connect publishing first." };

  try {
    const coords = { owner: repo.owner, repo: repo.name };
    const path = DEFAULT_STUDY_GUIDE_PATH;
    const content = await gh.client.getFileAtRef(coords, path, commitSha);
    if (content === null) {
      return { ok: false, error: "That version has no study guide to restore." };
    }
    const parsed = parseStudyGuide(content);
    await saveStudyGuide(store, packageId, {
      path,
      preamble: parsed.preamble,
      blocks: parsed.blocks,
    });
    await commitFiles(gh.client, coords, {
      repo: "public",
      summary: `Restore ${path} to ${commitSha.slice(0, 7)}`,
      changes: [{ path, content }],
    });
    await supabaseEventLogger(supabase).log({
      type: "restore.completed",
      userId: user.id,
      packageId,
      detail: { fromCommit: commitSha.slice(0, 7) },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Restore didn't complete. Please try again." };
  }
}
