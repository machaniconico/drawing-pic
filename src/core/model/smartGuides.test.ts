import { describe, expect, it } from "vitest";
import { computeSnap as canonicalComputeSnap } from "./snapping";
import { computeSnap } from "./smartGuides";

describe("smart guide compatibility", () => {
  it("re-exports the canonical snapping implementation", () => {
    expect(computeSnap).toBe(canonicalComputeSnap);
  });
});
