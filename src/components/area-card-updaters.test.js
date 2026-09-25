import test from "node:test";
import assert from "node:assert/strict";
import "../../tools/register.mjs";

const { _bindDivaTrack, _updateDivaRef, _toggleEntity, _updateClimateRef, _wireClimateMode, _updateAutomationRef, divaVisual } = await import("./area-card-updaters.js");

// Minimal fakes for the DOM surface _bindDivaTrack/_updateDivaRef touch.
// Pointer event listeners are captured directly so tests can invoke them
// without a real PointerEvent/EventTarget stack. The track's geometry
// (height 146, so usable travel = 146 - 34(thumb) - 12(pad*2) = 100) is
// chosen so a few round pointer-Y values map to clean 0/50/100% fractions.
function makeClassList() {
  const classes = new Set();
  return {
    classes,
    toggle(name, on) { on ? classes.add(name) : classes.delete(name); },
    add(...names) { names.forEach((n) => classes.add(n)); },
    remove(...names) { names.forEach((n) => classes.delete(n)); },
    contains(name) { return classes.has(name); },
  };
}

function makeTrack() {
  const handlers = {};
  return {
    handlers,
    classList: makeClassList(),
    disabled: false,
    addEventListener(type, fn) { handlers[type] = fn; },
    setPointerCapture() {},
    releasePointerCapture() {},
    setAttribute() {},
    getBoundingClientRect: () => ({ bottom: 146, height: 146 }),
  };
}

function makeStyleEl() {
  return { style: {}, textContent: "" };
}

function makeDivaRef() {
  return {
    track: makeTrack(),
    fill: makeStyleEl(),
    pctTop: makeStyleEl(),
    pctBottom: makeStyleEl(),
    thumb: { style: {}, classList: makeClassList() },
    name: { textContent: "Fan" },
    ago: { textContent: "" },
  };
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
    _toggleEntity,
    _updateDivaRef,
    calls,
  };
}

function withWindow(fn) {
  const orig = globalThis.window;
  globalThis.window = makeWindow();
  try {
    fn(globalThis.window);
  } finally {
    globalThis.window = orig;
  }
}

test("switch track: a tap (no drag) toggles on release", () => {
  withWindow((win) => {
    const ref = makeDivaRef();
    const entityId = "switch.fan";
    const ctx = makeContext({ [entityId]: { state: "off", attributes: {} } });

    _bindDivaTrack.call(ctx, ref, entityId, "switch");
    ref.track.handlers.pointerdown({ clientY: 100, pointerId: 1 });
    win.listeners.pointerup({ clientY: 100, pointerId: 1 });

    assert.deepEqual(ctx.calls, [["switch", "turn_on", { entity_id: entityId }]]);
  });
});

test("non-dimmable light track: a tap toggles on release", () => {
  withWindow((win) => {
    const ref = makeDivaRef();
    const entityId = "light.hallway";
    const ctx = makeContext({ [entityId]: { state: "off", attributes: { supported_color_modes: ["onoff"] } } });

    _bindDivaTrack.call(ctx, ref, entityId, "light");
    ref.track.handlers.pointerdown({ clientY: 100, pointerId: 1 });
    win.listeners.pointerup({ clientY: 100, pointerId: 1 });

    assert.deepEqual(ctx.calls, [["light", "turn_on", { entity_id: entityId }]]);
  });
});

test("dimmable light track: dragging to a level previews and commits a brightness", () => {
  withWindow((win) => {
    const ref = makeDivaRef();
    const entityId = "light.living_room";
    const ctx = makeContext({ [entityId]: { state: "on", attributes: { supported_color_modes: ["brightness"], brightness: 0 } } });

    _bindDivaTrack.call(ctx, ref, entityId, "light");
    ref.track.handlers.pointerdown({ clientY: 100, pointerId: 1 });
    win.listeners.pointermove({ clientY: 73, pointerId: 1 }); // 50% up the track
    assert.equal(ref.pctTop.textContent, "50%"); // live preview, no service call yet
    assert.equal(ref.thumb.style.bottom, "calc((100% - 46px) * 0.500 + 6px)");
    assert.equal(ctx.calls.length, 0);

    win.listeners.pointerup({ clientY: 73, pointerId: 1 });

    assert.deepEqual(ctx.calls, [["light", "turn_on", { entity_id: entityId, brightness_pct: 50 }]]);
  });
});

test("cover track: dragging to the very top commits open_cover rather than a 100% position", () => {
  withWindow((win) => {
    const ref = makeDivaRef();
    const entityId = "cover.blind";
    const ctx = makeContext({ [entityId]: { state: "closed", attributes: { current_position: 0 } } });

    _bindDivaTrack.call(ctx, ref, entityId, "cover");
    ref.track.handlers.pointerdown({ clientY: 100, pointerId: 1 });
    win.listeners.pointermove({ clientY: 23, pointerId: 1 }); // 100% up the track
    win.listeners.pointerup({ clientY: 23, pointerId: 1 });

    assert.deepEqual(ctx.calls, [["cover", "open_cover", { entity_id: entityId }]]);
  });
});

test("switch track: dragging past the 80% flick threshold toggles on release (hysteresis)", () => {
  withWindow((win) => {
    const ref = makeDivaRef();
    const entityId = "switch.fan";
    const ctx = makeContext({ [entityId]: { state: "off", attributes: {} } });

    _bindDivaTrack.call(ctx, ref, entityId, "switch");
    ref.track.handlers.pointerdown({ clientY: 100, pointerId: 1 });
    win.listeners.pointermove({ clientY: 15, pointerId: 1 }); // 85% of the way to "on"
    win.listeners.pointerup({ clientY: 15, pointerId: 1 });

    assert.deepEqual(ctx.calls, [["switch", "turn_on", { entity_id: entityId }]]);
  });
});

test("switch track: dragging short of the 80% flick threshold does not toggle on release", () => {
  withWindow((win) => {
    const ref = makeDivaRef();
    const entityId = "switch.fan";
    const ctx = makeContext({ [entityId]: { state: "off", attributes: {} } });

    _bindDivaTrack.call(ctx, ref, entityId, "switch");
    ref.track.handlers.pointerdown({ clientY: 100, pointerId: 1 });
    win.listeners.pointermove({ clientY: 50, pointerId: 1 }); // 50% of the way — short of 80%
    win.listeners.pointerup({ clientY: 50, pointerId: 1 });

    assert.deepEqual(ctx.calls, []);
  });
});

test("_toggleEntity: turning a dimmable light on defaults to full brightness", () => {
  const calls = [];
  const ctx = { _hass: { states: { "light.a": { attributes: { supported_color_modes: ["brightness"] } } } }, _call: (...a) => calls.push(a) };
  _toggleEntity.call(ctx, "light.a", "light", true);
  assert.deepEqual(calls, [["light", "turn_on", { entity_id: "light.a", brightness_pct: 100 }]]);
});

test("_updateDivaRef: a dimmable light on renders a fill height, thumb, and crossfading pct labels", () => {
  const ref = makeDivaRef();
  const entityId = "light.living_room";
  const ctx = makeContext({
    [entityId]: { state: "on", attributes: { supported_color_modes: ["brightness"], brightness: 128 }, last_changed: "2024-01-01T00:00:00Z" },
  });

  _updateDivaRef.call(ctx, ref, entityId, "light");

  assert.equal(ref.fill.style.height, "calc((100% - 46px) * 0.500 * 1.000 + 29.0px)");
  assert.equal(ref.track.classList.contains("on"), true);
  assert.equal(ref.pctTop.textContent, "50%");
  assert.equal(ref.pctTop.style.display, "");
  assert.equal(ref.pctTop.style.opacity, "0.50");
  assert.equal(ref.pctBottom.style.opacity, "0.50");
});

test("_updateDivaRef: a switch on renders a full, solid fill with no pct label and a time-ago line", () => {
  const ref = makeDivaRef();
  const entityId = "switch.fan";
  const ctx = makeContext({ [entityId]: { state: "on", attributes: {}, last_changed: new Date(Date.now() - 12 * 60000).toISOString() } });

  _updateDivaRef.call(ctx, ref, entityId, "switch");

  assert.equal(ref.fill.style.height, "100%");
  assert.equal(ref.pctTop.style.display, "none");
  assert.equal(ref.ago.textContent, "12m ago");
});

test("_updateDivaRef: a state that just changed reads 'Just now'", () => {
  const ref = makeDivaRef();
  const ctx = makeContext({ "switch.fan": { state: "off", attributes: {}, last_changed: new Date().toISOString() } });
  _updateDivaRef.call(ctx, ref, "switch.fan", "switch");
  assert.equal(ref.ago.textContent, "Just now");
});

test("switch track: while dragging, the thumb rubber-bands but the fill stays on its notch", () => {
  withWindow((win) => {
    const ref = makeDivaRef();
    const ctx = makeContext({ "switch.fan": { state: "off", attributes: {} } });
    _bindDivaTrack.call(ctx, ref, "switch.fan", "switch");
    ref.track.handlers.pointerdown({ clientY: 100, pointerId: 1 });
    win.listeners.pointermove({ clientY: 50, pointerId: 1 });
    assert.equal(ref.fill.style.height, "0%");
    assert.notEqual(ref.thumb.style.bottom, "calc((100% - 46px) * 0.000 + 6px)");
    win.listeners.pointerup({ clientY: 50, pointerId: 1 });
  });
});

test("divaVisual: a light at 100% fills to the top of the track with a solid (unfaded) end", () => {
  const v = divaVisual({ kind: "light", on: true, level: 100, dimmable: true, color: "#f6c14b" });
  assert.equal(v.fillHeight, "calc((100% - 46px) * 1.000 * 1.000 + 46.0px)");
  assert.ok(v.fillBackground.endsWith("color-mix(in srgb, #f6c14b 90%, transparent) 100%)"));
  assert.equal(v.pctTopOpacity, "0.00");
  assert.equal(v.pctBottomOpacity, "1.00");
});

test("divaVisual: a light near 0% shrinks its fill toward nothing instead of jumping", () => {
  const v = divaVisual({ kind: "light", on: true, level: 5, dimmable: true, color: "#f6c14b" });
  assert.equal(v.fillHeight, "calc((100% - 46px) * 0.050 * 0.500 + 14.5px)");
});

test("divaVisual: a cover gets a solid fill centred on its icon", () => {
  const v = divaVisual({ kind: "cover", on: true, level: 40, dimmable: true, color: "#8cc1ff" });
  assert.equal(v.fillBackground, "color-mix(in srgb, #8cc1ff 90%, transparent)");
  assert.equal(v.fillHeight, "calc((100% - 46px) * 0.400 * 1.000 + 23.0px)");
});

test("divaVisual: an off dimmable light has no fill and no pct label", () => {
  const v = divaVisual({ kind: "light", on: false, level: 0, dimmable: true, color: "#f6c14b" });
  assert.equal(v.fillHeight, "0px");
  assert.equal(v.showPct, false);
  assert.equal(v.thumbBottom, "calc((100% - 46px) * 0.000 + 6px)");
});

test("_updateDivaRef: an unavailable entity disables the track with no fill", () => {
  const ref = makeDivaRef();
  const entityId = "switch.fan";
  const ctx = makeContext({ [entityId]: { state: "unavailable", attributes: {} } });

  _updateDivaRef.call(ctx, ref, entityId, "switch");

  assert.equal(ref.track.disabled, true);
  assert.equal(ref.track.classList.contains("un"), true);
  assert.equal(ref.fill.style.height, "0%");
  assert.equal(ref.ago.textContent, "Unavailable");
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
    flashUntil: 0,
    row: { classList: makeClassList() },
    swatch: { tagName: isScript ? "SPAN" : "BUTTON", setAttribute() {} },
    sub: { textContent: "" },
    labels: { innerHTML: "" },
    play: { classList: makeClassList() },
  };
}

test("_updateAutomationRef: an enabled automation shows 'On · <relative time>'", () => {
  const ref = makeAutomationRef(false);
  const ctx = makeContext({
    "automation.motion": { state: "on", attributes: { last_triggered: new Date(Date.now() - 5 * 60000).toISOString() } },
  });
  _updateAutomationRef.call(ctx, ref, "automation.motion");
  assert.equal(ref.sub.textContent, "On · 5 minutes ago");
  assert.equal(ref.row.classList.contains("off"), false);
});

test("_updateAutomationRef: a disabled automation shows 'Off · never' and disables the row/play button", () => {
  const ref = makeAutomationRef(false);
  const ctx = makeContext({ "automation.motion": { state: "off", attributes: {} } });
  _updateAutomationRef.call(ctx, ref, "automation.motion");
  assert.equal(ref.sub.textContent, "Off · never");
  assert.equal(ref.row.classList.contains("off"), true);
  assert.equal(ref.play.classList.contains("disabled"), true);
});

test("_updateAutomationRef: right after a run the line confirms it and the play button flashes", () => {
  const ref = makeAutomationRef(false);
  ref.flashUntil = Date.now() + 1000;
  const ctx = makeContext({ "automation.motion": { state: "on", attributes: {} } });
  _updateAutomationRef.call(ctx, ref, "automation.motion");
  assert.equal(ref.sub.textContent, "Triggered just now");
  assert.equal(ref.play.classList.contains("flash"), true);
});

test("_updateAutomationRef: a labeled automation gets one tinted chip per label, a star when the label has no icon", () => {
  const prevDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ className: "", style: {}, innerHTML: "", lastChild: { textContent: "" } }),
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
    assert.equal(appended[0].lastChild.textContent, "Important");
    assert.ok(appended[0].innerHTML.includes("mdi:star-outline"));
    assert.ok(appended[1].innerHTML.includes("mdi:volume-off"));
    assert.ok(appended[1].style.background.startsWith("color-mix("));
  } finally {
    globalThis.document = prevDocument;
  }
});

test("_updateAutomationRef: a script shows when it last ran, with no on/off status", () => {
  const ref = makeAutomationRef(true);
  const ctx = makeContext({ "script.good_night": { state: "off", attributes: {} } });
  _updateAutomationRef.call(ctx, ref, "script.good_night");
  assert.equal(ref.sub.textContent, "Never run");
  assert.equal(ref.row.classList.contains("off"), false);
});
