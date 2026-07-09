import { describe, it, expect } from "vitest";
import { DEFAULT_ROUTING } from "@alembic/ai-assist";
import { CHANGE_KINDS } from "@alembic/package-contract";
import { EVENT_TYPES } from "@alembic/research-events";
import { OPERATION_CATEGORIES } from "./operation";
import { AI_OPERATIONS, operationsForCategory, operationById } from "./registry";

describe("AI operations registry", () => {
  it("has unique ids", () => {
    const ids = AI_OPERATIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every routingKind is a known ai-assist task key (model routing resolves)", () => {
    const keys = new Set(Object.keys(DEFAULT_ROUTING.byTask ?? {}));
    for (const op of AI_OPERATIONS) {
      expect(keys.has(op.routingKind), `${op.id} → routingKind "${op.routingKind}"`).toBe(true);
    }
  });

  it("every changeKind is a valid ChangeKind (tier/audit/apply resolves)", () => {
    for (const op of AI_OPERATIONS) {
      expect(CHANGE_KINDS, op.id).toContain(op.changeKind);
    }
  });

  it("every event is a valid EventType", () => {
    for (const op of AI_OPERATIONS) {
      expect(EVENT_TYPES, op.id).toContain(op.event);
    }
  });

  it("appliesTo categories are valid", () => {
    for (const op of AI_OPERATIONS) {
      if (op.appliesTo === "*") continue;
      for (const c of op.appliesTo) {
        expect(OPERATION_CATEGORIES, `${op.id} → ${c}`).toContain(c);
      }
    }
  });

  it("edit-mode ops carry a canonical instruction", () => {
    for (const op of AI_OPERATIONS.filter((o) => o.mode === "edit")) {
      expect(op.instruction, op.id).toBeTruthy();
    }
  });

  it("every op declares a surface", () => {
    for (const op of AI_OPERATIONS) {
      expect(["assistant", "panel"], op.id).toContain(op.surface);
    }
  });

  it("offers the universal aids on every page and scopes course-only ops", () => {
    const course = operationsForCategory("course").map((o) => o.id);
    expect(course).toContain("check-spelling-grammar");
    expect(course).toContain("improve-language");
    expect(course).toContain("check-accessibility");
    expect(course).toContain("generate-concept-map");

    const content = operationsForCategory("content").map((o) => o.id);
    expect(content).toContain("improve-language");
    expect(content).toContain("enrich-formatting");
    expect(content).not.toContain("generate-concept-map");
  });

  it("scopes the format-aware layout ops to their format", () => {
    expect(operationsForCategory("slides").map((o) => o.id)).toContain("suggest-slide-layout");
    expect(operationsForCategory("paged").map((o) => o.id)).toContain("suggest-page-settings");
    // format ops don't bleed across formats
    expect(operationsForCategory("slides").map((o) => o.id)).not.toContain("suggest-page-settings");
    expect(operationsForCategory("content").map((o) => o.id)).not.toContain("suggest-slide-layout");
  });

  it("gates generate-concept-map until concept maps are ready or a draft is provided", () => {
    const op = operationById("generate-concept-map");
    expect(op?.gate?.({})).toEqual(expect.any(String));
    expect(op?.gate?.({ conceptMapsReady: true })).toBe(true);
    expect(op?.gate?.({ draftProvided: true })).toBe(true);
  });

  it("resolves and misses by id", () => {
    expect(operationById("check-accessibility")?.mode).toBe("edit");
    expect(operationById("does-not-exist")).toBeUndefined();
  });
});
