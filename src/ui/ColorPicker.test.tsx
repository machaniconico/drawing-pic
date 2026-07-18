import { describe, expect, it } from "vitest";
import { resolveHexBlur } from "./ColorPicker";

describe("ColorPicker hex commits", () => {
  const current = { r: 12, g: 34, b: 56, a: 0.5 };

  it("canonicalizes a valid draft only when it is committed", () => {
    expect(resolveHexBlur("1a80ff", current, true)).toEqual({
      color: { r: 26, g: 128, b: 255, a: 1 },
      draft: "#1a80ffff",
    });
  });

  it("restores the current color when the committed draft is invalid", () => {
    expect(resolveHexBlur("#not-hex", current, true)).toEqual({
      color: null,
      draft: "#0c223880",
    });
  });

  it("resyncs to a newer external value when focus ends without edits", () => {
    expect(resolveHexBlur("#ffffffff", current, false)).toEqual({
      color: null,
      draft: "#0c223880",
    });
  });
});
