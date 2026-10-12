import test from "node:test";
import assert from "node:assert/strict";
import { routineColors, intrinsicColor, labelColor, SCRIPT_COLOR, ROUTINE_PALETTE } from "./routine-colors.js";

test("intrinsicColor: script, then label, then icon, then name", () => {
  assert.equal(intrinsicColor({ isScript: true, icon: "mdi:shield-alert" }), SCRIPT_COLOR);
  assert.equal(intrinsicColor({ labelColors: ["grey", "red"], icon: "mdi:lightbulb" }), "#ff8f8f");
  assert.equal(intrinsicColor({ icon: "mdi:lightbulb-off", name: "Away mode" }), "#f6c14b");
  assert.equal(intrinsicColor({ name: "Motion" }), "#8cc1ff");
  assert.equal(intrinsicColor({ name: "Dimmer button" }), null);
});

test("intrinsicColor: the Outside routines get their family colors", () => {
  const byIcon = (icon) => intrinsicColor({ icon });
  assert.equal(byIcon("mdi:location-exit"), "#8cc1ff");
  assert.equal(byIcon("mdi:airplane"), "#8cc1ff");
  assert.equal(byIcon("mdi:thermometer"), "#5fd4c4");
  assert.equal(byIcon("mdi:shield-alert"), "#ff8f8f");
  assert.equal(byIcon("mdi:sync"), "#a6d96a");
});

test("intrinsicColor: French names, accents ignored", () => {
  assert.equal(intrinsicColor({ name: "Éteindre les lumières du bureau" }), "#f6c14b");
  assert.equal(intrinsicColor({ name: "Plancher des plinthes en mode été" }), "#5fd4c4");
  assert.equal(intrinsicColor({ name: "Fermer les rideaux" }), "#b18cff");
  assert.equal(intrinsicColor({ name: "Détecteur de fuite" }), "#6fa8ff");
});

test("labelColor: theme names map onto the palette, hex passes through, greys give nothing", () => {
  assert.equal(labelColor("purple"), "#c9a3ff");
  assert.equal(labelColor("#123456"), "#123456");
  assert.equal(labelColor("grey"), null);
  assert.equal(labelColor(undefined), null);
});

test("routineColors: unmatched routines take the palette colors nobody uses yet, in order", () => {
  const colors = routineColors([
    { id: "a", icon: "mdi:location-exit" }, // sky
    { id: "b", name: "Dimmer button" },
    { id: "c", name: "Diva remote" },
  ]);
  assert.equal(colors.get("a"), "#8cc1ff");
  assert.equal(colors.get("b"), ROUTINE_PALETTE[1]); // amber: sky is taken
  assert.equal(colors.get("c"), ROUTINE_PALETTE[2]);
});

test("routineColors: once every palette color is used, it starts over (modulo)", () => {
  const items = Array.from({ length: ROUTINE_PALETTE.length + 2 }, (_, i) => ({ id: `x${i}`, name: `Remote ${i}` }));
  const colors = routineColors(items);
  assert.deepEqual(items.slice(0, ROUTINE_PALETTE.length).map((it) => colors.get(it.id)), ROUTINE_PALETTE);
  assert.equal(colors.get(`x${ROUTINE_PALETTE.length}`), ROUTINE_PALETTE[0]);
  assert.equal(colors.get(`x${ROUTINE_PALETTE.length + 1}`), ROUTINE_PALETTE[1]);
});
