import { TONE } from "../lib/tone.js";
import { getLabel } from "../lib/label-registry.js";
import STYLE from "./area-card.css";
import AREA_POPOVER_ITEM_STYLE from "./area-card-popover.css";

export { TONE, STYLE, AREA_POPOVER_ITEM_STYLE };

export function ensurePopoverItemStyle() {
  if (document.getElementById("atrium-area-popover-item-style")) return;
  const style = document.createElement("style");
  style.id = "atrium-area-popover-item-style";
  style.textContent = AREA_POPOVER_ITEM_STYLE;
  document.head.appendChild(style);
}

export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Case-insensitive: a humanized fallback name (no friendly_name set) is all
// lower-case, but the area name it's prefixed with isn't.
// Pass the entity id to apply per-domain cleanups: a toggle helper's
// "… mode" is implied by the Toggles tile it sits on ("Guest mode" → "Guest").
export function nameWithoutAreaPrefix(name, area, entityId) {
  const escaped = (area.name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let clean = (name || "").replace(new RegExp(`^${escaped} `, "i"), "").trim();
  if (entityId?.startsWith("input_boolean.")) clean = clean.replace(/\s*\bmode\b\s*/gi, " ").trim() || clean;
  return capitalize(clean);
}

export function nameWithoutStairs(name) {
  return capitalize((name || "").replace("Upstairs", "").replace("Downstairs", "").trim());
}

export const ICONS = {
  bedroom: "mdi:bed",
  entrance: "mdi:door",
  sofa: "mdi:sofa",
  fork: "mdi:silverware-fork-knife",
  kitchen: "mdi:countertop",
  bath: "mdi:bathtub",
  corridor: "mdi:walk",
  screen: "mdi:television-classic",
  desk: "mdi:desk",
  wrench: "mdi:wrench",
  sun: "mdi:weather-sunny",
  bulb: "mdi:lightbulb",
  thermo: "mdi:thermometer",
  drop: "mdi:water-percent",
  plus: "mdi:plus",
  minus: "mdi:minus",
  play: "mdi:play",
  vacuum: "mdi:robot-vacuum",
  flame: "mdi:fire",
  snow: "mdi:snowflake",
  fan: "mdi:fan",
  swing: "mdi:swap-horizontal",
  power: "mdi:power",
  toggle: "mdi:toggle-switch-variant",
  auto: "mdi:autorenew",
  cogs: "mdi:cog-outline",
  script: "mdi:script-text",
  play_circle: "mdi:play-circle",
  plant: "mdi:sprout",
  leak: "mdi:water-alert",
  door_open: "mdi:door-open",
  door_closed: "mdi:door",
  propane: "mdi:propane-tank",
};

export const CLIMATE_ACCENT = {
  heat: TONE.heat,
  cool: TONE.cool,
  dry: "var(--state-climate-dry-color, #7fb9ff)",
  heat_cool: TONE.text,
  auto: TONE.text,
  fan_only: TONE.textDim,
  off: TONE.textMute,
};
export const CLIMATE_LABELS = { auto: "Auto", heat_cool: "Heat/Cool", heat: "Heat", cool: "Cool", dry: "Dry", fan_only: "Fan only", off: "Off" };
export const CLIMATE_ICONS = { auto: ICONS.auto, heat_cool: "mdi:sun-snowflake-variant", heat: ICONS.flame, cool: ICONS.snow, dry: ICONS.drop, fan_only: ICONS.fan, off: ICONS.power };

export function iconForArea(area) {
  if (area.icon) return area.icon;
  const name = (area.name || "").toLowerCase();
  if (/(bed)/.test(name)) return ICONS.bedroom;
  if (/(entrance|hall|entr)/.test(name)) return ICONS.entrance;
  if (/(living|salon|séjour|sejour)/.test(name)) return ICONS.sofa;
  if (/(dining|salle à manger)/.test(name)) return ICONS.fork;
  if (/(kitchen|cuisine)/.test(name)) return ICONS.kitchen;
  if (/(bath|bain)/.test(name)) return ICONS.bath;
  if (/(theatre|cinema|cinéma)/.test(name)) return ICONS.screen;
  if (/(office|bureau)/.test(name)) return ICONS.desk;
  if (/(workshop|établi|garage)/.test(name)) return ICONS.wrench;
  if (/(outside|dehors|extérieur|exterieur)/.test(name)) return ICONS.sun;
  if (/(stairs|escalier|hallway|couloir)/.test(name)) return ICONS.corridor;
  return "mdi:home-outline";
}

export function iconForScene(scene, name) {
  if (scene.icon) return scene.icon;
  const n = (name || scene.name || "").toLowerCase();
  if (/(night|sleep|bed|moon)/.test(n)) return "mdi:weather-night";
  if (/(focus|work|concentrate)/.test(n)) return "mdi:target";
  if (/(gam|play)/.test(n)) return "mdi:gamepad-variant";
  if (/(party|relax|ambian|living)/.test(n)) return "mdi:palette";
  if (/(vacation|away|leave)/.test(n)) return "mdi:palm-tree";
  if (/(pool|water)/.test(n)) return "mdi:pool";
  if (/(escape)/.test(n)) return "mdi:puzzle";
  if (/(warning|alert|alarm|red)/.test(n)) return "mdi:alert";
  if (/(sun|sunset|sunrise|savanna)/.test(n)) return "mdi:weather-sunset";
  if (/(go go|caro)/.test(n)) return "mdi:run-fast";
  return "mdi:palette";
}

export function levelColor(pct) {
  if (pct <= 20) return TONE.danger;
  if (pct <= 40) return TONE.warn;
  return TONE.good;
}

export function fmtBrightnessPct(state) {
  if (state.state !== "on") return 0;
  const b = state.attributes?.brightness;
  if (b == null) return 100;
  return Math.max(0, Math.min(100, Math.round((b / 255) * 100)));
}

export function canDimLight(state) {
  const attrs = state?.attributes || {};
  const modes = attrs.supported_color_modes;
  if (Array.isArray(modes) && modes.length) {
    return modes.some((mode) => mode !== "onoff" && mode !== "unknown");
  }
  // Legacy HA light support flag: SUPPORT_BRIGHTNESS = 1.
  return (Number(attrs.supported_features) & 1) === 1 || attrs.brightness != null;
}

// Live rgb_color of a light in a true color mode → [r, g, b], else null.
// White-temperature modes return null so callers fall back to the yellow tint.
const RGB_COLOR_MODES = ["rgb", "hs", "xy", "rgbw", "rgbww"];
export function lightRgbTriple(state) {
  const attrs = state?.attributes || {};
  const rgb = attrs.rgb_color;
  if (attrs.color_mode && RGB_COLOR_MODES.includes(attrs.color_mode) && Array.isArray(rgb) && rgb.length >= 3) {
    return [rgb[0], rgb[1], rgb[2]];
  }
  return null;
}

// A dimmed gradient of the CURRENT colors of the given lights — one stop per
// light that's on (its rgb color, or the warm-white tint in a white mode).
// Captured right after a scene fires (see _captureSceneColors in
// area-card-builders.js) it reads as "what this scene looks like". Null when
// none of them is on.
export function lightsGradient(hass, lightIds) {
  const stops = [];
  for (const id of lightIds) {
    if (!id.startsWith("light.")) continue;
    const st = hass.states?.[id];
    if (!st || st.state !== "on") continue;
    const rgb = lightRgbTriple(st);
    stops.push(
      rgb
        ? `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / 0.35)`
        : "rgb(var(--rgb-state-light-active-color, 245 196 81) / 0.3)"
    );
  }
  if (!stops.length) return null;
  if (stops.length === 1) stops.push(stops[0]);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

// The same hue at full saturation and mid lightness: lights often report
// pastel rgb_color values that read as grey on a thin ring. Near-whites
// (little chroma) stay as they are.
export function vividRgb([r, g, b]) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const chroma = max - min;
  if (chroma < 0.15) return [r, g, b];
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  let h = max === rn ? ((gn - bn) / chroma) % 6 : max === gn ? (bn - rn) / chroma + 2 : (rn - gn) / chroma + 4;
  h = (h * 60 + 360) % 360;
  // hsl(h, 100%, 55%) back to rgb.
  const l = 0.55;
  const c = 1 - Math.abs(2 * l - 1);
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r1, g1, b1].map((v) => Math.round((v + m) * 255));
}

// One color per light that's on, for an area tile's aura: its rgb color, or
// the light-yellow tint in a white mode. Repeats are dropped, at most 6 kept.
// `vivid` saturates each color (see vividRgb) for the tile's ring.
export function lightsAuraColors(hass, lightIds, { vivid = false } = {}) {
  const colors = [];
  for (const id of lightIds) {
    const st = hass.states?.[id];
    if (st?.state !== "on") continue;
    let rgb = lightRgbTriple(st);
    if (rgb && vivid) rgb = vividRgb(rgb);
    const color = rgb ? `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})` : "#f6c14b";
    if (!colors.includes(color)) colors.push(color);
  }
  return colors.slice(0, 6);
}

// Those colors around a circle, blending into each other and back to the first.
// `space` ("oklch") blends through vivid hues instead of the grey an sRGB mix
// passes through between, say, yellow and blue. `hold` (0–1) keeps each color
// solid over that share of its arc, so every light reads as its own color and
// only the short joins blend.
export function auraGradient(colors, { space, hold = 0 } = {}) {
  if (!colors.length) return null;
  const prefix = space ? `in ${space}, ` : "";
  if (colors.length === 1) return `conic-gradient(${prefix}${colors[0]}, ${colors[0]})`;
  if (!hold) return `conic-gradient(${prefix}${[...colors, colors[0]].join(", ")})`;
  const arc = 360 / colors.length;
  const deg = (v) => `${+v.toFixed(1)}deg`;
  const stops = colors.map((c, i) => `${c} ${deg(i * arc)} ${deg(i * arc + arc * hold)}`);
  return `conic-gradient(${prefix}${stops.join(", ")}, ${colors[0]} 360deg)`;
}

const SENSOR_ICON_BY_DC = {
  temperature: "mdi:thermometer",
  humidity: "mdi:water-percent",
  illuminance: "mdi:brightness-5",
  pressure: "mdi:gauge",
  power: "mdi:flash",
  energy: "mdi:lightning-bolt",
  co2: "mdi:molecule-co2",
  carbon_dioxide: "mdi:molecule-co2",
  voc: "mdi:air-filter",
  pm25: "mdi:air-filter",
  current: "mdi:current-ac",
  voltage: "mdi:flash-triangle",
};
export function iconForSensor(state) {
  const attrs = state?.attributes || {};
  return attrs.icon || SENSOR_ICON_BY_DC[attrs.device_class] || "mdi:gauge";
}

export function fmtTimeAgoShort(ts) {
  const d = new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.round(diff / 60)}m`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h`;
  if (diff < 86400 * 30) return `${Math.round(diff / 86400)}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Long spelled-out form for automation "last triggered" lines.
export function fmtTimeAgoLong(ts) {
  const d = new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} hours ago`;
  if (diff < 86400 * 30) return `${Math.round(diff / 86400)} days ago`;
  return d.toLocaleDateString();
}

export function fmtCoverPct(state) {
  const p = state.attributes?.current_position;
  if (p == null) return state.state === "open" ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(p)));
}

// Current reading for a sensor, formatted like the header chips: percentages
// rounded, other numbers kept to one decimal, unit glued or spaced per symbol.
export function fmtSensorValue(state) {
  const raw = state?.state;
  if (raw == null || raw === "unavailable" || raw === "unknown") return "—";
  const unit = state.attributes?.unit_of_measurement || "";
  const num = parseFloat(raw);
  let text = raw;
  if (!Number.isNaN(num) && /^-?\d*\.?\d+$/.test(String(raw).trim())) {
    text = unit === "%" ? String(Math.round(num)) : Number.isInteger(num) ? String(num) : num.toFixed(1);
  }
  if (!unit) return text;
  return /^[°%]/.test(unit) ? `${text}${unit}` : `${text} ${unit}`;
}

// HA stores label colors as theme keys ("blue", "red", …). Map them to the
// TONE palette so atrium labels track the rest of the dashboard.
export function labelDescriptor(hass, labelId) {
  const lbl = getLabel(hass, labelId);
  if (!lbl) return null;
  const colorMap = {
    teal: TONE.cool,
    blue: TONE.cool,
    cyan: TONE.cool,
    indigo: TONE.curtain,
    purple: TONE.curtain,
    pink: TONE.curtain,
    red: TONE.danger,
    deep_orange: TONE.heat,
    orange: TONE.warn,
    amber: TONE.warn,
    yellow: TONE.warn,
    light_green: TONE.good,
    green: TONE.good,
    grey: TONE.textDim,
  };
  const color = colorMap[lbl.color] || TONE.textDim;
  return {
    name: lbl.name || labelId,
    // Most labels are never given a custom icon in HA — don't fall back to
    // a generic one, just show the colored text on its own.
    icon: lbl.icon || null,
    color,
  };
}
