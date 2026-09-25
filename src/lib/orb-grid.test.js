import test from "node:test";
import assert from "node:assert/strict";
import { orbGrid, MAX_ORB_SIZE, badgeScale, orbBadge } from "./orb-grid.js";

test("orbGrid: never more columns than the busiest floor has areas, so rows end flush", () => {
  const { cols, gap, size } = orbGrid(640, 4);
  assert.equal(cols, 4);
  assert.equal(size * cols + gap * (cols - 1) <= 640, true);
  assert.equal(640 - (size * cols + gap * (cols - 1)) < cols, true);
});

test("orbGrid: a narrow phone fits three tiles at the minimum size", () => {
  assert.deepEqual(orbGrid(354, 4), { cols: 3, gap: 24, size: 102 });
});

test("orbGrid: tiles grow with the width but stop at the maximum size", () => {
  const small = orbGrid(400, 4);
  const big = orbGrid(700, 4);
  assert.ok(big.size > small.size);
  assert.equal(orbGrid(1280, 4).size, MAX_ORB_SIZE);
});

test("orbGrid: gaps scale with the width between 24 and 64px", () => {
  assert.equal(orbGrid(300, 3).gap, 24);
  assert.equal(orbGrid(1000, 3).gap, 50);
  assert.equal(orbGrid(3000, 3).gap, 64);
});

test("orbGrid: an empty floor list still yields one column", () => {
  assert.equal(orbGrid(500, 0).cols, 1);
});

test("badgeScale: ×2 on phone-sized tiles, easing to ×1.2 at the largest", () => {
  assert.equal(badgeScale(64), 2);
  assert.equal(badgeScale(100), 2);
  assert.equal(badgeScale(137.5), 1.6);
  assert.equal(badgeScale(MAX_ORB_SIZE), 1.2);
  assert.equal(badgeScale(400), 1.2);
});

test("orbBadge: text follows the scale, insets and ring stay at the design's proportions", () => {
  assert.deepEqual(orbBadge(156), { font: +(156 * (12 / 156) * badgeScale(156)).toFixed(2), insetX: 4, insetY: 8, ring: 3 });
  assert.equal(orbBadge(100).font, 15.38);
});
