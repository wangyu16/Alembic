/**
 * Who may do what in a course — docs/specs/v3/permissions-v3.md §3,
 * mirroring the design's permission matrix (ALEMBIC-WORKSPACE-DESIGN.md
 * §2.2, "the only authority"). Pure: the server resolves the role, then asks.
 */

import { isHarnessPath, isServerOnlyPath, normalizePath, spaceForPathV3 } from "./contract-v3";
import { activeProfile, type PathClass } from "./profile";

export const ROLES = ["owner", "deputy", "co-author", "agent", "operator", "none"] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  "edit.materials",
  "edit.plan",
  "edit.private",
  "delete.private", // delete or move out of private/ (contract v3 §11.6)
  "edit.course-files",
  "approve.plan",
  "publish.first",
  "publish.later",
  "publish.anyway",
  "list",
  "list.moderate",
  "share",
  "share.moderate",
  "license.change",
  "members.manage", // invite, remove, name a deputy
  "member.leave",
  "source.upload",
  "source.see-file",
  "source.use-ai",
  "source.see-pointer",
  "agent.answer",
  "correction.keep-undo",
  "finding.fix",
  "obligation.confirm",
  "both-changed.decide",
  "edited-elsewhere.accept-undo",
  "suggestion.decide",
  "update.take",
  "history.restore-doc",
  "snapshot.create",
  "snapshot.restore-course",
  "steering.change",
  "steering.propose",
  "coursewerk.update",
  "handout",
  "transfer",
  "transfer.succession",
  "archive",
  "agent.talk",
  "history.see",
  "audit.view",
  "github.direct",
  "allowance.fund",
  "allowance.grant",
] as const;
export type Action = (typeof ACTIONS)[number];

export interface AccessContext {
  /** The caller (for uploader and addressed-to checks). */
  actorId?: string;
  /** Path being edited (edit.* and edited-elsewhere checks). */
  path?: string;
  /** source.see-file / source.use-ai */
  uploaderId?: string;
  sharedWithCourse?: boolean;
  aiAllowed?: boolean;
  /** both-changed.decide: who the item is addressed to. */
  addressedTo?: readonly string[];
  /** github.direct: the owner added this member as a GitHub collaborator. */
  githubCollaborator?: boolean;
}

type Rule = boolean | ((ctx: AccessContext) => boolean);
const Y = true;
const N = false;

const isUploaderOrShared = (c: AccessContext) =>
  (c.actorId !== undefined && c.actorId === c.uploaderId) || c.sharedWithCourse === true;
const isAddressed = (c: AccessContext) => c.actorId !== undefined && (c.addressedTo ?? []).includes(c.actorId);
const isMaterialsPath = (c: AccessContext) => c.path !== undefined && editActionForPath(c.path) === "edit.materials";

/** The matrix. Every action has an entry for every role (tested). */
export const ACCESS_MATRIX: Readonly<Record<Action, Readonly<Record<Role, Rule>>>> = {
  "edit.materials":            { owner: Y, deputy: Y, "co-author": Y, agent: Y, operator: N, none: N },
  "edit.plan":                 { owner: Y, deputy: Y, "co-author": Y, agent: Y, operator: N, none: N },
  "edit.private":              { owner: Y, deputy: Y, "co-author": Y, agent: Y, operator: N, none: N },
  "delete.private":            { owner: Y, deputy: Y, "co-author": N, agent: N, operator: N, none: N },
  "edit.course-files":         { owner: Y, deputy: Y, "co-author": N, agent: N, operator: N, none: N },
  "approve.plan":              { owner: Y, deputy: Y, "co-author": N, agent: N, operator: N, none: N },
  "publish.first":             { owner: Y, deputy: N, "co-author": N, agent: N, operator: N, none: N },
  "publish.later":             { owner: Y, deputy: Y, "co-author": N, agent: N, operator: N, none: N },
  "publish.anyway":            { owner: Y, deputy: Y, "co-author": N, agent: N, operator: N, none: N },
  list:                        { owner: Y, deputy: N, "co-author": N, agent: N, operator: N, none: N },
  "list.moderate":             { owner: N, deputy: N, "co-author": N, agent: N, operator: Y, none: N },
  share:                       { owner: Y, deputy: N, "co-author": N, agent: N, operator: N, none: N },
  "share.moderate":            { owner: N, deputy: N, "co-author": N, agent: N, operator: Y, none: N },
  "license.change":            { owner: Y, deputy: N, "co-author": N, agent: N, operator: N, none: N },
  "members.manage":            { owner: Y, deputy: N, "co-author": N, agent: N, operator: N, none: N },
  "member.leave":              { owner: N, deputy: Y, "co-author": Y, agent: N, operator: N, none: N },
  "source.upload":             { owner: Y, deputy: Y, "co-author": Y, agent: N, operator: N, none: N },
  "source.see-file":           { owner: isUploaderOrShared, deputy: isUploaderOrShared, "co-author": isUploaderOrShared, agent: N, operator: N, none: N },
  "source.use-ai":             { owner: N, deputy: N, "co-author": N, agent: (c) => c.aiAllowed === true, operator: N, none: N },
  "source.see-pointer":        { owner: Y, deputy: Y, "co-author": Y, agent: Y, operator: N, none: N },
  "agent.answer":              { owner: Y, deputy: Y, "co-author": Y, agent: N, operator: N, none: N },
  "correction.keep-undo":      { owner: Y, deputy: Y, "co-author": Y, agent: N, operator: N, none: N },
  "finding.fix":               { owner: Y, deputy: Y, "co-author": Y, agent: Y, operator: N, none: N },
  "obligation.confirm":        { owner: Y, deputy: Y, "co-author": N, agent: N, operator: N, none: N },
  "both-changed.decide":       { owner: Y, deputy: Y, "co-author": isAddressed, agent: N, operator: N, none: N },
  "edited-elsewhere.accept-undo": { owner: Y, deputy: Y, "co-author": isMaterialsPath, agent: N, operator: N, none: N },
  "suggestion.decide":         { owner: Y, deputy: Y, "co-author": N, agent: N, operator: N, none: N },
  "update.take":               { owner: Y, deputy: Y, "co-author": N, agent: N, operator: N, none: N },
  "history.restore-doc":       { owner: Y, deputy: Y, "co-author": Y, agent: N, operator: N, none: N },
  "snapshot.create":           { owner: Y, deputy: Y, "co-author": Y, agent: N, operator: N, none: N },
  "snapshot.restore-course":   { owner: Y, deputy: N, "co-author": N, agent: N, operator: N, none: N },
  "steering.change":           { owner: Y, deputy: Y, "co-author": N, agent: N, operator: N, none: N },
  "steering.propose":          { owner: Y, deputy: Y, "co-author": Y, agent: Y, operator: N, none: N },
  "coursewerk.update":         { owner: Y, deputy: N, "co-author": N, agent: N, operator: N, none: N },
  handout:                     { owner: Y, deputy: N, "co-author": N, agent: N, operator: N, none: N },
  transfer:                    { owner: Y, deputy: N, "co-author": N, agent: N, operator: N, none: N },
  "transfer.succession":       { owner: N, deputy: N, "co-author": N, agent: N, operator: Y, none: N },
  archive:                     { owner: Y, deputy: N, "co-author": N, agent: N, operator: N, none: N },
  "agent.talk":                { owner: Y, deputy: Y, "co-author": Y, agent: N, operator: N, none: N },
  "history.see":               { owner: Y, deputy: Y, "co-author": Y, agent: N, operator: N, none: N },
  "audit.view":                { owner: N, deputy: N, "co-author": N, agent: N, operator: Y, none: N },
  "github.direct":             { owner: Y, deputy: (c) => c.githubCollaborator === true, "co-author": (c) => c.githubCollaborator === true, agent: N, operator: N, none: N },
  "allowance.fund":            { owner: Y, deputy: N, "co-author": N, agent: N, operator: N, none: N },
  "allowance.grant":           { owner: N, deputy: N, "co-author": N, agent: N, operator: Y, none: N },
};

/** May `role` perform `action`? */
export function can(role: Role, action: Action, ctx: AccessContext = {}): boolean {
  const rule = ACCESS_MATRIX[action][role];
  return typeof rule === "function" ? rule(ctx) : rule;
}

/**
 * The course agent never has more rights than the person who started its
 * job (permissions §3): agent ∩ invoker. Automatic jobs use the owner.
 */
export function canAgent(invoker: Role, action: Action, ctx: AccessContext = {}): boolean {
  // Agent-only actions (no human row grants them) are capped by membership
  // instead: the invoker must be a course member who can see the source's
  // pointer (G1 F5).
  if (action === "source.use-ai") return can("agent", action, ctx) && can(invoker, "source.see-pointer", ctx);
  return can("agent", action, ctx) && can(invoker, action, ctx);
}

/**
 * Which edit action a write to `path` needs, or `null` if no user, editor or
 * agent write may touch it at all (server-generated files, source pointers,
 * Coursewerk records, the manifest — those have their own paths).
 */
export function editActionForPath(path: string): "edit.materials" | "edit.plan" | "edit.private" | "edit.course-files" | null {
  const p = normalizePath(path);
  // The core's own mechanics files (Alembic's, FD-09): server-generated, harness records, the licence files.
  if (isServerOnlyPath(p) || isHarnessPath(p)) return null;
  if (p === "LICENSE" || p === "CITATION.cff") return null;
  // Everything else is classified by the content profile (FD-10), then mapped to a permission here.
  return ACTION_FOR_CLASS[activeProfile.pathClass(p, spaceForPathV3(p))];
}

/** The core's permission for each class of path a profile names. */
const ACTION_FOR_CLASS: Record<PathClass, "edit.materials" | "edit.plan" | "edit.private" | "edit.course-files" | null> = {
  material: "edit.materials",
  plan: "edit.plan",
  "project-file": "edit.course-files",
  "private-editable": "edit.private",
  "private-protected": null,
  settings: null, // only through course operations (contract v3 §13)
};

/** Convenience: may `role` write `path` (with the agent capped by its invoker)? */
export function canWritePath(role: Role, path: string, opts: { invoker?: Role } = {}): boolean {
  const action = editActionForPath(path);
  if (action === null) return false;
  return role === "agent" ? canAgent(opts.invoker ?? "none", action, { path }) : can(role, action, { path });
}
