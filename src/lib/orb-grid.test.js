import test from "node:test";
import assert from "node:assert/strict";
import { orbGrid, MAX_ORB_SIZE } from "./orb-grid.js";

test("orbGrid: never more columns than the busiest floor has areas, so rows end flush", () => {
  const { cols, gap, size } = orbGrid(780, 4);
  assert.equal(cols, 4);
  assert.equal(size * cols + gap * (cols - 1) <= 780, true);
  assert.equal(780 - (size * cols + gap * (cols - 1)) < cols, true);
});

test("orbGrid: a narrow phone fits three tiles at the minimum size", () => {
  assert.deepEqual(orbGrid(354, 4), { cols: 3, gap: 18, size: 106 });
});

test("orbGrid: tiles grow with the width but stop at the maximum size", () => {
  const small = orbGrid(600, 4);
  const big = orbGrid(1280, 4);
  assert.ok(big.size > small.size);
  assert.equal(orbGrid(1600, 2).size, MAX_ORB_SIZE);
});

test("orbGrid: gaps scale with the width between 18 and 48px", () => {
  assert.equal(orbGrid(300, 3).gap, 18);
  assert.equal(orbGrid(1000, 3).gap, 35);
  assert.equal(orbGrid(3000, 3).gap, 48);
});

test("orbGrid: an empty floor list still yields one column", () => {
  assert.equal(orbGrid(500, 0).cols, 1);
});
