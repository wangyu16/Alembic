"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LicenseSchema } from "@alembic/package-contract";
import { createSandboxPackage } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";

export async function createPackageAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const title = String(formData.get("title") ?? "").trim();
  const licenseResult = LicenseSchema.safeParse(formData.get("license"));
  if (!title || !licenseResult.success) {
    redirect("/workspace?error=missing-fields");
  }

  const started = Date.now();
  const created = await createSandboxPackage(
    new SupabaseSandboxStore(supabase),
    {
      ownerId: user.id,
      title,
      license: licenseResult.data,
    },
  );

  await supabaseEventLogger(supabase).log({
    type: "package.created",
    userId: user.id,
    packageId: created.packageId,
    durationMs: Date.now() - started,
    detail: { storage: "sandbox", license: licenseResult.data },
    occurredAt: new Date().toISOString(),
  });

  revalidatePath("/workspace");
}
