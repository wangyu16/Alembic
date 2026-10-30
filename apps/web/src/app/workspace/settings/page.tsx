import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setEmailEveryAction } from "./actions";

export const dynamic = "force-dynamic";

const OPTIONS = [
  { value: "week", label: "Weekly (Mondays)", hint: "One email a week, even when nothing needs you." },
  { value: "day", label: "Daily", hint: "Only on days when something needs you." },
  { value: "off", label: "Off", hint: "No email. You still see Needs you in each course." },
] as const;

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const { data } = await supabase.from("notification_prefs").select("email_every").eq("user_id", user.id).maybeSingle();
  const current = (data?.email_every as string | undefined) ?? "week";

  return (
    <main className="mx-auto max-w-2xl p-6">
      <p className="text-sm"><Link href="/workspace">← Your courses</Link></p>
      <h1 className="page-title mt-2">Settings</h1>
      <section className="mt-6">
        <h2 className="text-lg font-medium">Needs-you email</h2>
        <p className="mt-1 text-sm text-muted">A summary of what is waiting for you in your courses.</p>
        <form action={setEmailEveryAction} className="mt-3 space-y-2">
          {OPTIONS.map((o) => (
            <label key={o.value} className="flex items-start gap-2">
              <input type="radio" name="every" value={o.value} defaultChecked={current === o.value} className="mt-1" />
              <span>
                <span className="font-medium">{o.label}</span>
                <span className="block text-sm text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
          <button type="submit" className="mt-2 rounded bg-black px-3 py-1.5 text-white">Save</button>
        </form>
      </section>
    </main>
  );
}
