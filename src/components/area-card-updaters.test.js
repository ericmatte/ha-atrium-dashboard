import test from "node:test";
import assert from "node:assert/strict";
import "../../tools/register.mjs";

const { _bindDivaTrack, _updateDivaRef, _toggleEntity, _updateClimateRef, _updateAutomationRef, divaVisual, climateView, mediaView, fanModeIcon, swingModeIcon } = await import("./area-card-updaters.js");

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

test("climateView: a heating single-mode thermostat shows now/trend and target, with no mode controls", () => {
  const v = climateView({ state: "heat", attributes: { current_temperature: 19.8, temperature: 21, target_temp_step: 0.5, hvac_modes: ["heat"] } });
  assert.equal(v.now, "Now 19.8° · heating");
  assert.equal(v.target, "21°");
  assert.equal(v.tone, "warm");
  assert.equal(v.hasControls, false);
});

test("climateView: hvac_action wins over the guessed trend", () => {
  const v = climateView({ state: "heat", attributes: { current_temperature: 19, temperature: 21, hvac_action: "idle", hvac_modes: ["heat"] } });
  assert.equal(v.now, "Now 19° · idle");
});

test("climateView: a multi-mode unit gets Mode + Fan dropdowns, without 'off' among the modes", () => {
  const v = climateView({ state: "cool", attributes: { hvac_modes: ["off", "heat", "cool"], fan_mode: "low", fan_modes: ["auto", "low"], temperature: 24, target_temp_step: 1 } });
  assert.equal(v.hasControls, true);
  assert.equal(v.tone, "cool");
  assert.equal(v.target, "24°");
  assert.deepEqual(v.dropdowns.map((d) => d.key), ["mode", "fan"]);
  assert.deepEqual(v.dropdowns[0].options, ["heat", "cool"]);
  assert.equal(v.dropdowns[1].labelFor("auto"), "Auto");
});

test("climateView: off keeps showing the mode it will return to, and can't be adjusted", () => {
  const v = climateView({ state: "off", attributes: { hvac_modes: ["off", "heat", "cool"], temperature: 21 } }, "cool");
  assert.equal(v.off, true);
  assert.equal(v.canAdjust, false);
  assert.equal(v.turnOnMode, "cool");
  assert.equal(v.dropdowns[0].value, "cool");
  assert.equal(v.tone, "neutral");
});

test("climateView: a heat/cool range with no single target shows low–high", () => {
  const v = climateView({ state: "heat_cool", attributes: { target_temp_low: 20, target_temp_high: 24, target_temp_step: 1, hvac_modes: ["heat_cool"] } });
  assert.equal(v.target, "20–24°");
  assert.equal(v.canAdjust, false);
});

function makeClimateRef() {
  const el = () => ({ classList: makeClassList(), setAttribute() {}, textContent: "", disabled: false, hidden: false });
  return { card: el(), now: el(), target: el(), minus: el(), plus: el(), controls: el(), power: el(), displayName: "Heat pump", dropdowns: new Map(), turnOnMode: null };
}

test("_updateClimateRef: remembers the last active mode so power brings it back", () => {
  const ref = makeClimateRef();
  const states = { "climate.x": { state: "cool", attributes: { hvac_modes: ["off", "heat", "cool"], temperature: 23 } } };
  const ctx = { _hass: { states }, _lastClimateMode: new Map() };
  _updateClimateRef.call(ctx, ref, "climate.x");
  states["climate.x"] = { state: "off", attributes: { hvac_modes: ["off", "heat", "cool"], temperature: 23 } };
  _updateClimateRef.call(ctx, ref, "climate.x");
  assert.equal(ref.turnOnMode, "cool");
  assert.equal(ref.card.classList.contains("off"), true);
  assert.equal(ref.power.classList.contains("on"), false);
  assert.equal(ref.minus.disabled, true);
});

test("_updateClimateRef: fills each dropdown's menu options, current value and label", () => {
  const ref = makeClimateRef();
  const slot = () => ({ btn: { setAttribute(k, v) { this[k] = v; } }, icon: { setAttribute() {} }, value: { textContent: "" }, options: [], current: null, labelFor: (v) => v });
  ref.dropdowns = new Map([["mode", slot()], ["fan", slot()], ["swing", slot()]]);
  const ctx = {
    _hass: { states: { "climate.x": { state: "heat", attributes: { hvac_modes: ["off", "heat", "cool"], fan_mode: "auto", fan_modes: ["auto", "low"], swing_mode: "swing", swing_modes: ["swing", "static"], temperature: 20 } } } },
    _lastClimateMode: new Map(),
  };
  _updateClimateRef.call(ctx, ref, "climate.x");
  const swing = ref.dropdowns.get("swing");
  assert.deepEqual(swing.options, ["swing", "static"]);
  assert.equal(swing.current, "swing");
  assert.equal(swing.value.textContent, "Swing");
  assert.equal(ref.dropdowns.get("mode").value.textContent, "Heat");
  assert.deepEqual(ref.dropdowns.get("mode").options, ["heat", "cool"]);
});

test("_updateClimateRef: a single-mode thermostat hides the controls row", () => {
  const ref = makeClimateRef();
  const ctx = { _hass: { states: { "climate.x": { state: "heat", attributes: { hvac_modes: ["heat"], temperature: 21, current_temperature: 20 } } } }, _lastClimateMode: new Map() };
  _updateClimateRef.call(ctx, ref, "climate.x");
  assert.equal(ref.controls.hidden, true);
  assert.equal(ref.now.textContent, "Now 20° · heating");
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
  assert.equal(ref.sub.textContent, "Script · never run");
  assert.equal(ref.row.classList.contains("off"), false);
});

test("mediaView: a playing speaker shows title, artist · album and every control it supports", () => {
  const v = mediaView({ state: "playing", attributes: { media_title: "Midnight City", media_artist: "M83", media_album_name: "Hurry Up", volume_level: 0.35, supported_features: 16 | 32 | 1 | 4 | 8 } });
  assert.equal(v.title, "Midnight City");
  assert.equal(v.subtitle, "M83 · Hurry Up");
  assert.equal(v.playing, true);
  assert.equal(v.volume, 35);
  assert.deepEqual([v.canPrev, v.canNext, v.canPlayPause, v.canVolume, v.canMute], [true, true, true, true, true]);
  assert.equal(v.canPower, false);
});

test("mediaView: controls the player doesn't support are left out", () => {
  const v = mediaView({ state: "paused", attributes: { media_title: "News", volume_level: 0.2, supported_features: 1 } });
  assert.deepEqual([v.canPrev, v.canNext, v.canPlayPause, v.canVolume, v.canMute], [false, false, true, false, false]);
});

test("mediaView: an off TV shows 'Off' with only a power button, no artwork", () => {
  const v = mediaView({ state: "off", attributes: { entity_picture: "/art.jpg", supported_features: 128 | 256 } });
  assert.equal(v.off, true);
  assert.equal(v.title, "Off");
  assert.equal(v.subtitle, null);
  assert.equal(v.artwork, null);
  assert.equal(v.canPower, true);
  assert.equal(v.canPlayPause, false);
});

test("mediaView: idle with nothing loaded shows its state as the title", () => {
  const v = mediaView({ state: "idle", attributes: {} });
  assert.equal(v.title, "Idle");
  assert.equal(v.subtitle, null);
});

test("fanModeIcon / swingModeIcon: map the names integrations report, with a generic fallback", () => {
  assert.equal(fanModeIcon("auto"), "mdi:fan-auto");
  assert.equal(fanModeIcon("Low"), "mdi:fan-speed-1");
  assert.equal(fanModeIcon("med"), "mdi:fan-speed-2");
  assert.equal(fanModeIcon("medium"), "mdi:fan-speed-2");
  assert.equal(fanModeIcon("high"), "mdi:fan-speed-3");
  assert.equal(fanModeIcon("quiet"), "mdi:weather-night");
  assert.equal(fanModeIcon("diffuse"), "mdi:fan");
  assert.equal(swingModeIcon("swing"), "mdi:arrow-oscillating");
  assert.equal(swingModeIcon("static"), "mdi:arrow-oscillating-off");
  assert.equal(swingModeIcon("off"), "mdi:arrow-oscillating-off");
  assert.equal(swingModeIcon("vertical"), "mdi:arrow-up-down");
});

test("climateView: each dropdown knows the icon of every option and of its current value", () => {
  const v = climateView({ state: "cool", attributes: { hvac_modes: ["off", "heat", "cool"], fan_mode: "low", fan_modes: ["auto", "low"], swing_mode: "static", swing_modes: ["swing", "static"] } });
  const [mode, fan, swing] = v.dropdowns;
  assert.equal(mode.iconFor("heat"), "mdi:fire");
  assert.equal(fan.icon, "mdi:fan-speed-1");
  assert.equal(swing.icon, "mdi:arrow-oscillating-off");
});

test("_toggleEntity: an input_boolean uses its own turn_on/turn_off services", () => {
  const calls = [];
  const ctx = { _hass: { states: {} }, _call: (...a) => calls.push(a) };
  _toggleEntity.call(ctx, "input_boolean.guest", "input_boolean", true);
  _toggleEntity.call(ctx, "input_boolean.guest", "input_boolean", false);
  assert.deepEqual(calls, [["input_boolean", "turn_on", { entity_id: "input_boolean.guest" }], ["input_boolean", "turn_off", { entity_id: "input_boolean.guest" }]]);
});
