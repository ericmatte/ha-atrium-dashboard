// Decides when something that's changing has settled, from samples taken on
// a timer: done once the sample has changed at least once and then held
// still for `stableMs` — or at `maxMs` regardless (e.g. it never changed).
// Pure: the caller owns the timer and the clock.
export function settleStep(state, sample, now, { stableMs, maxMs }) {
  if (!state) return { state: { start: now, first: sample, last: sample, lastChangeAt: now, changed: false }, done: false };
  const next = { ...state };
  if (sample !== state.last) {
    next.last = sample;
    next.lastChangeAt = now;
    next.changed = next.changed || sample !== state.first;
  }
  const done = (next.changed && now - next.lastChangeAt >= stableMs) || now - next.start >= maxMs;
  return { state: next, done };
}
