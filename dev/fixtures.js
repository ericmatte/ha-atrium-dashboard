// Fake Home Assistant registries + states for the dev render dashboard.
// Shapes mirror the real `hass` object closely enough for every Atrium
// component to run unmodified outside Home Assistant.

const isoMinutesAgo = (min) => new Date(Date.now() - min * 60_000).toISOString();
const isoDaysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();

function makeEntity(entity_id, area_id, extra = {}) {
  return {
    entity_id,
    area_id,
    device_id: null,
    hidden: false,
    hidden_by: null,
    disabled_by: null,
    name: null,
    entity_category: null,
    labels: [],
    ...extra,
  };
}

function makeState(entity_id, state, attributes = {}) {
  return {
    entity_id,
    state: String(state),
    attributes,
    last_changed: isoMinutesAgo(0),
    last_updated: isoMinutesAgo(0),
  };
}

export function buildFixtures() {
  const floors = {
    ground: { floor_id: "ground", name: "Ground Floor", icon: "mdi:home-floor-0", level: 0 },
    basement: { floor_id: "basement", name: "Basement", icon: "mdi:home-floor-b", level: -1 },
    // "showcase" is a virtual floor used only by the sections/exclude variant
    // gallery — it never appears in the accordion demo, so it needs its own
    // floor id purely to scope its one area.
    showcase: { floor_id: "showcase", name: "Showcase", icon: "mdi:flask", level: 100 },
  };

  // Real area photos in HA come from /api/image/serve/…; the demo uses Unsplash
  // stock photos so the round tiles show what a configured home looks like.
  const stockPhoto = (id) => `https://images.unsplash.com/photo-${id}?w=512&h=512&fit=crop&q=70`;
  const areas = {
    living_room: { area_id: "living_room", floor_id: "ground", name: "Living Room", icon: "mdi:sofa", picture: stockPhoto("1600210492486-724fe5c67fb0"), temperature_entity_id: "sensor.living_room_temperature", humidity_entity_id: "sensor.living_room_humidity" },
    kitchen: { area_id: "kitchen", floor_id: "ground", name: "Kitchen", icon: "mdi:countertop", picture: stockPhoto("1556911220-bff31c812dba"), temperature_entity_id: "sensor.kitchen_temperature", humidity_entity_id: null },
    entrance: { area_id: "entrance", floor_id: "ground", name: "Entrance", icon: "mdi:door", picture: stockPhoto("1502005229762-cf1b2da7c5d6"), temperature_entity_id: null, humidity_entity_id: null },
    bathroom: { area_id: "bathroom", floor_id: "ground", name: "Bathroom", icon: "mdi:bathtub", picture: stockPhoto("1552321554-5fefe8c9ef14"), temperature_entity_id: null, humidity_entity_id: "sensor.bathroom_humidity" },

    workshop: { area_id: "workshop", floor_id: "basement", name: "Workshop", icon: "mdi:wrench", picture: stockPhoto("1581783898377-1c85bf937427"), temperature_entity_id: null, humidity_entity_id: "sensor.workshop_humidity" },
    media_room: { area_id: "media_room", floor_id: "basement", name: "Media Room", icon: "mdi:television-classic", picture: stockPhoto("1478720568477-152d9b164e26"), temperature_entity_id: null, humidity_entity_id: null },

    // Orphan areas (no floor_id) surface under the strategy's virtual "Other"
    // floor — here they just live outside every real floor id.
    garden: { area_id: "garden", floor_id: null, name: "Garden", icon: "mdi:flower", picture: stockPhoto("1585320806297-9794b3e4eeae"), temperature_entity_id: "sensor.garden_temperature", humidity_entity_id: null },
    garage: { area_id: "garage", floor_id: null, name: "Garage", icon: "mdi:garage", picture: stockPhoto("1600566753190-17f0baa2a6c3"), temperature_entity_id: null, humidity_entity_id: null },

    showcase_room: { area_id: "showcase_room", floor_id: "showcase", name: "Showcase Room", icon: "mdi:flask", picture: stockPhoto("1586023492125-27b2c045efd7"), temperature_entity_id: "sensor.showcase_temperature", humidity_entity_id: "sensor.showcase_humidity" },
  };

  const devices = {
    living_room_fan_device: { area_id: "living_room" },
    showcase_switch_device: { area_id: "showcase_room" },
  };

  const entities = {};
  const states = {};
  const add = (id, area, stateVal, attrs = {}, extra = {}) => {
    entities[id] = makeEntity(id, area, extra);
    states[id] = makeState(id, stateVal, attrs);
  };

  // ---- Living Room -------------------------------------------------------
  add("light.living_room_main", "living_room", "on", {
    supported_color_modes: ["brightness"], color_mode: "brightness", brightness: 178,
  });
  add("light.living_room_lamp", "living_room", "on", {
    supported_color_modes: ["rgb"], color_mode: "rgb", rgb_color: [255, 120, 80], brightness: 115,
  }, { icon: "mdi:floor-lamp" });
  add("light.living_room_accent", "living_room", "off", {
    supported_color_modes: ["brightness"], color_mode: "brightness",
  });
  // Custom entity-registry icon overrides the domain default (mdi:lightbulb
  // / mdi:toggle-switch-variant) — see _updateToggleRef in area-card-updaters.js.
  add("switch.living_room_fan", "living_room", "on", {}, { device_id: "living_room_fan_device", icon: "mdi:fan" });
  add("switch.living_room_diagnostic_led", "living_room", "on", {}, { entity_category: "config" });
  add("cover.living_room_curtain", "living_room", "open", { current_position: 100, device_class: "curtain" });
  add("cover.living_room_blind", "living_room", "open", { current_position: 40, current_tilt_position: 60, device_class: "blind" });
  // entity_id lists the scene's target lights — mock-hass.js's SCENE_TARGETS
  // applies canned colors to them on scene.turn_on, so the scene pill
  // snapshot (lightsGradient) has something real to sample.
  add("scene.living_room_movie_night", "living_room", "2024-01-01T00:00:00+00:00", {
    icon: "mdi:movie-open", entity_id: ["light.living_room_lamp", "light.living_room_accent"],
  });
  add("scene.living_room_relax", "living_room", "2024-01-01T00:00:00+00:00", {
    entity_id: ["light.living_room_main", "light.living_room_lamp"],
  });
  add("button.living_room_scene_replay", "living_room", "unknown", { icon: "mdi:replay" });
  add("automation.living_room_evening_lights", "living_room", "on", { last_triggered: isoMinutesAgo(42), friendly_name: "Evening lights" }, { labels: ["important"] });
  add("automation.living_room_motion_alert", "living_room", "off", { friendly_name: "Motion alert" });
  add("automation.living_room_sync_with_dining", "living_room", "on", { icon: "mdi:sync", last_triggered: isoMinutesAgo(96), friendly_name: "Sync with dining room" });
  add("automation.living_room_no_ac_when_window_open", "living_room", "off", { icon: "mdi:window-open-variant", last_triggered: isoDaysAgo(48), friendly_name: "No AC when window is open" });
  add("script.living_room_good_morning", "living_room", "off", { friendly_name: "Good morning" });
  add("script.living_room_wind_down", "living_room", "off", { icon: "mdi:weather-night", friendly_name: "Wind down" });
  add("automation.living_room_debug_logger", "living_room", "on", { icon: "mdi:bug", last_triggered: isoMinutesAgo(2), friendly_name: "Debug light logger" }, { hidden: true });
  // Moved here from Workshop/Basement — every remaining floor gets its own
  // thermostat, and the heat pump belongs on the Ground Floor. heat_cool is
  // an active mode none of the other climate examples demonstrate.
  add("climate.living_room_heat_pump", "living_room", "heat_cool", {
    current_temperature: 21.4, temperature: 22, target_temp_step: 0.5, min_temp: 10, max_temp: 30,
    hvac_modes: ["off", "heat", "cool", "heat_cool", "auto"], fan_mode: "auto", fan_modes: ["auto", "low", "medium", "high"],
    swing_mode: "swing", swing_modes: ["swing", "static"],
    friendly_name: "Heat pump",
  });
  add("automation.living_room_climate_controller", "living_room", "on", { icon: "mdi:thermostat-auto", last_triggered: isoMinutesAgo(60 * 4), friendly_name: "Smart climate controller" });
  add("binary_sensor.living_room_motion", "living_room", "on", { device_class: "motion", friendly_name: "Motion" });
  add("binary_sensor.living_room_window", "living_room", "off", { device_class: "window", friendly_name: "Window" });
  add("sensor.living_room_temperature", "living_room", "21.4", { device_class: "temperature", unit_of_measurement: "°C", friendly_name: "Temperature" });
  add("sensor.living_room_humidity", "living_room", "46", { device_class: "humidity", unit_of_measurement: "%", friendly_name: "Humidity" });
  add("sensor.living_room_illuminance", "living_room", "310", { device_class: "illuminance", unit_of_measurement: "lx", friendly_name: "Illuminance" });
  add("sensor.living_room_fan_power", "living_room", "18.5", { device_class: "power", unit_of_measurement: "W", friendly_name: "Fan power" }, { device_id: "living_room_fan_device" });
  add("sensor.living_room_fan_battery", "living_room", "12", { device_class: "battery", unit_of_measurement: "%", friendly_name: "Fan remote battery" }, { device_id: "living_room_fan_device" });

  // ---- Kitchen -------------------------------------------------------------
  add("light.kitchen_main", "kitchen", "on", { supported_color_modes: ["brightness"], color_mode: "brightness", brightness: 255 });
  add("light.kitchen_island", "kitchen", "off", { supported_color_modes: ["brightness"], color_mode: "brightness" }, { icon: "mdi:ceiling-light-multiple" });
  add("switch.kitchen_coffee_maker", "kitchen", "off", {});
  add("vacuum.kitchen_robot", "kitchen", "cleaning", { battery_level: 72, fan_speed: "medium", friendly_name: "Kitchen Robot" });
  add("binary_sensor.kitchen_leak", "kitchen", "on", { device_class: "moisture", friendly_name: "Sink leak" });
  add("sensor.kitchen_temperature", "kitchen", "23.1", { device_class: "temperature", unit_of_measurement: "°C", friendly_name: "Temperature" });
  add("automation.kitchen_sync_lights", "kitchen", "on", { icon: "mdi:sync", last_triggered: isoMinutesAgo(50), friendly_name: "Sync kitchen lights" });
  add("automation.kitchen_leak_alert", "kitchen", "on", { icon: "mdi:water-alert", last_triggered: isoDaysAgo(12), friendly_name: "Leak alert notification" });
  add("script.kitchen_coffee_routine", "kitchen", "off", { icon: "mdi:coffee", friendly_name: "Coffee routine" });
  add("automation.kitchen_dishwasher_reminder", "kitchen", "on", { icon: "mdi:bell-outline", last_triggered: isoDaysAgo(5), friendly_name: "Dishwasher reminder" }, { hidden: true });
  // Relocated from the (removed) Bedroom — the only input_select example on
  // the main floors.
  add("input_select.kitchen_mode", "kitchen", "Cooking", { options: ["Off", "Cooking", "Cleaning", "Party"], friendly_name: "Kitchen mode" });

  // ---- Entrance --------------------------------------------------------
  add("light.entrance_light", "entrance", "on", { supported_color_modes: ["onoff"], color_mode: "onoff" }, { icon: "mdi:ceiling-light" });
  add("binary_sensor.entrance_door", "entrance", "on", { device_class: "door", friendly_name: "Front door" });
  add("binary_sensor.entrance_motion", "entrance", "off", { device_class: "motion", friendly_name: "Motion" });
  add("sensor.entrance_lock_battery", "entrance", "35", { device_class: "battery", unit_of_measurement: "%", friendly_name: "Lock battery" });
  add("automation.entrance_welcome_lights", "entrance", "on", { icon: "mdi:motion-sensor", last_triggered: isoMinutesAgo(39), friendly_name: "Lights on when arriving" });
  add("automation.entrance_security_alert", "entrance", "off", { icon: "mdi:alert", friendly_name: "Security alert" });
  add("automation.entrance_camera_snapshot", "entrance", "on", { icon: "mdi:camera", last_triggered: isoDaysAgo(1), friendly_name: "Camera snapshot on motion" }, { hidden: true });

  // ---- Bathroom ----------------------------------------------------------
  add("light.bathroom_main", "bathroom", "on", { supported_color_modes: ["brightness"], color_mode: "brightness", brightness: 230 });
  add("switch.bathroom_fan", "bathroom", "off", {});
  add("binary_sensor.bathroom_leak", "bathroom", "off", { device_class: "moisture", friendly_name: "Floor leak" });
  add("sensor.bathroom_humidity", "bathroom", "68", { device_class: "humidity", unit_of_measurement: "%", friendly_name: "Humidity" });
  add("binary_sensor.water_heater_problem", "bathroom", "on", { device_class: "problem", friendly_name: "Water heater problem" });
  add("automation.bathroom_fan_sync", "bathroom", "on", { icon: "mdi:sync", last_triggered: isoMinutesAgo(42), friendly_name: "Sync fan with humidity" });
  add("script.bathroom_night_light", "bathroom", "off", { icon: "mdi:weather-night", friendly_name: "Night light mode" });
  // Relocated from the (removed) Bedroom — the only "heat" hvac_modes climate
  // example on the main floors.
  // Single-mode: always heating, no off/cool/auto to pick — just a target
  // temperature. Unlike the heat pump, its swatch has no mode dropdown.
  add("climate.bathroom_thermostat", "bathroom", "heat", {
    current_temperature: 19.8, temperature: 21, target_temp_step: 0.5, min_temp: 10, max_temp: 30,
    hvac_modes: ["heat"], hvac_action: "heating",
    friendly_name: "Thermostat",
  });

  // ---- Workshop (basement) --------------------------------------------------
  add("light.workshop_main", "workshop", "on", { supported_color_modes: ["onoff"], color_mode: "onoff" });
  add("light.workshop_spare", "workshop", "unavailable", { supported_color_modes: ["onoff"] });
  add("switch.workshop_table_saw", "workshop", "off", {}, { icon: "mdi:tools" });
  add("binary_sensor.workshop_smoke", "workshop", "off", { device_class: "smoke", friendly_name: "Smoke" });
  add("automation.workshop_safety_alert", "workshop", "on", { icon: "mdi:alert", last_triggered: isoDaysAgo(30), friendly_name: "Safety alert" });
  add("script.workshop_power_tools_lockout", "workshop", "off", { icon: "mdi:lock", friendly_name: "Power tools lockout" });
  add("sensor.workshop_humidity", "workshop", "55", { device_class: "humidity", unit_of_measurement: "%", friendly_name: "Humidity" });
  add("sensor.workshop_propane_tank", "workshop", "64", { unit_of_measurement: "%", friendly_name: "Propane tank" });
  // Every remaining floor gets its own thermostat. Single-mode, same as the
  // bathroom's — no mode dropdown, just a target temperature.
  add("climate.workshop_thermostat", "workshop", "heat", {
    current_temperature: 15.5, temperature: 18, target_temp_step: 1, min_temp: 5, max_temp: 25,
    hvac_modes: ["heat"], hvac_action: "idle",
    friendly_name: "Thermostat",
  });

  // ---- Media Room (basement) -------------------------------------------------
  // Media players feed the tiles' bottom-right "what's running" badge:
  // the TV is playing (tap = pause), the living room speaker is paused.
  add("media_player.media_room_tv", "media_room", "playing", { device_class: "tv", media_title: "Dune: Part Two", app_name: "Netflix", volume_level: 0.4, is_volume_muted: false, supported_features: 21437, friendly_name: "TV" });
  add("media_player.living_room_sonos", "living_room", "paused", { device_class: "speaker", media_title: "Midnight City", media_artist: "M83", media_album_name: "Hurry Up, We're Dreaming", volume_level: 0.35, is_volume_muted: false, friendly_name: "Sonos" });
  add("light.media_room_main", "media_room", "off", { supported_color_modes: ["brightness"], color_mode: "brightness" });
  add("light.media_room_accent", "media_room", "on", { supported_color_modes: ["rgb"], color_mode: "rgb", rgb_color: [90, 140, 255], brightness: 77 }, { icon: "mdi:led-strip-variant" });
  add("switch.media_room_projector", "media_room", "off", {});
  add("scene.media_room_movie_time", "media_room", "2024-01-01T00:00:00+00:00", { icon: "mdi:theater" });
  add("automation.media_room_dim_for_movie", "media_room", "on", { last_triggered: isoMinutesAgo(5), friendly_name: "Dim for movie" });
  add("script.media_room_movie_night", "media_room", "off", { icon: "mdi:movie-open", friendly_name: "Movie night sequence" });
  add("script.media_room_credits_roll", "media_room", "off", { icon: "mdi:script-text", friendly_name: "Credits roll" });
  add("script.media_room_easter_egg", "media_room", "off", { icon: "mdi:egg-easter", friendly_name: "Easter egg" }, { hidden: true });

  // ---- Garden (orphan / "Other") -----------------------------------------
  add("light.garden_path", "garden", "on", { supported_color_modes: ["onoff"], color_mode: "onoff" }, { icon: "mdi:spotlight-beam" });
  add("switch.garden_sprinkler", "garden", "off", {}, { icon: "mdi:sprinkler-variant" });
  add("cover.garden_pergola_shade", "garden", "open", { current_position: 75, device_class: "shade" });
  add("binary_sensor.garden_motion", "garden", "on", { device_class: "motion", friendly_name: "Motion" });
  add("automation.garden_sunset_lights", "garden", "on", { icon: "mdi:weather-sunset", last_triggered: isoMinutesAgo(60 * 6), friendly_name: "Sunset lights" });
  add("automation.garden_sprinkler_schedule", "garden", "off", { icon: "mdi:sprinkler", last_triggered: isoDaysAgo(3), friendly_name: "Sprinkler schedule" });
  add("sensor.garden_temperature", "garden", "15.2", { device_class: "temperature", unit_of_measurement: "°C", friendly_name: "Temperature" });
  add("sensor.garden_soil_moisture", "garden", "38", { device_class: "moisture", unit_of_measurement: "%", friendly_name: "Basil soil moisture" });

  // ---- Garage (orphan / "Other") -----------------------------------------
  add("cover.garage_door", "garage", "closed", { current_position: 0, device_class: "garage" });
  add("light.garage_main", "garage", "off", { supported_color_modes: ["onoff"], color_mode: "onoff" });
  add("binary_sensor.garage_door_sensor", "garage", "off", { device_class: "garage_door", friendly_name: "Garage door sensor" });
  add("automation.garage_door_left_open_alert", "garage", "on", { icon: "mdi:garage-alert", last_triggered: isoDaysAgo(7), friendly_name: "Door left open alert" });
  add("script.garage_close_everything", "garage", "off", { icon: "mdi:home-lock", friendly_name: "Close everything" });

  // ---- Showcase Room: one of everything, used by the sections/exclude gallery
  add("light.showcase_dimmable_color", "showcase_room", "on", {
    supported_color_modes: ["rgb"], color_mode: "rgb", rgb_color: [90, 200, 255], brightness: 153,
  });
  add("light.showcase_dimmable_white", "showcase_room", "on", {
    supported_color_modes: ["brightness"], color_mode: "brightness", brightness: 89,
  });
  add("light.showcase_onoff_only", "showcase_room", "off", { supported_color_modes: ["onoff"] });
  add("switch.showcase_switch", "showcase_room", "on", {}, { device_id: "showcase_switch_device" });
  add("switch.showcase_diagnostic", "showcase_room", "off", {}, { entity_category: "diagnostic" });
  add("cover.showcase_curtain", "showcase_room", "open", { current_position: 65, current_tilt_position: 30, device_class: "curtain" });
  add("cover.showcase_blind_closed", "showcase_room", "closed", { current_position: 0, device_class: "blind" });
  add("climate.showcase_thermostat", "showcase_room", "heat", {
    current_temperature: 20.5, temperature: 21, target_temp_step: 0.5, min_temp: 10, max_temp: 30,
    hvac_modes: ["off", "heat", "cool", "auto"], fan_mode: "auto", fan_modes: ["auto", "low", "medium", "high"],
    swing_mode: "off", swing_modes: ["off", "on"], friendly_name: "Showcase Thermostat",
  });
  add("vacuum.showcase_vacuum", "showcase_room", "docked", { battery_level: 95, friendly_name: "Showcase Vacuum" });
  add("scene.showcase_relax", "showcase_room", "2024-01-01T00:00:00+00:00", { icon: "mdi:weather-night" });
  add("scene.showcase_bright", "showcase_room", "2024-01-01T00:00:00+00:00", { icon: "mdi:palette" });
  add("button.showcase_press_me", "showcase_room", "unknown", { icon: "mdi:gesture-tap-button" });
  add("button.showcase_diagnostic_button", "showcase_room", "unknown", {}, { entity_category: "diagnostic" });
  add("input_select.showcase_mode", "showcase_room", "Auto", { options: ["Auto", "Manual", "Away"], friendly_name: "Mode" });
  add("automation.showcase_auto_on", "showcase_room", "on", { last_triggered: isoMinutesAgo(58), friendly_name: "Auto on" }, { labels: ["important"] });
  add("automation.showcase_auto_off", "showcase_room", "off", { friendly_name: "Auto off" });
  add("script.showcase_script", "showcase_room", "off", { friendly_name: "Showcase script" });
  add("binary_sensor.showcase_motion", "showcase_room", "on", { device_class: "motion", friendly_name: "Motion" });
  add("binary_sensor.showcase_leak", "showcase_room", "on", { device_class: "moisture", friendly_name: "Leak" });
  add("binary_sensor.showcase_door", "showcase_room", "on", { device_class: "door", friendly_name: "Door" });
  add("binary_sensor.showcase_generic", "showcase_room", "off", { device_class: "vibration", friendly_name: "Vibration" });
  add("sensor.showcase_temperature", "showcase_room", "21.0", { device_class: "temperature", unit_of_measurement: "°C", friendly_name: "Temperature" });
  add("sensor.showcase_humidity", "showcase_room", "50", { device_class: "humidity", unit_of_measurement: "%", friendly_name: "Humidity" });
  add("sensor.showcase_soil", "showcase_room", "44", { device_class: "moisture", unit_of_measurement: "%", friendly_name: "Plant soil" });
  add("sensor.showcase_propane", "showcase_room", "80", { unit_of_measurement: "%", friendly_name: "Propane tank" });
  add("sensor.showcase_extra_power", "showcase_room", "42.3", { device_class: "power", unit_of_measurement: "W", friendly_name: "Power draw" });
  add("sensor.showcase_extra_illuminance", "showcase_room", "540", { device_class: "illuminance", unit_of_measurement: "lx", friendly_name: "Illuminance" });
  add("sensor.showcase_nonplottable_text", "showcase_room", "Home", { device_class: "enum", options: ["Home", "Away"], friendly_name: "Mode text" });
  add("sensor.showcase_device_linked", "showcase_room", "3.4", { unit_of_measurement: "kWh", friendly_name: "Switch energy today" }, { device_id: "showcase_switch_device" });

  // ---- Global (not tied to any single area) --------------------------------
  entities["person.eric"] = makeEntity("person.eric", null);
  states["person.eric"] = makeState("person.eric", "home", { friendly_name: "Eric", entity_picture: null });
  entities["person.guest"] = makeEntity("person.guest", null);
  states["person.guest"] = makeState("person.guest", "not_home", { friendly_name: "Guest", entity_picture: null });

  entities["weather.home"] = makeEntity("weather.home", null);
  states["weather.home"] = makeState("weather.home", "partlycloudy", { temperature: 18.4, friendly_name: "Home" });

  const labels = {
    important: { name: "Important", icon: "mdi:star", color: "amber" },
  };

  const user = { name: "Eric Matte" };

  return { floors, areas, devices, entities, states, labels, user };
}
