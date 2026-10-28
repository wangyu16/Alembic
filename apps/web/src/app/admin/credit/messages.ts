/** The admin credit page's status messages, by code (only codes travel in the URL). */
export const ADMIN_CREDIT_MESSAGES = {
  "no-service": "The service key isn't configured.",
  "bad-amount": "Give an amount above 0.",
  "no-user": "No single Alembic user has that GitHub name.",
  "past-expiry": "That expiry date has passed.",
  "no-name": "Give the group a name.",
  "bad-price": "Give a price per credit in US dollars (above 0, at most 100).",
  failed: "That didn't work; the server log has the reason.",
  granted: "Credit granted.",
  "group-created": "Group created.",
  "member-added": "Added; any running group credit was given to them.",
  "group-granted": "Each member of the group got the credit.",
  "grant-ended": "Grant ended; unused credit expired.",
  "price-set": "New price in force for new purchases.",
} as const;

export type AdminCreditMessage = keyof typeof ADMIN_CREDIT_MESSAGES;
