import test from "node:test";
import assert from "node:assert/strict";
import { routineColors, hashString, SCRIPT_COLOR, ROUTINE_PALETTE } from "./routine-colors.js";

test("routineColors: scripts are green; an automation's color comes from its ID", () => {
  const colors = routineColors([
    { id: "script.halloween", key: "script.halloween", isScript: true },
    { id: "automation.away_mode", key: "1755722221689" },
  ]);
  assert.equal(colors.get("script.halloween"), SCRIPT_COLOR);
  assert.equal(colors.get("automation.away_mode"), ROUTINE_PALETTE[hashString("1755722221689") % ROUTINE_PALETTE.length]);
});

test("routineColors: the same ID gets the same color whatever else is in the area, or its name", () => {
  const alone = routineColors([{ id: "automation.a", key: "1760366605928" }]);
  const renamed = routineColors([{ id: "automation.renamed", key: "1760366605928" }]);
  assert.equal(alone.get("automation.a"), renamed.get("automation.renamed"));
});

test("routineColors: two automations of one area never share a color while the palette lasts", () => {
  const items = Array.from({ length: ROUTINE_PALETTE.length }, (_, i) => ({ id: `automation.a${i}`, key: `id-${i}` }));
  const colors = new Set(routineColors(items).values());
  assert.equal(colors.size, ROUTINE_PALETTE.length);
});

test("routineColors: past the palette's length colors repeat instead of failing", () => {
  const items = Array.from({ length: ROUTINE_PALETTE.length + 3 }, (_, i) => ({ id: `automation.a${i}`, key: `id-${i}` }));
  const colors = routineColors(items);
  assert.equal(colors.size, items.length);
  for (const c of colors.values()) assert.ok(ROUTINE_PALETTE.includes(c));
});
