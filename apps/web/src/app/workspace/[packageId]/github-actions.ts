"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { commitFiles } from "@alembic/github-bridge";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { clientForInstallation, githubConfig } from "@/lib/github";
import { slugForFile } from "@/lib/export";

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

    await client.generateFromTemplate({
      templateOwner: cfg.templateOwner,
      templateRepo: cfg.publicTemplate,
      owner,
      name: publicName,
      private: false,
      description: record.title,
    });
    await client.generateFromTemplate({
      templateOwner: cfg.templateOwner,
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
    await commitFiles(
      client,
      { owner, repo: publicName },
      { repo: "public", summary: "Publish from Alembic", changes: publicChanges },
    );
    if (privateChanges.length > 0) {
      await commitFiles(
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
    return {
      ok: false,
      error:
        "Publishing didn't complete. Check that the GitHub App is installed and the template repositories exist.",
    };
  }
}
