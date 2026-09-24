// area-card.js is a custom element with no direct exports (it only calls
// customElements.define at the bottom). Stub the browser globals it touches
// at import time (HTMLElement, customElements) so the module graph can load
// under plain Node, then grab the registered class out of the
// customElements.define() call.
import test from "node:test";
import assert from "node:assert/strict";
import "../../tools/register.mjs";

globalThis.HTMLElement = class {};
globalThis.window = globalThis;
let registered;
globalThis.customElements = { define: (_tag, cls) => { registered = cls; } };

await import("./area-card.js");
const AtriumAreaCard = registered;

function makeCard() {
  return Object.create(AtriumAreaCard.prototype);
}

test("_classify: a binary_sensor with no motion/leak/door device_class and no shared device lands in sensors.other", () => {
  const card = makeCard();
  card._hass = {
    states: { "binary_sensor.mystery": { state: "on", attributes: {} } },
  };
  const area = { area_id: "kitchen" };
  const data = card._classify(area, [{ entity_id: "binary_sensor.mystery" }]);
  assert.equal(data.sensors.other.length, 1);
  assert.equal(data.sensors.other[0].entity_id, "binary_sensor.mystery");
});

test("_areaIsEmpty: a room whose only entity is a non-device-linked 'other' binary_sensor is not empty (regression)", () => {
  const card = makeCard();
  const data = card._emptyData();
  data.sensors.other = [{ entity_id: "binary_sensor.mystery" }];
  assert.equal(card._areaIsEmpty(data), false);
});

test("_areaIsEmpty: a room with nothing classified stays empty", () => {
  const card = makeCard();
  assert.equal(card._areaIsEmpty(card._emptyData()), true);
});

test("_filterData: a 'sensors' section profile keeps sensors.other alongside extras", () => {
  const card = makeCard();
  card._sections = new Set(["sensors"]);
  card._exclude = null;
  const data = card._emptyData();
  data.sensors.other = [{ entity_id: "binary_sensor.mystery" }];
  data.sensors.extras = [{ entity_id: "sensor.co2" }];
  const filtered = card._filterData(data);
  assert.equal(filtered.sensors.other.length, 1);
  assert.equal(filtered.sensors.extras.length, 1);
});

test("_layoutMasonry: greedily packs each card into the currently shortest column", () => {
  function makeMockCard(height) {
    return { style: { setProperty() {} }, offsetHeight: height };
  }
  function makeMockCol() {
    const children = [];
    return {
      className: "",
      get offsetHeight() {
        return children.reduce((sum, c) => sum + c.offsetHeight, 0);
      },
      appendChild: (child) => children.push(child),
      querySelectorAll: () => children,
    };
  }

  const prevDocument = globalThis.document;
  const prevGetComputedStyle = globalThis.getComputedStyle;
  globalThis.document = { createElement: () => makeMockCol() };
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (name) => ({ "--atrium-cols": "2" })[name] || "",
  });

  try {
    const cardEl = makeCard();
    const root = { replaceChildren() {}, appendChild() {} };
    cardEl._root = root;
    const cardA = makeMockCard(100);
    const cardB = makeMockCard(150);
    const cardC = makeMockCard(80);
    cardEl._roomCards = [cardA, cardB, cardC];

    cardEl._layoutMasonry();

    // col0 gets A (100) then, being shorter than col1 (150), also gets C (80).
    assert.deepEqual(cardEl._cols[0].querySelectorAll(), [cardA, cardC]);
    assert.deepEqual(cardEl._cols[1].querySelectorAll(), [cardB]);
  } finally {
    globalThis.document = prevDocument;
    globalThis.getComputedStyle = prevGetComputedStyle;
  }
});

// Minimal generic DOM element mock — just enough surface for the builder
// functions (className/classList, style, dataset, append/appendChild,
// addEventListener, innerHTML/textContent) to run under plain Node.
function makeMockElement() {
  const classes = new Set();
  const node = {
    children: [],
    dataset: {},
    style: {},
    textContent: "",
    innerHTML: "",
    handlers: {},
    appendChild(child) { node.children.push(child); return child; },
    append(...kids) { kids.forEach((k) => node.children.push(k)); },
    addEventListener(type, fn) { node.handlers[type] = fn; },
    setAttribute() {},
    querySelector() { return null; },
  };
  Object.defineProperty(node, "className", {
    get() { return [...classes].join(" "); },
    set(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
  });
  node.classList = {
    add: (...cls) => cls.forEach((c) => classes.add(c)),
    toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    contains: (c) => classes.has(c),
    remove: (...cls) => cls.forEach((c) => classes.delete(c)),
  };
  return node;
}

test("_buildLightsSection: the climate tile merges into the same grid, after the light tiles", () => {
  const prevDocument = globalThis.document;
  globalThis.document = { createElement: () => makeMockElement() };
  try {
    const card = makeCard();
    card._hass = { entities: {}, states: {} };
    card._refs = { areas: new Map([["living_room", { lights: new Map(), climates: new Map() }]]) };
    const area = { area_id: "living_room", name: "Living Room" };
    const light = { entity_id: "light.main" };
    const climate = { entity_id: "climate.heat_pump" };

    const section = card._buildLightsSection(area, [light], [climate], undefined);
    const grid = section.children[0].children[0];

    assert.equal(grid.className, "atrium-grid cols-1");
    assert.equal(grid.children.length, 2);
    assert.equal(grid.children[0].className, "atrium-tile");
    assert.equal(grid.children[1].className, "atrium-tile wide atrium-climate");
    // Simplified tile: swatch, name+meta text, and the −/target/+ controls —
    // no graph layer, no 24h meta row, no fan/swing extras.
    assert.equal(grid.children[1].children.length, 3);
    assert.ok(card._refs.areas.get("living_room").lights.has("light.main"));
    assert.ok(card._refs.areas.get("living_room").climates.has("climate.heat_pump"));
  } finally {
    globalThis.document = prevDocument;
  }
});

test("_buildLightsSection: two lights still get a 2-column grid; a lone light stays 1-column", () => {
  const prevDocument = globalThis.document;
  globalThis.document = { createElement: () => makeMockElement() };
  try {
    const card = makeCard();
    card._hass = { entities: {}, states: {} };
    card._refs = { areas: new Map([["kitchen", { lights: new Map(), climates: new Map() }]]) };
    const area = { area_id: "kitchen", name: "Kitchen" };
    const lights = [{ entity_id: "light.a" }, { entity_id: "light.b" }];

    const grid = card._buildLightsSection(area, lights, [], undefined).children[0].children[0];
    assert.equal(grid.className, "atrium-grid cols-2");
  } finally {
    globalThis.document = prevDocument;
  }
});

function makeClimateCard(attributes) {
  const card = makeCard();
  const calls = [];
  card._hass = { states: { "climate.x": { state: "cool", attributes } } };
  card._call = (domain, service, data) => calls.push({ domain, service, data });
  return { card, calls };
}

test("_adjustClimate: an entity with target_temp_step 1 moves by a full degree", () => {
  const { card, calls } = makeClimateCard({ temperature: 20, target_temp_step: 1, min_temp: 16, max_temp: 29 });
  card._adjustClimate("climate.x", 1);
  card._adjustClimate("climate.x", -1);
  assert.deepEqual(calls.map((c) => c.data.temperature), [21, 19]);
});

test("_adjustClimate: an entity with no target_temp_step falls back to half-degree steps", () => {
  const { card, calls } = makeClimateCard({ temperature: 16, min_temp: 0, max_temp: 50 });
  card._adjustClimate("climate.x", 1);
  card._adjustClimate("climate.x", -1);
  assert.deepEqual(calls.map((c) => c.data.temperature), [16.5, 15.5]);
});

test("_adjustClimate: the setpoint stays within min_temp/max_temp", () => {
  const { card: atMax, calls: maxCalls } = makeClimateCard({ temperature: 29, target_temp_step: 1, min_temp: 16, max_temp: 29 });
  atMax._adjustClimate("climate.x", 1);
  assert.deepEqual(maxCalls, []);

  const { card: atMin, calls: minCalls } = makeClimateCard({ temperature: 16, target_temp_step: 1, min_temp: 16, max_temp: 29 });
  atMin._adjustClimate("climate.x", -1);
  assert.deepEqual(minCalls, []);
});

test("_adjustClimate: an off-grid setpoint snaps onto the device's step grid", () => {
  const { card, calls } = makeClimateCard({ temperature: 20.5, target_temp_step: 1, min_temp: 16, max_temp: 29 });
  card._adjustClimate("climate.x", -1);
  assert.deepEqual(calls.map((c) => c.data.temperature), [20]);
});

test("_classify: a primary button entity lands in buttons, a config/diagnostic one is dropped", () => {
  const card = makeCard();
  card._hass = { states: {} };
  const area = { area_id: "living_room" };
  const data = card._classify(area, [
    { entity_id: "button.fan_power" },
    { entity_id: "button.speaker_restart", entity_category: "config" },
  ]);
  assert.deepEqual(data.buttons.map((b) => b.entity_id), ["button.fan_power"]);
});

test("_areaIsEmpty: a room whose only entity is a button is not empty", () => {
  const card = makeCard();
  const data = card._emptyData();
  data.buttons = [{ entity_id: "button.fan_power" }];
  assert.equal(card._areaIsEmpty(data), false);
});

test("_filterData: excluding climates/automations/scripts keeps buttons", () => {
  const card = makeCard();
  card._sections = null;
  card._exclude = new Set(["climates", "automations", "scripts"]);
  const data = card._emptyData();
  data.buttons = [{ entity_id: "button.fan_power" }];
  assert.equal(card._filterData(data).buttons.length, 1);
});

test("_filterData: a section profile without 'buttons' drops them", () => {
  const card = makeCard();
  card._sections = new Set(["scenes", "routines"]);
  card._exclude = null;
  const data = card._emptyData();
  data.buttons = [{ entity_id: "button.fan_power" }];
  assert.equal(card._filterData(data).buttons.length, 0);
});

test("_buildButtonsSection: tap presses the button, long-press opens its more-info", () => {
  const card = makeCard();
  card._hass = { entities: {}, states: {} };
  const calls = [];
  const moreInfos = [];
  card._call = (domain, service, data) => calls.push({ domain, service, data });
  card._moreInfo = (entityId) => moreInfos.push(entityId);
  let opts;
  card._buildBadgeRow = (_area, _entities, o) => { opts = o; };

  const button = { entity_id: "button.fan_power" };
  card._buildButtonsSection({ area_id: "living_room" }, [button]);
  opts.onPress(button);
  opts.onHold(button);

  assert.deepEqual(calls, [
    { domain: "button", service: "press", data: { entity_id: "button.fan_power" } },
  ]);
  assert.deepEqual(moreInfos, ["button.fan_power"]);
});

function withMockLocalStorage(fn) {
  const store = new Map();
  const prev = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  try {
    fn(store);
  } finally {
    globalThis.localStorage = prev;
  }
}

test("_buildScenesSection: bg reads the cached gradient, onPress activates the scene and schedules a refresh", () => {
  withMockLocalStorage((store) => {
    const card = makeCard();
    const calls = [];
    card._call = (domain, service, data) => calls.push({ domain, service, data });
    const refreshed = [];
    card._refreshSceneGradient = (entityId, btn) => refreshed.push({ entityId, btn });
    let opts;
    card._buildBadgeRow = (_area, _entities, o) => { opts = o; };

    store.set("atrium-scene-gradient:scene.movie", "linear-gradient(90deg, red, blue)");
    const scene = { entity_id: "scene.movie" };
    card._buildScenesSection({ area_id: "living_room" }, [scene]);

    assert.equal(opts.bg(scene), "linear-gradient(90deg, red, blue)");

    const fakeBtn = {};
    opts.onPress(scene, fakeBtn);
    assert.deepEqual(calls, [{ domain: "scene", service: "turn_on", data: { entity_id: "scene.movie" } }]);
    assert.deepEqual(refreshed, [{ entityId: "scene.movie", btn: fakeBtn }]);
  });
});

test("_refreshSceneGradient: samples the scene's lights after a delay and caches the result", () => {
  withMockLocalStorage((store) => {
    const card = makeCard();
    card._hass = {
      states: {
        "scene.movie": { attributes: { entity_id: ["light.a"] } },
        "light.a": { state: "on", attributes: { color_mode: "rgb", rgb_color: [10, 20, 30] } },
      },
    };
    const btn = { style: {} };
    const prevTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => fn();
    try {
      card._refreshSceneGradient("scene.movie", btn);
    } finally {
      globalThis.setTimeout = prevTimeout;
    }

    const expected = "linear-gradient(90deg, rgb(10 20 30 / 0.35), rgb(10 20 30 / 0.35))";
    assert.equal(btn.style.background, expected);
    assert.equal(store.get("atrium-scene-gradient:scene.movie"), expected);
  });
});

test("_refreshSceneGradient: a scene with no contributing lights leaves the badge untouched", () => {
  withMockLocalStorage((store) => {
    const card = makeCard();
    card._hass = { states: { "scene.quiet": { attributes: { entity_id: ["switch.a"] } }, "switch.a": { state: "on", attributes: {} } } };
    const btn = { style: {} };
    const prevTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => fn();
    try {
      card._refreshSceneGradient("scene.quiet", btn);
    } finally {
      globalThis.setTimeout = prevTimeout;
    }
    assert.equal(btn.style.background, undefined);
    assert.equal(store.has("atrium-scene-gradient:scene.quiet"), false);
  });
});

function makeMockDocument() {
  return {
    createElement: (tag) => Object.assign(makeMockElement(), { tagName: tag }),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  };
}

test("_buildAutomationRow: an automation's swatch is a tappable button that toggles it on/off", () => {
  const prevDocument = globalThis.document;
  globalThis.document = makeMockDocument();
  try {
    const card = makeCard();
    const calls = [];
    card._hass = { entities: {}, states: { "automation.motion": { state: "on", attributes: {} } } };
    card._call = (domain, service, data) => calls.push({ domain, service, data });
    card._refs = { areas: new Map([["hall", { automations: new Map() }]]) };

    const row = card._buildAutomationRow({ area_id: "hall" }, { entity_id: "automation.motion" });
    const swatch = row.children[0];

    assert.equal(swatch.tagName, "button");
    assert.equal(swatch.className, "atrium-auto-swatch");

    swatch.handlers.click({ stopPropagation() {} });
    assert.deepEqual(calls, [
      { domain: "automation", service: "turn_off", data: { entity_id: "automation.motion" } },
    ]);

    // Status ("On"/"Off") and the last-triggered timestamp share one line.
    const body = row.children[1];
    const titleLine = body.children[0];
    const lastLine = body.children[1];
    const ref = card._refs.areas.get("hall").automations.get("automation.motion");
    assert.equal(titleLine.className, "atrium-auto-title");
    assert.equal(titleLine.children[0], ref.name);
    assert.equal(titleLine.children[1], ref.labels);
    assert.equal(lastLine.className, "atrium-auto-last");
    assert.equal(lastLine.children[0], ref.status);
    assert.equal(lastLine.children[2], ref.last);
  } finally {
    globalThis.document = prevDocument;
  }
});

test("_buildAutomationRow: a script's swatch is a static (non-toggling) icon and there's no status line", () => {
  const prevDocument = globalThis.document;
  globalThis.document = makeMockDocument();
  try {
    const card = makeCard();
    card._hass = { entities: {}, states: { "script.good_night": { state: "off", attributes: {} } } };
    card._refs = { areas: new Map([["hall", { automations: new Map() }]]) };

    const row = card._buildAutomationRow({ area_id: "hall" }, { entity_id: "script.good_night" });
    const swatch = row.children[0];
    const ref = card._refs.areas.get("hall").automations.get("script.good_night");

    assert.equal(swatch.tagName, "div");
    assert.equal(swatch.className, "atrium-auto-swatch script");
    assert.equal(swatch.handlers.click, undefined);
    assert.equal(ref.status, null);
  } finally {
    globalThis.document = prevDocument;
  }
});
