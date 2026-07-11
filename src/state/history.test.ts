import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_DEPTH,
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from "./history";

describe("history", () => {
  it("creates an empty history at the default depth", () => {
    const history = createHistory<number>();
    expect(history.past).toEqual([]);
    expect(history.future).toEqual([]);
    expect(history.depth).toBe(DEFAULT_HISTORY_DEPTH);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  it("pushes snapshots onto the past and clears the redo future", () => {
    let history = createHistory<string>();
    history = pushHistory(history, "a");
    history = pushHistory(history, "b");
    expect(history.past).toEqual(["a", "b"]);
    expect(canUndo(history)).toBe(true);

    // A push after an undo drops the redo stack.
    const undone = undoHistory(history, "current");
    expect(undone.history.future).toEqual(["current"]);
    const repushed = pushHistory(undone.history, "c");
    expect(repushed.future).toEqual([]);
  });

  it("returns a null snapshot when there is nothing to undo or redo", () => {
    const history = createHistory<number>();
    expect(undoHistory(history, 1)).toEqual({ history, snapshot: null });
    expect(redoHistory(history, 1)).toEqual({ history, snapshot: null });
  });

  it("undo pops the last snapshot and moves current onto the future", () => {
    let history = createHistory<string>();
    history = pushHistory(history, "s1");
    history = pushHistory(history, "s2");

    const step = undoHistory(history, "live");
    expect(step.snapshot).toBe("s2");
    expect(step.history.past).toEqual(["s1"]);
    expect(step.history.future).toEqual(["live"]);
    expect(canRedo(step.history)).toBe(true);
  });

  it("redo pops the future and pushes current back onto the past", () => {
    let history = createHistory<string>();
    history = pushHistory(history, "s1");
    const undone = undoHistory(history, "live");

    const redone = redoHistory(undone.history, undone.snapshot!);
    expect(redone.snapshot).toBe("live");
    expect(redone.history.past).toEqual(["s1"]);
    expect(redone.history.future).toEqual([]);
  });

  it("supports a full undo→redo round trip preserving order", () => {
    let history = createHistory<number>();
    history = pushHistory(history, 1);
    history = pushHistory(history, 2);
    history = pushHistory(history, 3);

    // Undo twice.
    const u1 = undoHistory(history, 4);
    const u2 = undoHistory(u1.history, u1.snapshot!);
    expect(u2.snapshot).toBe(2);
    expect(u2.history.past).toEqual([1]);
    expect(u2.history.future).toEqual([3, 4]);

    // Redo twice returns to the original past order.
    const r1 = redoHistory(u2.history, u2.snapshot!);
    const r2 = redoHistory(r1.history, r1.snapshot!);
    expect(r2.snapshot).toBe(4);
    expect(r2.history.past).toEqual([1, 2, 3]);
    expect(r2.history.future).toEqual([]);
  });

  it("caps the past at the configured depth, dropping the oldest entries", () => {
    let history = createHistory<number>(3);
    for (let i = 1; i <= 5; i += 1) {
      history = pushHistory(history, i);
    }
    // Only the 3 most recent snapshots survive.
    expect(history.past).toEqual([3, 4, 5]);
  });

  it("restores the future snapshot on redo and stays within depth", () => {
    let history = createHistory<number>(2);
    history = pushHistory(history, 1);
    history = pushHistory(history, 2);
    const undone = undoHistory(history, 3); // past [1], future [3], snapshot 2
    // The live state being left behind on redo is the snapshot undo restored (2).
    const redone = redoHistory(undone.history, 2);
    expect(redone.snapshot).toBe(3);
    expect(redone.history.past).toEqual([1, 2]);
    expect(redone.history.future).toEqual([]);
    expect(redone.history.past.length).toBeLessThanOrEqual(2);
  });

  it("caps the past during redo when it would exceed depth", () => {
    // Construct a history whose past is already at depth with a pending future.
    const history = { past: [1, 2], future: [9], depth: 2 };
    const redone = redoHistory(history, 3);
    // Pushing current (3) → [1, 2, 3] capped at the 2 most recent → [2, 3].
    expect(redone.history.past).toEqual([2, 3]);
    expect(redone.snapshot).toBe(9);
    expect(redone.history.future).toEqual([]);
  });
});
