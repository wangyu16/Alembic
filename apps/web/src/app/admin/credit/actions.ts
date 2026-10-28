"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { isGithubLogin } from "@/lib/invitations";
import type { AdminCreditMessage } from "./messages";

// Only fixed message codes travel in the URL, so a crafted link can't show a false status.
const back = (msg: AdminCreditMessage) => redirect(`/admin/credit?msg=${msg}`);
const failure = (e: { message: string }): AdminCreditMessage => {
  console.error("admin/credit:", e.message);
  return /expiry date has passed/.test(e.message) ? "past-expiry" : "failed";
};
const amountOf = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 1_000_000 ? n : null;
};
const expiryOf = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59:59Z` : null;
};

/** One profile per GitHub name, or null (no match or more than one: names aren't unique). */
async function userByLogin(service: NonNullable<Awaited<ReturnType<typeof requireAdmin>>["service"]>, raw: string) {
  const login = raw.trim().replace(/^@/, "");
  if (!isGithubLogin(login)) return null; // GitHub names have no wildcard characters
  const { data } = await service.from("profiles").select("id").ilike("github_username", login).limit(2);
  return data && data.length === 1 ? (data[0]!.id as string) : null;
}

export async function grantUserAction(formData: FormData): Promise<void> {
  const { userId, service } = await requireAdmin();
  if (!service) back("no-service");
  const amount = amountOf(formData.get("amount"));
  if (!amount) back("bad-amount");
  const user = await userByLogin(service!, String(formData.get("login") ?? ""));
  if (!user) back("no-user");
  const { error } = await service!.rpc("ledger_grant", {
    p_actor: userId, p_user: user, p_amount: amount, p_expires: expiryOf(formData.get("expires")), p_note: String(formData.get("note") ?? "").slice(0, 200) || null,
  });
  revalidatePath("/admin/credit");
  back(error ? failure(error) : "granted");
}

export async function createCohortAction(formData: FormData): Promise<void> {
  const { userId, service } = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim().slice(0, 100);
  if (!service || !name) back("no-name");
  const { error } = await service!.from("cohorts").insert({ name, created_by: userId });
  revalidatePath("/admin/credit");
  back(error ? failure(error) : "group-created");
}

export async function addToCohortAction(formData: FormData): Promise<void> {
  const { userId, service } = await requireAdmin();
  if (!service) back("no-service");
  const user = await userByLogin(service!, String(formData.get("login") ?? ""));
  if (!user) back("no-user");
  const { error } = await service!.rpc("ledger_cohort_add", { p_actor: userId, p_cohort: String(formData.get("cohort") ?? ""), p_user: user });
  revalidatePath("/admin/credit");
  back(error ? failure(error) : "member-added");
}

export async function grantCohortAction(formData: FormData): Promise<void> {
  const { userId, service } = await requireAdmin();
  const amount = amountOf(formData.get("amount"));
  if (!service || !amount) back("bad-amount");
  const { error } = await service!.rpc("ledger_cohort_grant", {
    p_actor: userId, p_cohort: String(formData.get("cohort") ?? ""), p_amount: amount, p_expires: expiryOf(formData.get("expires")), p_note: String(formData.get("note") ?? "").slice(0, 200) || null,
  });
  revalidatePath("/admin/credit");
  back(error ? failure(error) : "group-granted");
}

export async function endGrantAction(formData: FormData): Promise<void> {
  const { userId, service } = await requireAdmin();
  if (!service) back("no-service");
  const { error } = await service!.rpc("ledger_end_grant", { p_actor: userId, p_grant: String(formData.get("grant") ?? "") });
  revalidatePath("/admin/credit");
  back(error ? failure(error) : "grant-ended");
}

export async function setPriceAction(formData: FormData): Promise<void> {
  const { service } = await requireAdmin();
  const usd = Number(formData.get("usd"));
  if (!service || !Number.isFinite(usd) || usd <= 0 || usd > 100) back("bad-price");
  const { error } = await service!.from("credit_prices").insert({ usd_per_credit: usd });
  revalidatePath("/admin/credit");
  back(error ? failure(error) : "price-set");
}
