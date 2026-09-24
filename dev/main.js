// Full-screen dev dashboard: one real, tabbed Atrium dashboard driven by the
// fake hass — mirrors what strategy.js actually assembles (Home, with
// climate merged inline / Routines), rather than an isolated component
// gallery. The
// entity variety (dimmable/color/onoff lights, tilting covers, climate modes,
// leak/door/motion sensors, diagnostic filtering, …) already lives inline
// across the fixture floors/areas, so there's nothing extra to stage.
import "./ha-icon.js";
import "../src/components/header.js";
import "../src/components/floor-label.js";
import "../src/components/area-card.js";
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

const viewsHost = document.getElementById("views");

function buildView({ headerConfig, floorLabelShowControls, areaCardConfig }) {
  const view = document.createElement("div");
  view.className = "dev-view";
  viewsHost.appendChild(view);
  // atrium-area-card's masonry packing reads each column's offsetHeight
  // synchronously while building — under display:none that's always 0, so
  // every card would land in the first column. Force-visible for the build,
  // then let the CSS class (hidden unless .is-active) take back over.
  view.style.display = "block";
  mount("atrium-header", headerConfig, view);
  for (const f of FLOORS) {
    mount(
      "atrium-floor-label",
      { name: f.name, icon: f.icon, floor: f.floor_id, show_controls: floorLabelShowControls },
      view
    );
    mount("atrium-area-card", { floor: f.floor_id, ...areaCardConfig }, view);
  }
  view.style.display = "";
  return view;
}

const TABS = [
  {
    key: "home",
    label: "Home",
    icon: "mdi:home",
    view: buildView({
      headerConfig: { floor: ALL_FLOOR_KEY, welcome_name: "Eric" },
      floorLabelShowControls: true,
      areaCardConfig: { exclude: ["automations", "scripts"] },
    }),
  },
  {
    key: "routines",
    label: "Routines",
    icon: "mdi:robot",
    view: buildView({
      headerConfig: { floor: ALL_FLOOR_KEY, title: "Routines" },
      floorLabelShowControls: false,
      areaCardConfig: { sections: ["scenes", "routines"] },
    }),
  },
];

const tabbar = document.getElementById("tabbar");
const tabButtons = new Map();
for (const t of TABS) {
  const btn = document.createElement("button");
  btn.className = "dev-tab";
  btn.innerHTML = `<ha-icon icon="${t.icon}"></ha-icon><span>${t.label}</span>`;
  btn.addEventListener("click", () => selectTab(t.key));
  tabbar.appendChild(btn);
  tabButtons.set(t.key, btn);
}
const note = document.createElement("div");
note.className = "dev-tabbar-note";
note.textContent = "Atrium dev · edit src/ and reload";
tabbar.appendChild(document.createElement("div")).className = "dev-tabbar-spacer";
tabbar.appendChild(note);

function selectTab(key) {
  for (const t of TABS) {
    const active = t.key === key;
    t.view.classList.toggle("is-active", active);
    tabButtons.get(t.key).classList.toggle("is-active", active);
  }
}
selectTab("home");

// atrium-header sticks itself at `top: var(--header-height, 0px)` — publish
// our tab bar's height there so it parks just below it instead of under it.
document.documentElement.style.setProperty("--header-height", `${tabbar.offsetHeight}px`);
