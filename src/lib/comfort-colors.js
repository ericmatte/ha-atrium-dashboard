// Colors for temperature and humidity readings.
// Temperature: a continuous hue sweep from blue (0°C and below) through
// cyan, green, yellow and orange to red (30°C and above).
// Humidity: a comfort scale — amber when too dry, green in the comfortable
// band, blue when too humid, blended at the edges.

const clamp01 = (v) => Math.max(0, Math.min(1, v));

const TEMP_COLD_C = 0;
const TEMP_HOT_C = 30;
const HUE_COLD = 215;
const HUE_HOT = 0;

export function toCelsius(value, unit) {
  return /F/i.test(unit || "") ? ((value - 32) * 5) / 9 : value;
}

export function tempColor(celsius) {
  const t = clamp01((celsius - TEMP_COLD_C) / (TEMP_HOT_C - TEMP_COLD_C));
  const hue = Math.round(HUE_COLD + (HUE_HOT - HUE_COLD) * t);
  return `hsl(${hue} 80% 66%)`;
}

const DRY = "#ffb561";
const COMFY = "#79d99a";
const HUMID = "#8cc1ff";
const mix = (a, b, t) => `color-mix(in srgb, ${b} ${Math.round(clamp01(t) * 100)}%, ${a})`;

export function humidityColor(pct) {
  if (pct < 30) return DRY;
  if (pct < 40) return mix(DRY, COMFY, (pct - 30) / 10);
  if (pct <= 60) return COMFY;
  if (pct <= 65) return mix(COMFY, HUMID, (pct - 60) / 5);
  return HUMID;
}
