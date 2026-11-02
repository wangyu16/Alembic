import { describe, expect, it } from "vitest";
import { newWorkshopCode, normalizeWorkshopCode, workshopCodeHash } from "./workshop";

describe("workshop codes", () => {
  it("new codes normalise back to themselves and differ", () => {
    const a = newWorkshopCode();
    expect(a).toMatch(/^WKS-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}$/);
    expect(normalizeWorkshopCode(a)).toBe(a.replace(/^WKS-/, "").replace(/-/g, ""));
    expect(newWorkshopCode()).not.toBe(a);
  });
  it("typing is forgiving: case, spaces, dashes, O/0 and I/L/1", () => {
    expect(normalizeWorkshopCode("wks 7kq2 xm4p 9a")).toBe("7KQ2XM4P9A");
    expect(normalizeWorkshopCode("7KQ2-XM4P-9A")).toBe("7KQ2XM4P9A");
    expect(normalizeWorkshopCode("OOOO-IIII-LL")).toBe("0000111111");
    expect(normalizeWorkshopCode("too-short")).toBeNull();
    expect(normalizeWorkshopCode("WKSA123456")).toBe("WKSA123456"); // a body that starts like the prefix
    expect(normalizeWorkshopCode("7KQ2-XM4P-9U")).toBeNull(); // U isn't in the alphabet
  });
  it("the stored hash depends on the server secret", () => {
    expect(workshopCodeHash("7KQ2XM4P9A", "s1")).toMatch(/^[0-9a-f]{64}$/);
    expect(workshopCodeHash("7KQ2XM4P9A", "s1")).not.toBe(workshopCodeHash("7KQ2XM4P9A", "s2"));
  });
});
