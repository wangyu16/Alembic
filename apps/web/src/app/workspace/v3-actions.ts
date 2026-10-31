"use server";

import { redirect } from "next/navigation";
import { LicenseSchema } from "@alembic/package-contract";
import { createCourseRepoV3 } from "@alembic/package-ops";
import { findUserInstallation } from "@alembic/github-bridge";
import { githubUserIdOf, installationOwnership } from "@/lib/github-installation-owner";
import { clientForInstallation, githubConfig } from "@/lib/github";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { v3Enabled } from "@/lib/db";
import { recordDocVersion } from "@/lib/course-v3";

/**
 * Create a v3 course (testing): its working repo is generated into the
 * person's own GitHub account through their App installation, then the
 * course and its installation are recorded. The person must have connected
 * GitHub (the installation is verified as their own when it is recorded).
 */
export async function createCourseV3Action(formData: FormData): Promise<void> {
  if (!v3Enabled()) redirect("/workspace");
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  const license = LicenseSchema.safeParse(formData.get("license"));
  // One title per line: someone who knows their table of contents sets up the whole course at once (RC.26).
  const chapters = String(formData.get("chapters") ?? "").split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  if (chapters.length > 30) redirect("/workspace?v3=too-many");
  const startParts = formData.get("start") === "on";
  if (!title || !license.success) redirect("/workspace?v3=missing");

  const cfg = githubConfig();
  const admin = createServiceClient();
  if (!cfg || !admin) redirect("/workspace?v3=unconfigured");
  // A repeated press (or double click) while the first one is still working: go to the course it made.
  const { data: recent } = await admin.from("packages").select("id").eq("owner_id", user.id).eq("title", title)
    .gte("created_at", new Date(Date.now() - 2 * 60_000).toISOString()).order("created_at", { ascending: false }).limit(1);
  if (recent?.[0]) redirect(`/workspace/${recent[0].id as string}/course`);
  const { data: profile } = await admin.from("profiles").select("github_installation_id, github_username, display_name").eq("id", user.id).maybeSingle();
  const installationId = profile?.github_installation_id as number | null;
  const owner = profile?.github_username as string | null;
  if (!installationId || !owner) redirect("/workspace?v3=connect");

  let created: Awaited<ReturnType<typeof createCourseRepoV3>>;
  try {
    const client = await clientForInstallation(cfg, installationId);
    created = await createCourseRepoV3(
      { title, owner, templateOwner: cfg.templateOwner, privateTemplate: cfg.privateTemplate, license: license.data, chapters, startParts, authorName: (profile?.display_name as string | null) ?? undefined },
      {
        generateFromTemplate: (i) => client.generateFromTemplate(i),
        waitForHead: async (coords) => {
          // GitHub fills a generated repo shortly after the call returns.
          for (const ms of [500, 1000, 2000, 3000, 4000, 5000, 0]) {
            try { return (await client.getBranchHead(coords)).commitSha; } catch (e) { if (ms === 0) throw e; }
            await new Promise((r) => setTimeout(r, ms));
          }
          throw new Error("the new repository did not become ready");
        },
        commit: async (coords, i) =>
          (await client.commitChain({ coords, branch: "main", expectedHead: i.expectedHead, steps: [{ message: i.message, files: i.files }] })).head,
      },
    );
  } catch (e) {
    console.error("createCourseV3:", (e as Error).message);
    redirect("/workspace?v3=failed");
  }

  const { error } = await admin.from("packages").insert({
    id: created.packageId, owner_id: user.id, title, manifest: created.manifest, storage: "github",
    private_repo: { owner: created.repo.owner, name: created.repo.name },
  });
  if (error) { console.error("createCourseV3 insert:", error.message); redirect("/workspace?v3=failed"); }
  await admin.from("course_installations").insert({ package_id: created.packageId, installation_id: installationId });
  const guide = created.files.find((f) => f.startsWith("study-guide/"));
  if (guide) {
    const c = await clientForInstallation(cfg, installationId);
    const text = await c.getFileAtRef({ owner: created.repo.owner, repo: created.repo.name }, guide, created.head);
    if (text !== null) await recordDocVersion(created.packageId, guide, text, created.head);
  }
  redirect(`/workspace/${created.packageId}/course`);
}

/**
 * Connect GitHub without relying on GitHub's redirect (it doesn't come back
 * for an account where the App is already installed): ask GitHub, as the App,
 * for the installation on the person's own account and record it if it is
 * theirs (same ownership check as /api/github/installed). Not installed yet →
 * GitHub's install page, whose redirect records it.
 */
export async function connectGithubAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  const cfg = githubConfig();
  const admin = createServiceClient();
  if (!cfg || !admin) redirect("/workspace?v3=unconfigured");
  const gh = (user.identities ?? []).find((i) => i.provider === "github");
  const login = typeof gh?.identity_data?.["user_name"] === "string" ? (gh.identity_data["user_name"] as string) : null;
  const install = `https://github.com/apps/${cfg.appSlug}/installations/new`;
  if (!login) redirect(install);
  let found: Awaited<ReturnType<typeof findUserInstallation>> = null;
  try {
    found = await findUserInstallation({ appId: cfg.appId, privateKey: cfg.privateKey, login });
  } catch {
    redirect("/workspace?v3=failed");
  }
  if (!found) redirect(install);
  if (installationOwnership(found.account, githubUserIdOf(user)) !== "own") redirect("/workspace?v3=not-yours");
  await admin.from("profiles").update({ github_installation_id: found.id, github_username: found.account.login }).eq("id", user.id);
  redirect("/workspace?v3=connected");
}
