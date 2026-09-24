import test from "node:test";
import assert from "node:assert/strict";
import "../../tools/register.mjs";

const { _bindSwipeTile, _updateToggleRef, _updateLightRef, _updateSwitchRef, _updateClimateRef, _wireClimateMode, _updateAutomationRef } = await import("./area-card-updaters.js");

// Minimal fakes for the DOM surface _bindSwipeTile touches. Pointer event
// listeners are captured directly so tests can invoke them without a real
// PointerEvent/EventTarget stack.
function makeTile() {
  const handlers = {};
  return {
    handlers,
    classList: { contains: () => false, add() {}, remove() {} },
    addEventListener(type, fn) { handlers[type] = fn; },
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, width: 100 }),
  };
}

function makeStyleEl() {
  return { style: {}, classList: { add() {}, remove() {} }, textContent: "" };
}

function makeWindow() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type, fn) { if (listeners[type] === fn) delete listeners[type]; },
  };
}

function makeContext(states) {
  const calls = [];
  return {
    _hass: { states, entities: {} },
    _dragState: new Map(),
    _call: (...args) => calls.push(args),
    _moreInfo: () => {},
    _updateToggleRef,
    calls,
  };
}

// Minimal fakes for the tile/fill/thumb/swatch/state DOM surface that
// _updateToggleRef (and the _updateLightRef/_updateSwitchRef wrappers around
// it) read and write.
function makeClassList() {
  const classes = new Set();
  return {
    classes,
    toggle(name, on) { on ? classes.add(name) : classes.delete(name); },
    add(name) { classes.add(name); },
    remove(name) { classes.delete(name); },
    contains(name) { return classes.has(name); },
  };
}

function makeToggleRef() {
  return {
    tile: { classList: makeClassList(), style: { setProperty() {}, removeProperty() {} } },
    fill: { style: {} },
    thumb: { style: {} },
    swatch: { classList: makeClassList() },
    iconEl: { setAttribute() {} },
    state: { classList: makeClassList(), textContent: "" },
  };
}

function pressAndDrift(tile, win, { dx = 10, dy = 0 } = {}) {
  tile.handlers.pointerdown({ clientX: 0, clientY: 0, pointerId: 1 });
  win.listeners.pointermove({ clientX: dx, clientY: dy, pointerId: 1 });
}

test("switch tile: a small horizontal drift still toggles on release (no dead swipe)", () => {
  const origWindow = globalThis.window;
  globalThis.window = makeWindow();
  try {
    const tile = makeTile();
    const fill = makeStyleEl();
    const thumb = makeStyleEl();
    const stateEl = makeStyleEl();
    const entityId = "switch.fan";
    const ctx = makeContext({ [entityId]: { state: "off", attributes: {} } });

    _bindSwipeTile.call(ctx, tile, fill, thumb, /* swatch */ {}, stateEl, entityId, "switch");

    pressAndDrift(tile, globalThis.window, { dx: 10 });
    globalThis.window.listeners.pointerup({ clientX: 10, clientY: 0, pointerId: 1 });

    assert.deepEqual(ctx.calls, [["switch", "turn_on", { entity_id: entityId }]]);
  } finally {
    globalThis.window = origWindow;
  }
});

test("non-dimmable light tile: a small horizontal drift still toggles on release", () => {
  const origWindow = globalThis.window;
  globalThis.window = makeWindow();
  try {
    const tile = makeTile();
    const fill = makeStyleEl();
    const thumb = makeStyleEl();
    const stateEl = makeStyleEl();
    const entityId = "light.hallway";
    const ctx = makeContext({
      [entityId]: { state: "off", attributes: { supported_color_modes: ["onoff"] } },
    });

    _bindSwipeTile.call(ctx, tile, fill, thumb, /* swatch */ {}, stateEl, entityId, "light");

    pressAndDrift(tile, globalThis.window, { dx: 10 });
    globalThis.window.listeners.pointerup({ clientX: 10, clientY: 0, pointerId: 1 });

    assert.deepEqual(ctx.calls, [["light", "turn_on", { entity_id: entityId }]]);
  } finally {
    globalThis.window = origWindow;
  }
});

test("dimmable light tile: a horizontal drag still previews and commits a brightness (regression)", () => {
  const origWindow = globalThis.window;
  globalThis.window = makeWindow();
  try {
    const tile = makeTile();
    const fill = makeStyleEl();
    const thumb = makeStyleEl();
    const stateEl = makeStyleEl();
    const entityId = "light.living_room";
    const ctx = makeContext({
      [entityId]: { state: "on", attributes: { supported_color_modes: ["brightness"] } },
    });

    _bindSwipeTile.call(ctx, tile, fill, thumb, /* swatch */ {}, stateEl, entityId, "light");

    pressAndDrift(tile, globalThis.window, { dx: 50 });
    globalThis.window.listeners.pointermove({ clientX: 60, clientY: 0, pointerId: 1 });
    globalThis.window.listeners.pointerup({ clientX: 60, clientY: 0, pointerId: 1 });

    assert.equal(ctx.calls.length, 1);
    assert.equal(ctx.calls[0][0], "light");
    assert.equal(ctx.calls[0][1], "turn_on");
    assert.equal(ctx.calls[0][2].entity_id, entityId);
    assert.equal(ctx.calls[0][2].brightness_pct, 60);
  } finally {
    globalThis.window = origWindow;
  }
});

// _updateLightRef and _updateSwitchRef both delegate to the shared
// _updateToggleRef (see PR #12 review comment); these cover that each still
// gets its kind-specific behavior through that shared path.

test("_updateSwitchRef: dimmable-looking attributes are still ignored (switches never dim)", () => {
  const ref = makeToggleRef();
  const entityId = "switch.fan";
  const ctx = makeContext({
    [entityId]: { state: "on", attributes: { brightness: 128 }, last_updated: "2024-01-01T00:00:00Z" },
  });

  _updateSwitchRef.call(ctx, ref, entityId);

  assert.equal(ref.tile.classList.contains("no-dim"), true);
  assert.equal(ref.fill.style.width, "100%");
  assert.equal(ref.thumb.style.display, "none");
  assert.equal(ref.state.textContent.startsWith("On"), true);
});

test("_updateSwitchRef: unavailable state renders as unavailable with no fill", () => {
  const ref = makeToggleRef();
  const entityId = "switch.fan";
  const ctx = makeContext({ [entityId]: { state: "unavailable", attributes: {} } });

  _updateSwitchRef.call(ctx, ref, entityId);

  assert.equal(ref.tile.classList.contains("unavailable"), true);
  assert.equal(ref.fill.style.width, "0%");
  assert.equal(ref.state.textContent, "Unavailable");
});

test("_updateLightRef: dimmable light on renders a brightness percentage and thumb", () => {
  const ref = makeToggleRef();
  const entityId = "light.living_room";
  const ctx = makeContext({
    [entityId]: {
      state: "on",
      attributes: { supported_color_modes: ["brightness"], brightness: 128 },
      last_updated: "2024-01-01T00:00:00Z",
    },
  });

  _updateLightRef.call(ctx, ref, entityId);

  assert.equal(ref.tile.classList.contains("no-dim"), false);
  assert.equal(ref.fill.style.width, "50%");
  assert.equal(ref.thumb.style.display, "block");
  assert.equal(ref.state.textContent.startsWith("50%"), true);
});

test("_updateLightRef: non-dimmable light on renders 'On' with no thumb (matches switch styling)", () => {
  const ref = makeToggleRef();
  const entityId = "light.hallway";
  const ctx = makeContext({
    [entityId]: { state: "on", attributes: { supported_color_modes: ["onoff"] } },
  });

  _updateLightRef.call(ctx, ref, entityId);

  assert.equal(ref.tile.classList.contains("no-dim"), true);
  assert.equal(ref.fill.style.width, "100%");
  assert.equal(ref.thumb.style.display, "none");
  assert.equal(ref.state.textContent, "On");
});

test("_updateLightRef: a drag in progress leaves the ref untouched", () => {
  const ref = makeToggleRef();
  const entityId = "light.living_room";
  const ctx = makeContext({
    [entityId]: { state: "on", attributes: { supported_color_modes: ["brightness"], brightness: 255 } },
  });
  ctx._dragState.set(entityId, { pct: 10, kind: "light" });

  _updateLightRef.call(ctx, ref, entityId);

  assert.equal(ref.state.textContent, ""); // untouched
});

// Minimal fakes for the compact inline climate row (icon, name+meta, target
// controls) — no graph, no fan/swing menus.
function makeClimateRef() {
  return {
    tile: { style: {} },
    swatch: { style: {}, innerHTML: "", dataset: {} },
    meta: { textContent: "" },
    temp: { textContent: "" },
    modeMenu: {
      items: null, current: null, onPick: null,
      setItems(items, current, onPick) { this.items = items; this.current = current; this.onPick = onPick; },
    },
  };
}

function makeClimateContext(states) {
  const calls = [];
  return {
    _hass: { states },
    _call: (...args) => calls.push(args),
    _updateClimateRef,
    _wireClimateMode,
    calls,
  };
}

test("_updateClimateRef: heat mode with a target shows mode/current in meta and the target in temp", () => {
  const ref = makeClimateRef();
  const ctx = makeClimateContext({
    "climate.x": {
      state: "heat",
      attributes: { current_temperature: 19.8, temperature: 21, target_temp_step: 1, hvac_modes: ["heat", "off"] },
    },
  });
  ctx._updateClimateRef(ref, "climate.x");
  assert.equal(ref.meta.textContent, "Heat · 19.8°");
  assert.equal(ref.temp.textContent, "21°");
});

test("_updateClimateRef: off mode shows 'Off' even with a stale target still on the entity", () => {
  const ref = makeClimateRef();
  const ctx = makeClimateContext({ "climate.x": { state: "off", attributes: { temperature: 21 } } });
  ctx._updateClimateRef(ref, "climate.x");
  assert.equal(ref.temp.textContent, "Off");
});

test("_updateClimateRef: fan_only mode shows a dash even with a target present", () => {
  const ref = makeClimateRef();
  const ctx = makeClimateContext({ "climate.x": { state: "fan_only", attributes: { temperature: 21 } } });
  ctx._updateClimateRef(ref, "climate.x");
  assert.equal(ref.temp.textContent, "—");
});

test("_wireClimateMode: a single-hvac-mode entity gets no mode menu", () => {
  const ref = makeClimateRef();
  const ctx = makeClimateContext({});
  ctx._wireClimateMode(ref, "climate.x", { hvac_modes: ["heat"] }, "heat");
  assert.equal(ref.swatch.dataset.menu, "");
  assert.equal(ref.modeMenu.items, null);
});

test("_wireClimateMode: a multi-hvac-mode entity wires the mode menu, and picking one calls set_hvac_mode", () => {
  const ref = makeClimateRef();
  const ctx = makeClimateContext({});
  ctx._wireClimateMode(ref, "climate.x", { hvac_modes: ["heat", "cool", "off"] }, "heat");
  assert.equal(ref.swatch.dataset.menu, "mode");
  assert.equal(ref.modeMenu.items.length, 3);
  ref.modeMenu.onPick("cool");
  assert.deepEqual(ctx.calls, [["climate", "set_hvac_mode", { entity_id: "climate.x", hvac_mode: "cool" }]]);
});

function makeAutomationRef(isScript) {
  return {
    isScript,
    row: { classList: makeClassList() },
    name: { classList: makeClassList() },
    status: isScript ? null : { textContent: "" },
    last: { textContent: "" },
    labels: { innerHTML: "" },
    play: { classList: makeClassList() },
  };
}

test("_updateAutomationRef: an enabled automation shows an 'On' status line and just the relative timestamp", () => {
  const ref = makeAutomationRef(false);
  const ctx = makeContext({
    "automation.motion": { state: "on", attributes: { last_triggered: new Date(Date.now() - 5 * 60000).toISOString() } },
  });
  ctx._hass.entities = {};
  _updateAutomationRef.call(ctx, ref, "automation.motion");
  assert.equal(ref.status.textContent, "On");
  assert.equal(ref.last.textContent.includes("Last triggered"), false);
  assert.ok(ref.row.classList.contains("disabled") === false);
});

test("_updateAutomationRef: a disabled automation shows 'Off' and disables the row/play button", () => {
  const ref = makeAutomationRef(false);
  const ctx = makeContext({ "automation.motion": { state: "off", attributes: {} } });
  ctx._hass.entities = {};
  _updateAutomationRef.call(ctx, ref, "automation.motion");
  assert.equal(ref.status.textContent, "Off");
  assert.equal(ref.last.textContent, "Never triggered");
  assert.equal(ref.row.classList.contains("disabled"), true);
  assert.equal(ref.play.classList.contains("disabled"), true);
});

test("_updateAutomationRef: a labeled automation gets one chip per label, with an icon only when the label has one", () => {
  const prevDocument = globalThis.document;
  const chips = [];
  globalThis.document = {
    createElement: () => {
      const chip = { className: "", style: {}, innerHTML: "" };
      chips.push(chip);
      return chip;
    },
  };
  try {
    const ref = makeAutomationRef(false);
    const appended = [];
    ref.labels = { innerHTML: "", appendChild(c) { appended.push(c); } };
    const ctx = makeContext({ "automation.motion": { state: "on", attributes: {} } });
    ctx._hass.entities = { "automation.motion": { labels: ["important", "silent"] } };
    ctx._hass.labels = {
      important: { name: "Important", color: "amber" },
      silent: { name: "Silent", color: "grey", icon: "mdi:volume-off" },
    };

    _updateAutomationRef.call(ctx, ref, "automation.motion");

    assert.equal(appended.length, 2);
    assert.equal(chips[0].innerHTML, "Important");
    assert.ok(chips[1].innerHTML.includes("Silent"));
    assert.ok(chips[1].innerHTML.includes("mdi:volume-off"));
  } finally {
    globalThis.document = prevDocument;
  }
});

test("_updateAutomationRef: a script has no status line to update", () => {
  const ref = makeAutomationRef(true);
  const ctx = makeContext({ "script.good_night": { state: "off", attributes: {} } });
  ctx._hass.entities = {};
  _updateAutomationRef.call(ctx, ref, "script.good_night");
  assert.equal(ref.status, null);
  assert.equal(ref.last.textContent, "Never triggered");
});
