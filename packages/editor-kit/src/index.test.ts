import { describe, expect, it, vi } from "vitest";
import {
  EditorRegistry,
  type EditorContext,
  type EditorHandle,
  type EditorModule,
} from "./index";

function fakeModule(kind: string): EditorModule {
  return {
    kind,
    label: kind,
    mount(_el: HTMLElement, ctx: EditorContext): EditorHandle {
      const source = ctx.source;
      return {
        getSource: () => source,
        renderPayload: () => `<${kind}>${source}</${kind}>`,
        destroy: () => {},
      };
    },
  };
}

describe("EditorRegistry", () => {
  it("registers and looks up modules by carrier kind", () => {
    const reg = new EditorRegistry().register(fakeModule("ketcher")).register(fakeModule("plot"));
    expect(reg.has("ketcher")).toBe(true);
    expect(reg.get("plot")?.label).toBe("plot");
    expect(reg.get("missing")).toBeUndefined();
    expect(reg.list().map((m) => m.kind).sort()).toEqual(["ketcher", "plot"]);
  });

  it("a module mounts and the host receives push edits via onChange", () => {
    const reg = new EditorRegistry().register({
      kind: "md",
      label: "Markdown",
      mount(_el, ctx) {
        // simulate an edit
        ctx.onChange({ source: ctx.source + "!", rendered: "<p/>" });
        return { getSource: () => ctx.source + "!", destroy: () => {} };
      },
    });
    const onChange = vi.fn();
    const handle = reg.get("md")!.mount(null as unknown as HTMLElement, {
      source: "hi",
      onChange,
    });
    expect(onChange).toHaveBeenCalledWith({ source: "hi!", rendered: "<p/>" });
    expect(handle.getSource()).toBe("hi!");
  });
});
