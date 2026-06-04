import { add, dist, len, lerp, neg, normalize, scale, sub } from "../geometry/vector";
import type { Vec2 } from "../geometry/vector";
import type { Anchor, SubPath } from "./types";

export type HandleSide = "in" | "out";
export type HandleMode = "mirror" | "align" | "free";
export type AnchorType = "corner" | "smooth";

const cloneVec = (v: Vec2): Vec2 => ({ x: v.x, y: v.y });

const cloneHandle = (handle: Vec2 | null): Vec2 | null => (handle === null ? null : cloneVec(handle));

const cloneAnchor = (anchor: Anchor): Anchor => ({
  point: cloneVec(anchor.point),
  handleIn: cloneHandle(anchor.handleIn),
  handleOut: cloneHandle(anchor.handleOut),
});

const cloneSubPath = (subpath: SubPath): SubPath => ({
  closed: subpath.closed,
  anchors: subpath.anchors.map(cloneAnchor),
});

const clampedUnit = (t: number): number => Math.min(1, Math.max(0, t));

const isValidAnchorIndex = (subpath: SubPath, index: number): boolean =>
  Number.isInteger(index) && index >= 0 && index < subpath.anchors.length;

const nextIndexForSegment = (subpath: SubPath, segmentIndex: number): number | null => {
  const count = subpath.anchors.length;
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= count) {
    return null;
  }

  if (segmentIndex < count - 1) {
    return segmentIndex + 1;
  }

  return subpath.closed && count > 1 ? 0 : null;
};

const handlePoint = (anchor: Anchor, side: HandleSide): Vec2 => {
  const handle = side === "out" ? anchor.handleOut : anchor.handleIn;
  return handle === null ? anchor.point : add(anchor.point, handle);
};

const splitCubic = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number) => {
  const p01 = lerp(p0, p1, t);
  const p12 = lerp(p1, p2, t);
  const p23 = lerp(p2, p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const p0123 = lerp(p012, p123, t);

  return { p01, p23, p012, p123, p0123 };
};

const oppositeSide = (which: HandleSide): HandleSide => (which === "in" ? "out" : "in");

const getHandle = (anchor: Anchor, which: HandleSide): Vec2 | null =>
  which === "in" ? anchor.handleIn : anchor.handleOut;

const setHandle = (anchor: Anchor, which: HandleSide, value: Vec2 | null): Anchor =>
  which === "in" ? { ...anchor, handleIn: value } : { ...anchor, handleOut: value };

export const moveAnchor = (subpath: SubPath, index: number, delta: Vec2): SubPath => {
  if (!isValidAnchorIndex(subpath, index)) {
    return cloneSubPath(subpath);
  }

  return {
    closed: subpath.closed,
    anchors: subpath.anchors.map((anchor, anchorIndex) => {
      const cloned = cloneAnchor(anchor);
      return anchorIndex === index ? { ...cloned, point: add(cloned.point, delta) } : cloned;
    }),
  };
};

export const moveHandle = (
  subpath: SubPath,
  index: number,
  which: HandleSide,
  newOffset: Vec2,
  mode: HandleMode,
): SubPath => {
  if (!isValidAnchorIndex(subpath, index)) {
    return cloneSubPath(subpath);
  }

  return {
    closed: subpath.closed,
    anchors: subpath.anchors.map((anchor, anchorIndex) => {
      let nextAnchor = cloneAnchor(anchor);
      if (anchorIndex !== index) {
        return nextAnchor;
      }

      nextAnchor = setHandle(nextAnchor, which, cloneVec(newOffset));
      const opposite = oppositeSide(which);

      if (mode === "mirror") {
        return setHandle(nextAnchor, opposite, neg(newOffset));
      }

      if (mode === "align") {
        const currentOpposite = getHandle(anchor, opposite);
        if (currentOpposite === null) {
          return nextAnchor;
        }

        const newLength = len(newOffset);
        const oppositeLength = len(currentOpposite);
        const aligned =
          newLength === 0 ? { x: 0, y: 0 } : scale(normalize(newOffset), -oppositeLength);
        return setHandle(nextAnchor, opposite, aligned);
      }

      return nextAnchor;
    }),
  };
};

export const insertAnchor = (subpath: SubPath, segmentIndex: number, t: number): SubPath => {
  const nextIndex = nextIndexForSegment(subpath, segmentIndex);
  if (nextIndex === null) {
    return cloneSubPath(subpath);
  }

  const start = subpath.anchors[segmentIndex]!;
  const end = subpath.anchors[nextIndex]!;
  const splitT = clampedUnit(t);
  const anchors = subpath.anchors.map(cloneAnchor);

  if (start.handleOut === null && end.handleIn === null) {
    const inserted: Anchor = {
      point: lerp(start.point, end.point, splitT),
      handleIn: null,
      handleOut: null,
    };
    anchors.splice(segmentIndex + 1, 0, inserted);
    return { closed: subpath.closed, anchors };
  }

  const p0 = start.point;
  const p1 = handlePoint(start, "out");
  const p2 = handlePoint(end, "in");
  const p3 = end.point;
  const { p01, p23, p012, p123, p0123 } = splitCubic(p0, p1, p2, p3, splitT);

  anchors[segmentIndex] = {
    ...anchors[segmentIndex]!,
    handleOut: sub(p01, p0),
  };
  anchors[nextIndex] = {
    ...anchors[nextIndex]!,
    handleIn: sub(p23, p3),
  };

  const inserted: Anchor = {
    point: p0123,
    handleIn: sub(p012, p0123),
    handleOut: sub(p123, p0123),
  };
  anchors.splice(segmentIndex + 1, 0, inserted);

  return { closed: subpath.closed, anchors };
};

export const deleteAnchor = (subpath: SubPath, index: number): SubPath => {
  if (!isValidAnchorIndex(subpath, index)) {
    return cloneSubPath(subpath);
  }

  return {
    closed: subpath.closed,
    anchors: subpath.anchors.filter((_, anchorIndex) => anchorIndex !== index).map(cloneAnchor),
  };
};

export const setAnchorType = (subpath: SubPath, index: number, type: AnchorType): SubPath => {
  if (!isValidAnchorIndex(subpath, index)) {
    return cloneSubPath(subpath);
  }

  return {
    closed: subpath.closed,
    anchors: subpath.anchors.map((anchor, anchorIndex) => {
      const cloned = cloneAnchor(anchor);
      if (anchorIndex !== index) {
        return cloned;
      }

      if (type === "corner") {
        return { ...cloned, handleIn: null, handleOut: null };
      }

      const previous =
        index > 0
          ? subpath.anchors[index - 1]!
          : subpath.closed
            ? subpath.anchors[subpath.anchors.length - 1]!
            : null;
      const next =
        index < subpath.anchors.length - 1
          ? subpath.anchors[index + 1]!
          : subpath.closed
            ? subpath.anchors[0]!
            : null;

      if (previous !== null && next !== null) {
        const tangent = normalize(sub(next.point, previous.point));
        return {
          ...cloned,
          handleIn: scale(tangent, -dist(anchor.point, previous.point) / 3),
          handleOut: scale(tangent, dist(anchor.point, next.point) / 3),
        };
      }

      if (previous !== null) {
        const tangent = normalize(sub(anchor.point, previous.point));
        return {
          ...cloned,
          handleIn: scale(tangent, -dist(anchor.point, previous.point) / 3),
          handleOut: null,
        };
      }

      if (next !== null) {
        const tangent = normalize(sub(next.point, anchor.point));
        return {
          ...cloned,
          handleIn: null,
          handleOut: scale(tangent, dist(anchor.point, next.point) / 3),
        };
      }

      return { ...cloned, handleIn: null, handleOut: null };
    }),
  };
};
