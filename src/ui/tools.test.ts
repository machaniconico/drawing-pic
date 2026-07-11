import { describe, expect, it } from "vitest";
import { TOOL_DEFS } from "./tools";

describe("TOOL_DEFS", () => {
  it("defines at least the core tools with non-empty fields", () => {
    expect(TOOL_DEFS.length).toBeGreaterThanOrEqual(5);
    for (const tool of TOOL_DEFS) {
      expect(tool.id).toBeTruthy();
      expect(tool.label).toBeTruthy();
      expect(tool.shortcut).toBeTruthy();
      expect(tool.icon).toBeTruthy();
    }
  });

  it("has unique ids so tool selection is unambiguous", () => {
    const ids = TOOL_DEFS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique single-letter shortcuts so keybindings do not collide", () => {
    const shortcuts = TOOL_DEFS.map((tool) => tool.shortcut.toLowerCase());
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    for (const shortcut of shortcuts) {
      expect(shortcut).toHaveLength(1);
    }
  });
});
