import "server-only";
import { cookies } from "next/headers";
import type { RenderTheme } from "@alembic/renderer";

/** Cookie holding the user's chosen UI + render theme. Default is dark. */
export const THEME_COOKIE = "alembic-theme";

/**
 * The selected render theme, read from the cookie (server-side). Drives both
 * the app chrome (`<html data-theme>`) and orz-markdown rendered output
 * (dark-elegant by default, light-neat when "light"). Anything but "light"
 * resolves to "dark" so a missing/garbage cookie is safe.
 */
export async function getRenderTheme(): Promise<RenderTheme> {
  const store = await cookies();
  return store.get(THEME_COOKIE)?.value === "light" ? "light" : "dark";
}
