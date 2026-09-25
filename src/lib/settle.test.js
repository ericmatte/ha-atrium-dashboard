import test from "node:test";
import assert from "node:assert/strict";
import { settleStep } from "./settle.js";

const opts = { stableMs: 800, maxMs: 8000 };
const run = (samples) => {
  let state = null;
  for (const [t, sample] of samples) {
    const r = settleStep(state, sample, t, opts);
    state = r.state;
    if (r.done) return t;
  }
  return null;
};

test("settleStep: done once it has changed and then held still long enough", () => {
  assert.equal(run([[0, "a"], [250, "a"], [500, "b"], [750, "c"], [1000, "c"], [1250, "c"], [1500, "c"], [1750, "c"]]), 1750);
});

test("settleStep: never done while it keeps changing (until the cap)", () => {
  const samples = Array.from({ length: 40 }, (_, i) => [i * 250, String(i)]);
  assert.equal(run(samples), 8000);
});

test("settleStep: something that never changes is only settled at the cap", () => {
  const samples = Array.from({ length: 40 }, (_, i) => [i * 250, "same"]);
  assert.equal(run(samples), 8000);
});
