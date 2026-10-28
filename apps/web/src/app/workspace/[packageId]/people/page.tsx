import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { endDeputyAction, leaveCourseAction, nameDeputyAction, removeMemberAction, revokeInvitationAction } from "./actions";
import { InviteForm } from "./invite-form";

export const dynamic = "force-dynamic";

const ROLE: Record<string, string> = { owner: "Owner", "co-author": "Co-author" };

export default async function PeoplePage({ params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/workspace/${packageId}/people`)}`);

  const { data: members } = await supabase.rpc("course_member_profiles", { p: packageId });
  const list = (members ?? []) as Array<{ user_id: string; role: string; deputy_until: string | null; github_username: string | null; display_name: string | null }>;
  if (list.length === 0) redirect("/workspace");
  const isOwner = list.some((m) => m.user_id === user.id && m.role === "owner");
  const { data: invites } = isOwner ? await supabase.rpc("course_open_invitations", { p: packageId }) : { data: [] };
  const open = (invites ?? []) as Array<{ id: string; invitee_login: string; expires_at: string }>;
  const { data: course } = await supabase.from("packages").select("title").eq("id", packageId).maybeSingle();
  const today = new Date().toISOString().slice(0, 10);
  const sixMonths = new Date(Date.now() + 182 * 86_400_000).toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <p className="text-sm"><Link href={`/workspace/${packageId}`}>← {(course?.title as string | undefined) ?? "Course"}</Link></p>
      <h1 className="mt-2 text-2xl font-semibold">People</h1>
      <p className="mt-1 text-sm"><Link className="underline" href={`/workspace/${packageId}/needs-you`}>Needs you</Link></p>
      <ul className="mt-4 divide-y rounded border">
        {list.map((m) => {
          const deputy = m.deputy_until && new Date(m.deputy_until) > new Date();
          return (
            <li key={m.user_id} className="flex items-center justify-between p-3">
              <span>
                <span className="font-medium">{m.display_name || m.github_username || "Someone"}</span>
                {m.github_username ? <span className="ml-2 text-sm text-gray-600">@{m.github_username}</span> : null}
                <span className="ml-2 text-sm">
                  {ROLE[m.role] ?? m.role}
                  {deputy ? ` · deputy until ${new Date(m.deputy_until!).toLocaleDateString()}` : ""}
                </span>
              </span>
              {isOwner && m.role !== "owner" ? (
                <span className="flex flex-wrap items-center gap-3">
                  {deputy ? (
                    <form action={endDeputyAction}>
                      <input type="hidden" name="packageId" value={packageId} />
                      <input type="hidden" name="userId" value={m.user_id} />
                      <button type="submit" className="text-sm underline">End deputy</button>
                    </form>
                  ) : (
                    <form action={nameDeputyAction} className="flex items-center gap-1 text-sm">
                      <input type="hidden" name="packageId" value={packageId} />
                      <input type="hidden" name="userId" value={m.user_id} />
                      <label className="sr-only" htmlFor={`until-${m.user_id}`}>Deputy until</label>
                      <input id={`until-${m.user_id}`} type="date" name="until" required min={today} max={sixMonths} className="rounded border px-1" />
                      <button type="submit" className="underline" title="While you're away, a deputy can approve and publish in your place.">Make deputy</button>
                    </form>
                  )}
                  <form action={removeMemberAction}>
                    <input type="hidden" name="packageId" value={packageId} />
                    <input type="hidden" name="userId" value={m.user_id} />
                    <button type="submit" className="text-sm text-red-700 underline">Remove</button>
                  </form>
                </span>
              ) : !isOwner && m.user_id === user.id ? (
                <form action={leaveCourseAction}>
                  <input type="hidden" name="packageId" value={packageId} />
                  <button type="submit" className="text-sm underline">Leave this course</button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>

      {isOwner ? (
        <section className="mt-8">
          <h2 className="text-lg font-medium">Invite a co-author</h2>
          <p className="mt-1 text-sm text-gray-600">Co-authors edit the course with you. You keep approving and publishing; while you&apos;re away, a deputy can do both until the date you choose.</p>
          <div className="mt-3"><InviteForm packageId={packageId} /></div>
          {open.length > 0 ? (
            <>
              <h3 className="mt-6 font-medium">Waiting to be accepted</h3>
              <ul className="mt-2 divide-y rounded border">
                {open.map((i) => (
                  <li key={i.id} className="flex items-center justify-between p-3 text-sm">
                    <span>@{i.invitee_login} · until {new Date(i.expires_at).toLocaleDateString()}</span>
                    <form action={revokeInvitationAction}>
                      <input type="hidden" name="packageId" value={packageId} />
                      <input type="hidden" name="id" value={i.id} />
                      <button type="submit" className="text-red-700 underline">Cancel</button>
                    </form>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
