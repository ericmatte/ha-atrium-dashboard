// The dashboard's words, in English (default) and French. The language comes
// from the strategy config (`language: fr`), handed to every Atrium card; one
// dashboard has one language, so it's kept here rather than threaded through.
//
// t("key") returns the string; entries that need values are functions:
// t("lightsOn", 3) → "3 lights on".

const plural = (n, one, many) => (n === 1 ? one : many);

const EN = {
  // Strategy
  home: "Home",
  other: "Other",
  tab: "Tab",

  // Header
  all: "All",
  lightsOnCount: (n) => `${n} ${plural(n, "light", "lights")} on`,
  batteriesTitle: "Batteries & levels",
  noBatteries: "No batteries reported.",
  lightsOnTitle: "Lights on",
  noLightsOn: "No lights are on.",
  on: "On",
  off: "Off",
  openEntity: "Open entity",
  totalCount: (n) => `${n} total`,
  turnOffAll: "Turn off all",
  problemsTitle: "Problems & offline",
  nothingToReport: "Nothing to report.",
  problem: "Problem",
  offline: "Offline",
  goodNight: "Good night",
  goodMorning: "Good morning",
  goodAfternoon: "Good afternoon",
  goodEvening: "Good evening",
  personHome: "Home",
  personAway: "Away",

  // Room tiles
  playPause: (name) => `Play/pause ${name}`,
  pauseName: (name) => `Pause ${name}`,
  heatingName: (name) => `${name} heating`,
  coolingName: (name) => `${name} cooling`,
  floorLightsAria: (on, total, floor) => `${on} of ${total} ${floor} lights on — turn ${on > 0 ? "off" : "on"}`,
  turnOffLightsIn: (n, area) => `Turn off ${n} ${plural(n, "light", "lights")} in ${area}`,
  motionIn: (area) => `Motion in ${area}`,
  turnOnAllLightsIn: (area) => `Turn on all lights in ${area}`,
  closeName: (name) => `Close ${name}`,
  leak: "Leak!",
  windowOpen: "Window open",
  garageOpen: "Garage open",
  doorOpen: "Door open",

  // Room header badges
  motion: "Motion",
  motionSensors: "Motion sensors",
  leakSensors: "Leak sensors",
  doorsWindows: "Doors & windows",
  vacuums: "Vacuums",

  // Sections
  lights: "Lights",
  devices: "Devices",
  toggles: "Toggles",
  covers: "Covers",
  sensors: "Sensors",
  modes: "Modes",
  routines: "Routines",
  automations: "Automations",
  allOff: "All off",
  allOn: "All on",
  closeAll: "Close all",
  openAll: "Open all",
  sensorsOf: (name) => `${name} sensors`,

  // Climate
  lowerTarget: "Lower target",
  raiseTarget: "Raise target",
  mode: "Mode",
  fanMode: "Fan mode",
  swingMode: "Swing mode",
  climateNow: (temp) => `Now ${temp}°`,
  climateModes: { auto: "Auto", heat_cool: "Heat/Cool", heat: "Heat", cool: "Cool", dry: "Dry", fan_only: "Fan only", off: "Off" },
  hvacActions: { heating: "heating", cooling: "cooling", drying: "drying", idle: "idle", off: "off", fan: "fan", preheating: "preheating", defrosting: "defrosting" },

  // Media
  previous: "Previous",
  next: "Next",
  muteName: (name) => `Mute ${name}`,
  volumeOf: (name) => `${name} volume`,
  turnName: (name, on) => `Turn ${name} ${on ? "on" : "off"}`,
  playName: (name, playing) => `${playing ? "Pause" : "Play"} ${name}`,
  mediaStates: { playing: "Playing", paused: "Paused", idle: "Idle", on: "On", off: "Off", standby: "Standby", buffering: "Buffering", unavailable: "Unavailable" },

  // Light / switch / cover tiles
  closed: "Closed",
  coverAria: (name, level) => `${name}, ${level === 0 ? "closed" : `${level}% open`}. Drag to set position, tap to open or close.`,
  tileAria: (name, status, dimmable) => `${name}, ${status}.` + (dimmable ? " Drag to dim, tap to toggle." : " Tap to toggle."),
  unavailable: "Unavailable",
  statusUnavailable: "unavailable",
  statusOn: "on",
  statusOff: "off",

  // Routines
  holdToTrigger: "Hold to trigger",
  run: "Run",
  running: "Running",
  runningEllipsis: "Running…",
  triggeredJustNow: "Triggered just now",
  scriptWhen: (when) => `Script · ${when}`,
  neverRun: "never run",
  never: "never",
  offWhen: (when) => `Off · ${when}`,
  inactiveForAWeek: (n) => `${n} inactive for over a week`,
  toggleName: (name) => `Turn ${name} on or off`,
  runName: (name) => `Run ${name}`,
  holdToTriggerName: (name) => `${name}. Hold to trigger.`,

  // Time
  justNow: "just now",
  justNowCap: "Just now",
  shortAgo: (v) => `${v} ago`,
};

const FR = {
  home: "Accueil",
  other: "Autres",
  tab: "Onglet",

  all: "Tout",
  lightsOnCount: (n) => `${n} ${plural(n, "lumière allumée", "lumières allumées")}`,
  batteriesTitle: "Batteries et niveaux",
  noBatteries: "Aucune batterie signalée.",
  lightsOnTitle: "Lumières allumées",
  noLightsOn: "Aucune lumière allumée.",
  on: "Allumé",
  off: "Éteint",
  openEntity: "Ouvrir l'entité",
  totalCount: (n) => `${n} au total`,
  turnOffAll: "Tout éteindre",
  problemsTitle: "Problèmes et hors ligne",
  nothingToReport: "Rien à signaler.",
  problem: "Problème",
  offline: "Hors ligne",
  goodNight: "Bonne nuit",
  goodMorning: "Bonjour",
  goodAfternoon: "Bon après-midi",
  goodEvening: "Bonsoir",
  personHome: "Maison",
  personAway: "Absent",

  playPause: (name) => `Lecture/pause ${name}`,
  pauseName: (name) => `Mettre ${name} en pause`,
  heatingName: (name) => `${name} chauffe`,
  coolingName: (name) => `${name} refroidit`,
  floorLightsAria: (on, total, floor) => `${on} sur ${total} lumières allumées (${floor}) — ${on > 0 ? "éteindre" : "allumer"}`,
  turnOffLightsIn: (n, area) => `Éteindre ${n} ${plural(n, "lumière", "lumières")} dans ${area}`,
  motionIn: (area) => `Mouvement dans ${area}`,
  turnOnAllLightsIn: (area) => `Allumer toutes les lumières dans ${area}`,
  closeName: (name) => `Fermer ${name}`,
  leak: "Fuite!",
  windowOpen: "Fenêtre ouverte",
  garageOpen: "Garage ouvert",
  doorOpen: "Porte ouverte",

  motion: "Mouvement",
  motionSensors: "Détecteurs de mouvement",
  leakSensors: "Détecteurs de fuite",
  doorsWindows: "Portes et fenêtres",
  vacuums: "Aspirateurs",

  lights: "Lumières",
  devices: "Appareils",
  toggles: "Interrupteurs",
  covers: "Stores",
  sensors: "Capteurs",
  modes: "Modes",
  routines: "Routines",
  automations: "Automatisations",
  allOff: "Tout éteindre",
  allOn: "Tout allumer",
  closeAll: "Tout fermer",
  openAll: "Tout ouvrir",
  sensorsOf: (name) => `Capteurs de ${name}`,

  lowerTarget: "Baisser la consigne",
  raiseTarget: "Monter la consigne",
  mode: "Mode",
  fanMode: "Ventilation",
  swingMode: "Oscillation",
  climateNow: (temp) => `Actuel ${temp}°`,
  climateModes: { auto: "Auto", heat_cool: "Chaud/Froid", heat: "Chauffage", cool: "Climatisation", dry: "Déshumidification", fan_only: "Ventilation", off: "Arrêt" },
  hvacActions: { heating: "chauffe", cooling: "refroidit", drying: "déshumidifie", idle: "inactif", off: "arrêt", fan: "ventile", preheating: "préchauffe", defrosting: "dégivre" },

  previous: "Précédent",
  next: "Suivant",
  muteName: (name) => `Couper le son de ${name}`,
  volumeOf: (name) => `Volume de ${name}`,
  turnName: (name, on) => `${on ? "Allumer" : "Éteindre"} ${name}`,
  playName: (name, playing) => `${playing ? "Mettre en pause" : "Lire"} ${name}`,
  mediaStates: { playing: "Lecture", paused: "En pause", idle: "Inactif", on: "Allumé", off: "Éteint", standby: "Veille", buffering: "Chargement", unavailable: "Indisponible" },

  closed: "Fermé",
  coverAria: (name, level) => `${name}, ${level === 0 ? "fermé" : `ouvert à ${level} %`}. Glisser pour régler, toucher pour ouvrir ou fermer.`,
  tileAria: (name, status, dimmable) => `${name}, ${status}.` + (dimmable ? " Glisser pour tamiser, toucher pour basculer." : " Toucher pour basculer."),
  unavailable: "Indisponible",
  statusUnavailable: "indisponible",
  statusOn: "allumé",
  statusOff: "éteint",

  holdToTrigger: "Maintenir pour déclencher",
  run: "Lancer",
  running: "En cours",
  runningEllipsis: "En cours…",
  triggeredJustNow: "Déclenchée à l'instant",
  scriptWhen: (when) => `Script · ${when}`,
  neverRun: "jamais lancé",
  never: "jamais",
  offWhen: (when) => `Désactivée · ${when}`,
  inactiveForAWeek: (n) => `${n} ${plural(n, "inactive", "inactives")} depuis plus d'une semaine`,
  toggleName: (name) => `Activer ou désactiver ${name}`,
  runName: (name) => `Lancer ${name}`,
  holdToTriggerName: (name) => `${name}. Maintenir pour déclencher.`,

  justNow: "à l'instant",
  justNowCap: "À l'instant",
  shortAgo: (v) => `il y a ${v}`,
};

const STRINGS = { en: EN, fr: FR };
let lang = "en";

// Accepts "fr", "fr-CA", "FR"…; anything unknown falls back to English.
export function setLanguage(value) {
  const code = String(value || "en").slice(0, 2).toLowerCase();
  lang = STRINGS[code] ? code : "en";
}
export const getLanguage = () => lang;

export function t(key, ...args) {
  const entry = STRINGS[lang][key] ?? EN[key];
  if (entry === undefined) return key;
  return typeof entry === "function" ? entry(...args) : entry;
}

// The compact age on light tiles: "13m", "2h", "4d" / "13 min", "2 h", "4 j".
export function shortAge(seconds) {
  const [m, h, d] = lang === "fr" ? [" min", " h", " j"] : ["m", "h", "d"];
  if (seconds < 3600) return `${Math.round(seconds / 60)}${m}`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}${h}`;
  return `${Math.round(seconds / 86400)}${d}`;
}

// "5 minutes ago", "yesterday", "11 months ago" / "il y a 5 minutes", "hier"…
export function relativeAge(seconds) {
  if (seconds < 60) return t("justNow");
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (seconds < 3600) return rtf.format(-Math.round(seconds / 60), "minute");
  if (seconds < 86400) return rtf.format(-Math.round(seconds / 3600), "hour");
  if (seconds < 86400 * 30) return rtf.format(-Math.round(seconds / 86400), "day");
  if (seconds < 86400 * 365) return rtf.format(-Math.round(seconds / (86400 * 30.4)), "month");
  return rtf.format(-Math.round(seconds / (86400 * 365)), "year");
}
