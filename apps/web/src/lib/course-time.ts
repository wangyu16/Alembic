/** Times on course pages, in the course's time zone (RC.24: the server runs in UTC). One zone for now: the testing site's. */
export const COURSE_TIME_ZONE = "America/Chicago";
export function courseTime(at: string | number | Date): string {
  return new Date(at).toLocaleString("en-US", { timeZone: COURSE_TIME_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}
