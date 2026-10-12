// Colors for the Routines list of one area. Each routine gets the first color
// that applies:
//   1. a script: green (scripts are what you run yourself);
//   2. its first HA label that has a color;
//   3. the family its icon belongs to (lights, climate, security…);
//   4. the family its name belongs to, in English or French;
//   5. otherwise a palette color no other routine in the area uses yet, in
//      palette order, then the whole palette again (modulo) once those run out.
// Brightness, state or history never come into it, so a routine keeps its
// color.

export const SCRIPT_COLOR = "#79d99a";

// Pastel, tuned for the dark panel; the order alternates hues so routines
// colored from it in turn stay easy to tell apart.
const C = {
  sky: "#8cc1ff",
  amber: "#f6c14b",
  violet: "#c9a3ff",
  teal: "#5fd4c4",
  red: "#ff8f8f",
  lime: "#a6d96a",
  orange: "#ffb561",
  indigo: "#8e9cff",
  pink: "#f49ac1",
  blue: "#6fa8ff",
  mauve: "#b18cff",
};
export const ROUTINE_PALETTE = Object.values(C);

// First match wins, icon before name. `icon` is matched against the mdi name
// (without "mdi:"), `name` against the lower-cased name with accents removed.
const FAMILIES = [
  { color: C.red, icon: /shield|alert|alarm|bell|lock|siren|cctv|camera|smoke|fire-alert/, name: /secur|alarm|alert|intrus|notif|warn|avertis|surveill|smoke|fumee/ },
  { color: C.teal, icon: /thermo|radiator|heat|snowflake|fan|air-|hvac|water-percent|humid|fire/, name: /heat|chauff|temp|thermo|climat|cool|clim|humid|fan\b|ventil|plinthe|plancher|thermopompe|heat pump|frost|gel\b/ },
  { color: C.blue, icon: /water|pipe|sprinkler|leak|shower|pool/, name: /leak|water|flood|fuite|\beau\b|inond|arros|sprinkl|shower|douche|sump|puisard/ },
  { color: C.amber, icon: /lightbulb|lamp|^led|ceiling-light|chandelier|light-|spotlight|string-lights|wall-sconce/, name: /light|lamp|lumiere|eclair|chandelier|bulb|ampoule/ },
  { color: C.mauve, icon: /blind|curtain|window-shutter|roller-shade|garage/, name: /cover|curtain|blind|\bstores?\b|rideau|toile|volet|shade/ },
  { color: C.violet, icon: /television|^tv|speaker|music|cast|movie|theater|play-box/, name: /\btv\b|television|tele\b|music|musique|movie|film|cinema|sonos|speaker|media|sync box/ },
  { color: C.sky, icon: /location|^home|walk|run|account|airplane|car|human|motion|exit|door|map-marker|bed|sleep/, name: /away|vacation|vacances|absen|presence|motion|mouvement|arriv|depart|leave|\bhome\b|maison|sleep|\bbed\b|dodo|coucher/ },
  { color: C.lime, icon: /sync|clock|calendar|timer|weather-sun|sun-|moon|repeat|update/, name: /sync|schedul|horaire|timer|minuterie|sunset|sunrise|soleil|morning|matin|night|nuit|soir|evening/ },
];

// HA label colors (theme names) onto the palette; greys and black/white give
// no color, so the routine falls through to its icon or name.
const LABEL_COLORS = {
  red: C.red, pink: C.pink, purple: C.violet, deep_purple: C.mauve, indigo: C.indigo,
  blue: C.blue, light_blue: C.sky, cyan: C.teal, teal: C.teal,
  green: SCRIPT_COLOR, light_green: C.lime, lime: C.lime,
  yellow: C.amber, amber: C.amber, orange: C.orange, deep_orange: C.orange, brown: C.orange,
};

const normalize = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function labelColor(color) {
  if (!color) return null;
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  return LABEL_COLORS[color] || null;
}

// The color a routine gets from what it is, or null when nothing says.
export function intrinsicColor({ isScript, labelColors = [], icon, name }) {
  if (isScript) return SCRIPT_COLOR;
  for (const c of labelColors) {
    const color = labelColor(c);
    if (color) return color;
  }
  const iconName = (icon || "").replace(/^mdi:/, "");
  if (iconName) for (const f of FAMILIES) if (f.icon.test(iconName)) return f.color;
  const n = normalize(name);
  if (n) for (const f of FAMILIES) if (f.name.test(n)) return f.color;
  return null;
}

// items: [{ id, isScript, labelColors, icon, name }] in display order.
// Returns a Map of id → color.
export function routineColors(items) {
  const colors = new Map();
  const used = new Set();
  const rest = [];
  for (const item of items) {
    const color = intrinsicColor(item);
    if (color) {
      colors.set(item.id, color);
      used.add(color);
    } else rest.push(item);
  }
  const free = ROUTINE_PALETTE.filter((c) => !used.has(c));
  rest.forEach((item, i) => {
    colors.set(item.id, i < free.length ? free[i] : ROUTINE_PALETTE[(i - free.length) % ROUTINE_PALETTE.length]);
  });
  return colors;
}
