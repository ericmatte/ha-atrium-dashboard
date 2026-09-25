// Full-screen dev dashboard: the real Atrium Home view driven by the fake
// hass — mirrors what strategy.js actually assembles (one atrium-header +
// one atrium-rooms), rather than an isolated component gallery. The entity
// variety (dimmable/color/onoff lights, tilting covers, climate modes,
// leak/door/motion sensors, diagnostic filtering, …) already lives inline
// across the fixture floors/areas, so there's nothing extra to stage.
import "./ha-icon.js";
import "../src/components/header.js";
import "../src/components/rooms-view.js";
import { createMockHass } from "./mock-hass.js";
import { ALL_FLOOR_KEY } from "../src/lib/shell.js";

const toastEl = document.getElementById("toast");
let toastTimer = 0;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

const { hass, subscribe, startHeartbeat, cycleWeather } = createMockHass({ onToast: showToast });

// The weather pill's click normally opens more-info; there's nothing to open
// here, so cycle through every condition instead — an easy way to eyeball
// every weather icon without hand-editing fixtures.
window.addEventListener("hass-more-info", (e) => {
  if (e.detail.entityId === "weather.home") {
    cycleWeather(e.detail.entityId);
  } else {
    showToast(`hass-more-info → ${e.detail.entityId}`);
  }
});

const mounted = [];
function mount(tag, config, host) {
  const el = document.createElement(tag);
  el.setConfig(config);
  host.appendChild(el);
  el.hass = hass;
  mounted.push(el);
  return el;
}

subscribe((h) => {
  for (const el of mounted) el.hass = h;
});
startHeartbeat();

// Same floor list/order strategy.js builds (real floors, then the virtual
// "Other" floor for orphan areas).
const FLOORS = [
  { floor_id: "ground", name: "Ground Floor", icon: "mdi:home-floor-0" },
  { floor_id: "basement", name: "Basement", icon: "mdi:home-floor-b" },
  { floor_id: null, name: "Other", icon: "mdi:map-marker-outline" },
];

const view = document.createElement("div");
view.className = "dev-view is-active";
document.getElementById("views").appendChild(view);
mount("atrium-header", { floor: ALL_FLOOR_KEY }, view);
mount("atrium-rooms", { floors: FLOORS }, view);

// `?room=<area_id>` opens that room's details panel on load — handy for
// screenshots (e.g. the README's preview).
const room = new URLSearchParams(location.search).get("room");
if (room) setTimeout(() => document.querySelector("atrium-rooms")?._select(room));
