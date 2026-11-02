import { describe, expect, it } from "vitest";
import { classifyOutside } from "@alembic/package-ops";
import { CompareIncompleteError } from "@alembic/github-bridge";
import { changedBetween, EDITED_ITEMS_MAX, editedItems } from "./door-c-loop";

const tree = (files: Record<string, string>) => ({ entries: Object.entries(files).map(([path, sha]) => ({ path, mode: "100644", type: "blob", sha })), truncated: false });

describe("Door C at real-course size", () => {
  it("[RC.7] a push of more than 300 files is compared tree to tree (GitHub's compare can't list it), so forbidden content in it is still found", async () => {
    const before: Record<string, string> = { "study-guide/a.md": "s1" };
    const after: Record<string, string> = { "study-guide/a.md": "s2", ".alembic/injected.json": "x" };
    for (let k = 0; k < 330; k++) after[`assets/fig-${k}.png`] = `b${k}`;
    const client = {
      async compareCommits(): Promise<never> { throw new CompareIncompleteError("too-many-files"); },
      async listTreeEntries(_c: unknown, ref: string) { return tree(ref === "B" ? before : after); },
    };
    const changed = await changedBetween(client as never, { owner: "o", repo: "r" }, "B", "A");
    expect(changed.length).toBe(332);
    expect(changed).toContainEqual({ path: "study-guide/a.md", status: "modified" });
    const verdict = classifyOutside(changed.map((c) => ({ path: c.path, mode: "100644" })));
    expect(verdict.undo.map((u) => u.path)).toEqual([".alembic/injected.json"]);
  });

  it("[RC.7] more than EDITED_ITEMS_MAX edited files raise one item naming the count, not one item per file", () => {
    const edits = Array.from({ length: 280 }, (_, k) => `study-guide/ch${k}.md`);
    const items = editedItems(edits, new Map(edits.map((p) => [p, "added"])), "yu", "A");
    expect(items).toHaveLength(1);
    expect(items[0]!.payload["title"]).toBe("280 files were changed on GitHub by yu");
    expect(editedItems(edits.slice(0, EDITED_ITEMS_MAX), new Map(), "yu", "A")).toHaveLength(EDITED_ITEMS_MAX);
  });
});
