/** The contact form's fixed lists and limits (no server imports: the form, a client component, uses them too). */

/** The visitor's own pick. Values are stored; labels are shown. */
export const CONTACT_TOPICS = [
  { value: "using", label: "Using Alembic" },
  { value: "problem", label: "Something isn't working" },
  { value: "workshops", label: "Workshops" },
  { value: "institution", label: "Using Alembic at my institution" },
  { value: "other", label: "Something else" },
] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number]["value"];

export const topicLabel = (v: string): string => CONTACT_TOPICS.find((t) => t.value === v)?.label ?? v;

export const LIMITS = { name: 120, email: 200, message: 4000, page: 300 } as const;
/** The hidden field people never see; automated form fillers do. */
export const HONEYPOT_FIELD = "website";
