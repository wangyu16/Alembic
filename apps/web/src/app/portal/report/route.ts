import { NextResponse } from "next/server";
import { reportPackageAction } from "@/app/portal/actions";
import { reportReturnPath } from "@/lib/report-return";

/**
 * `POST /portal/report` — the report form without JavaScript (P11). The form
 * posts here when scripts are off; the report is filed through the SAME
 * server action the enhanced form calls (rate limits, database caps and the
 * research event unchanged), then the visitor is sent back (303) to the page
 * they came from, with the outcome to show next to that course.
 *
 * A cross-site post is refused (Origin must be this site when the browser
 * sends one) — server actions get that check from Next; this route does it
 * itself.
 */
export async function POST(request: Request) {
  const self = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== self.origin) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.redirect(new URL("/portal", self.origin), 303);
  }
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  const packageId = text("packageId").slice(0, 200);
  const back = text("back") || null;
  if (!packageId) return NextResponse.redirect(new URL("/portal", self.origin), 303);
  const r = await reportPackageAction(packageId, text("reason"));
  const code = r.code ?? (r.ok ? "sent" : "error");
  return NextResponse.redirect(new URL(reportReturnPath(back, packageId, code), self.origin), 303);
}
