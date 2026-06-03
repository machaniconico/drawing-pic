export interface History<T> {
  readonly past: T[];
  readonly future: T[];
  readonly depth: number;
}

export interface HistoryStep<T> {
  readonly history: History<T>;
  readonly snapshot: T | null;
}

export const DEFAULT_HISTORY_DEPTH = 100;

export const createHistory = <T>(depth = DEFAULT_HISTORY_DEPTH): History<T> => ({
  past: [],
  future: [],
  depth,
});

export const canUndo = <T>(history: History<T>): boolean => history.past.length > 0;

export const canRedo = <T>(history: History<T>): boolean => history.future.length > 0;

export const pushHistory = <T>(history: History<T>, snapshot: T): History<T> => ({
  ...history,
  past: [...history.past, snapshot].slice(-history.depth),
  future: [],
});

export const undoHistory = <T>(history: History<T>, current: T): HistoryStep<T> => {
  if (!canUndo(history)) {
    return { history, snapshot: null };
  }

  const past = history.past.slice(0, -1);
  const snapshot = history.past.at(-1) ?? null;

  return {
    history: {
      ...history,
      past,
      future: [current, ...history.future],
    },
    snapshot,
  };
};

export const redoHistory = <T>(history: History<T>, current: T): HistoryStep<T> => {
  if (!canRedo(history)) {
    return { history, snapshot: null };
  }

  const [snapshot = null, ...future] = history.future;

  return {
    history: {
      ...history,
      past: [...history.past, current].slice(-history.depth),
      future,
    },
    snapshot,
  };
};
