"use server";

import { redirect } from "next/navigation";
import { LicenseSchema } from "@alembic/package-contract";
import { createCourseRepoV3 } from "@alembic/package-ops";
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
  const firstChapter = String(formData.get("chapter") ?? "").trim().slice(0, 200);
  if (!title || !license.success) redirect("/workspace?v3=missing");

  const cfg = githubConfig();
  const admin = createServiceClient();
  if (!cfg || !admin) redirect("/workspace?v3=unconfigured");
  const { data: profile } = await admin.from("profiles").select("github_installation_id, github_username").eq("id", user.id).maybeSingle();
  const installationId = profile?.github_installation_id as number | null;
  const owner = profile?.github_username as string | null;
  if (!installationId || !owner) redirect("/workspace?v3=connect");

  let created: Awaited<ReturnType<typeof createCourseRepoV3>>;
  try {
    const client = await clientForInstallation(cfg, installationId);
    created = await createCourseRepoV3(
      { title, owner, templateOwner: cfg.templateOwner, privateTemplate: cfg.privateTemplate, license: license.data, firstChapter },
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
