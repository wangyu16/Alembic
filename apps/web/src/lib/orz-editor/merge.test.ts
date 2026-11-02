import { describe, expect, it } from "vitest";
import { mergeRemote } from "./merge";

const base = "# Title\n\nFirst paragraph.\n\nMiddle paragraph.\n\nLast paragraph.\n";

describe("mergeRemote", () => {
  it("takes the remote text when nothing changed locally", () => {
    const remote = base.replace("Last", "Final");
    expect(mergeRemote(base, base, remote)).toEqual({ applied: true, text: remote });
  });
  it("applies a remote change after the local one", () => {
    const local = base.replace("First paragraph.", "First paragraph, typed here.");
    const remote = base.replace("Last paragraph.", "Last paragraph, from a co-author.");
    expect(mergeRemote(base, local, remote)).toEqual({ applied: true, text: base.replace("First paragraph.", "First paragraph, typed here.").replace("Last paragraph.", "Last paragraph, from a co-author.") });
  });
  it("applies a remote change before the local one", () => {
    const local = base.replace("Last paragraph.", "Last paragraph, typed here.");
    const remote = base.replace("# Title", "# New title");
    expect(mergeRemote(base, local, remote)).toEqual({ applied: true, text: local.replace("# Title", "# New title") });
  });
  it("leaves the screen alone when both changed the same place", () => {
    const local = base.replace("Middle paragraph.", "Middle, mine.");
    const remote = base.replace("Middle paragraph.", "Middle, theirs.");
    expect(mergeRemote(base, local, remote)).toEqual({ applied: false, reason: "same-place" });
  });
  it("is a no-op when the remote equals the local text (our own sync coming back)", () => {
    const local = base.replace("First", "Opening");
    expect(mergeRemote(base, local, local)).toEqual({ applied: true, text: local });
  });
});
