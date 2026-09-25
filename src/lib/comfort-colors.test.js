import test from "node:test";
import assert from "node:assert/strict";
import { tempColor, humidityColor, toCelsius } from "./comfort-colors.js";

test("tempColor: blue at 0°C and below, red at 30°C and above, hues in between", () => {
  assert.equal(tempColor(-10), "hsl(215 80% 66%)");
  assert.equal(tempColor(0), "hsl(215 80% 66%)");
  assert.equal(tempColor(15), "hsl(108 80% 66%)");
  assert.equal(tempColor(30), "hsl(0 80% 66%)");
  assert.equal(tempColor(40), "hsl(0 80% 66%)");
});

test("toCelsius: converts °F, leaves °C alone", () => {
  assert.equal(toCelsius(212, "°F"), 100);
  assert.equal(toCelsius(21, "°C"), 21);
  assert.equal(toCelsius(21, undefined), 21);
});

test("humidityColor: amber when dry, green when comfortable, blue when humid, blended at the edges", () => {
  assert.equal(humidityColor(20), "#ffb561");
  assert.equal(humidityColor(35), "color-mix(in srgb, #79d99a 50%, #ffb561)");
  assert.equal(humidityColor(50), "#79d99a");
  assert.equal(humidityColor(62.5), "color-mix(in srgb, #8cc1ff 50%, #79d99a)");
  assert.equal(humidityColor(80), "#8cc1ff");
});
