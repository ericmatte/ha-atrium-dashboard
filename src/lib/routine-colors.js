// Colors for the Routines list of one area. Scripts are green (they're what
// you run yourself). Each automation draws its color from its ID: the same
// automation always lands on the same palette color, renamed or not. When two
// automations of one area land on the same color, the later one (by ID) moves
// on to the next color nobody in the area uses yet. Brightness, state or
// history never come into it.

export const SCRIPT_COLOR = "#79d99a";

// 22 colors on two levels, a light and a deeper one alternating around the
// hue circle (OKLCH), so neighbours differ in hue and lightness. The two
// closest to the scripts' green are left out.
export const ROUTINE_PALETTE = [
  "#e96880", "#fdb6ae", "#e87142", "#fdba8a", "#cf860c", "#edc569",
  "#ab9a0a", "#c6d476", "#74ab33", "#13b37a", "#09afa9", "#55e1f1",
  "#05a9ce", "#8ed4ff", "#3f9cf7", "#b3cafd", "#8989f8", "#cfbffe",
  "#b878e0", "#f3aff5", "#d86cb5", "#feb1cc",
];

// FNV-1a, 32-bit: a stable, well-spread number for any string.
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// items: [{ id, key, isScript }] — `id` is what the result is keyed by (the
// entity_id), `key` what the color comes from (the automation's config id,
// which survives renames; the entity_id when it has none).
// Returns a Map of id → color.
export function routineColors(items) {
  const colors = new Map();
  const taken = new Set();
  const automations = items.filter((it) => !it.isScript).sort((a, b) => String(a.key).localeCompare(String(b.key)));
  for (const it of automations) {
    let index = hashString(String(it.key)) % ROUTINE_PALETTE.length;
    if (taken.size < ROUTINE_PALETTE.length) while (taken.has(index)) index = (index + 1) % ROUTINE_PALETTE.length;
    taken.add(index);
    colors.set(it.id, ROUTINE_PALETTE[index]);
  }
  for (const it of items) if (it.isScript) colors.set(it.id, SCRIPT_COLOR);
  return colors;
}
