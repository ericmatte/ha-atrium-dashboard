// A tiny fake Home Assistant runtime: holds the fixture registries/states and
// implements just enough of `hass.callService` to make every clickable
// surface in the Atrium components (lights, covers, climate, automations,
// scenes, buttons, vacuums, input_selects) actually do something and
// re-render, the same way real HA would push a new state back down.
import { buildFixtures } from "./fixtures.js";

export function createMockHass({ onToast } = {}) {
  const fixtures = buildFixtures();
  const listeners = new Set();

  const hass = {
    areas: fixtures.areas,
    devices: fixtures.devices,
    entities: fixtures.entities,
    floors: fixtures.floors,
    labels: fixtures.labels,
    states: fixtures.states,
    user: fixtures.user,
    callService: (domain, service, data) => applyService(domain, service, data || {}),
  };

  function notify() {
    for (const fn of listeners) fn(hass);
  }

  function toast(msg) {
    onToast?.(msg);
  }

  // Per-entity states must be replaced (not mutated in place) — Atrium's
  // updaters gate on `hass.states[id]` reference identity to skip no-op
  // renders, exactly like the real frontend's state_changed diffing.
  function patchState(entityId, { state, attributes } = {}) {
    const prev = hass.states[entityId];
    if (!prev) return;
    const nextState = state !== undefined ? String(state) : prev.state;
    const changed = nextState !== prev.state;
    hass.states = {
      ...hass.states,
      [entityId]: {
        ...prev,
        state: nextState,
        attributes: { ...prev.attributes, ...attributes },
        last_changed: changed ? new Date().toISOString() : prev.last_changed,
        last_updated: new Date().toISOString(),
      },
    };
  }

  // Canned target states for the two Living Room scenes that carry an
  // `entity_id` list in their fixtures — just enough of a "scene engine" to
  // make the badge color-gradient feature (computeSceneGradient) visibly
  // do something here, not a real scene-application simulator.
  const SCENE_TARGETS = {
    "scene.living_room_movie_night": [
      { entity_id: "light.living_room_lamp", state: "on", attributes: { rgb_color: [120, 40, 200], brightness: 60 } },
      { entity_id: "light.living_room_accent", state: "on", attributes: { brightness: 40 } },
    ],
    "scene.living_room_relax": [
      { entity_id: "light.living_room_main", state: "on", attributes: { brightness: 140 } },
      { entity_id: "light.living_room_lamp", state: "on", attributes: { rgb_color: [255, 170, 90], brightness: 130 } },
    ],
  };

  function targetIds(data) {
    const raw = data.entity_id;
    return Array.isArray(raw) ? raw : raw ? [raw] : [];
  }

  function applyService(domain, service, data) {
    const key = `${domain}.${service}`;
    for (const id of targetIds(data)) {
      const st = hass.states[id];
      if (!st) continue;
      switch (key) {
        case "light.turn_on": {
          const attrs = {};
          if (data.brightness_pct != null) attrs.brightness = Math.round((data.brightness_pct / 100) * 255);
          else if (st.attributes.brightness == null && st.attributes.supported_color_modes?.some((m) => m !== "onoff")) attrs.brightness = 255;
          patchState(id, { state: "on", attributes: attrs });
          break;
        }
        case "light.turn_off":
        case "switch.turn_off":
          patchState(id, { state: "off" });
          break;
        case "switch.turn_on":
          patchState(id, { state: "on" });
          break;
        case "cover.open_cover":
          patchState(id, { state: "open", attributes: { current_position: 100 } });
          break;
        case "cover.close_cover":
          patchState(id, { state: "closed", attributes: { current_position: 0 } });
          break;
        case "cover.set_cover_position": {
          const pos = Math.max(0, Math.min(100, Number(data.position) || 0));
          patchState(id, { state: pos > 0 ? "open" : "closed", attributes: { current_position: pos } });
          break;
        }
        case "climate.set_temperature":
          patchState(id, { attributes: { temperature: data.temperature } });
          break;
        case "climate.set_hvac_mode":
          patchState(id, { state: data.hvac_mode });
          break;
        case "climate.set_fan_mode":
          patchState(id, { attributes: { fan_mode: data.fan_mode } });
          break;
        case "climate.set_swing_mode":
          patchState(id, { attributes: { swing_mode: data.swing_mode } });
          break;
        case "scene.turn_on":
          patchState(id, { state: new Date().toISOString() });
          for (const target of SCENE_TARGETS[id] || []) {
            patchState(target.entity_id, { state: target.state, attributes: target.attributes });
          }
          toast(`Scene activated · ${id}`);
          break;
        case "button.press":
          toast(`Button pressed · ${id}`);
          break;
        case "input_select.select_option":
          patchState(id, { state: data.option });
          break;
        case "automation.turn_on":
          patchState(id, { state: "on" });
          break;
        case "automation.turn_off":
          patchState(id, { state: "off" });
          break;
        case "automation.trigger":
          patchState(id, { attributes: { last_triggered: new Date().toISOString() } });
          toast(`Automation triggered · ${id}`);
          break;
        case "vacuum.start":
          patchState(id, { state: "cleaning" });
          break;
        case "vacuum.pause":
          patchState(id, { state: "paused" });
          break;
        case "vacuum.stop":
        case "vacuum.return_to_base":
          patchState(id, { state: "returning" });
          break;
        default:
          console.warn("[mock-hass] unhandled service call", key, data);
      }
    }
    notify();
  }

  // Every condition shell.js's WEATHER_ICONS maps to an icon — kept in sync
  // by hand since that map isn't exported (dev-only convenience, not worth
  // widening the real component's public surface for).
  const WEATHER_CONDITIONS = [
    "clear-night", "cloudy", "exceptional", "fog", "hail", "lightning",
    "lightning-rainy", "partlycloudy", "pouring", "rainy", "snowy",
    "snowy-rainy", "sunny", "windy", "windy-variant",
  ];

  // Clicking the header's weather pill normally opens more-info; in dev
  // there's nothing to open, so it cycles through every condition instead —
  // an easy way to eyeball every weather icon without editing fixtures.
  function cycleWeather(entityId) {
    const st = hass.states[entityId];
    if (!st) return;
    const idx = WEATHER_CONDITIONS.indexOf(st.state);
    const next = WEATHER_CONDITIONS[(idx + 1) % WEATHER_CONDITIONS.length];
    patchState(entityId, { state: next });
    toast(`Weather → ${next}`);
    notify();
  }

  // Small heartbeat so the dashboard visibly re-renders on its own too, not
  // only on click — nudges a couple of temperature readings like real
  // sensors would drift between polls.
  function startHeartbeat() {
    const drifting = ["sensor.living_room_temperature", "sensor.showcase_temperature", "sensor.garden_temperature"];
    setInterval(() => {
      for (const id of drifting) {
        const st = hass.states[id];
        if (!st) continue;
        const next = (parseFloat(st.state) + (Math.random() - 0.5) * 0.4).toFixed(1);
        patchState(id, { state: next });
      }
      notify();
    }, 12_000);
  }

  return {
    hass,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    startHeartbeat,
    cycleWeather,
  };
}
