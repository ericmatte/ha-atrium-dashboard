import { openPopover, closePopoverFor, openListPopover } from "../lib/popover.js";
import { haIcon, bindLongPress, readSceneGradient, writeSceneGradient } from "../lib/dom-utils.js";
import {
  ICONS,
  nameWithoutAreaPrefix,
  ensurePopoverItemStyle,
  fmtCoverPct,
  iconForScene,
  lightsGradient,
} from "./area-card-shared.js";
import { routineRows } from "../lib/area-data.js";
import { settleStep } from "../lib/settle.js";
import { FLASH_MS } from "./area-card-updaters.js";

// Panel content for one selected room, in the order the design settled on:
// climate and media (own full-width cards), scenes/buttons (a pill strip), lights,
// switches and covers side by side, mode selectors, sensor readings, then
// routines (automations & scripts) last.
export function _buildRoomSections(area, data) {
  const sections = [];
  if (data.climates.length) sections.push(this._buildClimateSection(area, data.climates));
  if (data.mediaPlayers.length) sections.push(this._buildMediaSection(area, data.mediaPlayers));

  if (data.scenes.length || data.buttons.length) sections.push(this._buildPillsSection(area, data.scenes, data.buttons, data.lights));

  if (data.lights.length || data.switches.length || data.covers.length || data.inputBooleans.length) {
    sections.push(this._buildDeviceGroupsRow(area, data));
  }
  if (data.inputSelects.length) sections.push(this._buildInputSelectsSection(area, data.inputSelects));

  const genericSensors = [...data.sensors.extras, ...data.sensors.other];
  if (genericSensors.length) sections.push(this._buildSensorsSection(area, genericSensors));

  const routines = this._buildAutomationsSection(area, data);
  if (routines) sections.push(routines);

  return sections;
}

export function _section(title, children) {
  const wrap = document.createElement("div");
  wrap.className = "atrium-section";
  if (title) wrap.appendChild(this._sectionHead(title));
  if (Array.isArray(children)) wrap.append(...children);
  else wrap.appendChild(children);
  return wrap;
}

// A climate entity gets its own full-width card, separate from the light/
// switch tiles — a room's thermostat is a destination in its own right, not
// a quick-glance tile among the dimmers.
export function _buildClimateSection(area, climates) {
  const list = document.createElement("div");
  list.className = "atrium-climate-list";
  for (const climate of climates) list.appendChild(this._buildClimateTile(area, climate));
  return this._section(null, list);
}

// A small themed menu under a pill (climate mode/fan/swing): the options,
// the current one checked. Replaces the OS <select> picker so it matches the
// rest of the panel.
export function _openOptionMenu(anchor, title, slot, onPick) {
  ensurePopoverItemStyle();
  const menu = document.createElement("div");
  menu.className = "atrium-pop-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", title);
  for (const option of slot.options) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "atrium-pop-menu-item" + (option === slot.current ? " active" : "");
    item.setAttribute("role", "menuitemradio");
    item.setAttribute("aria-checked", String(option === slot.current));
    item.innerHTML = `${slot.iconFor ? haIcon(slot.iconFor(option), 18) : ""}<span class="atrium-pop-menu-label"></span><span class="atrium-pop-menu-check">${haIcon("mdi:check", 16)}</span>`;
    item.querySelector(".atrium-pop-menu-label").textContent = slot.labelFor(option);
    item.addEventListener("click", () => {
      closePopoverFor(anchor);
      if (option !== slot.current) onPick(option);
    });
    menu.appendChild(item);
  }
  this._openAnchors.add(anchor);
  const opened = openPopover({
    anchor,
    content: menu,
    width: Math.max(160, anchor.getBoundingClientRect().width),
    onClose: () => this._openAnchors.delete(anchor),
  });
  if (opened) anchor.classList.add("atrium-pop-open");
  (menu.querySelector(".active") || menu.firstChild)?.focus({ focusVisible: false });
}

export function _buildClimateTile(area, climate) {
  const entityId = climate.entity_id;
  const displayName = nameWithoutAreaPrefix(this._entityName(climate), area);
  const card = document.createElement("div");
  card.className = "atrium-climate";
  card.dataset.entity = entityId;

  const top = document.createElement("button");
  top.type = "button";
  top.className = "atrium-climate-top";
  top.addEventListener("click", () => this._moreInfo(entityId));
  const name = document.createElement("span");
  name.className = "atrium-climate-name";
  name.textContent = displayName;
  const now = document.createElement("span");
  now.className = "atrium-climate-now";
  top.append(name, now);

  const mid = document.createElement("div");
  mid.className = "atrium-climate-mid";
  const stepButton = (label, direction) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "atrium-climate-round";
    btn.setAttribute("aria-label", label);
    btn.textContent = direction < 0 ? "−" : "+";
    btn.addEventListener("click", () => this._adjustClimate(entityId, direction));
    return btn;
  };
  const minus = stepButton("Lower target", -1);
  const target = document.createElement("span");
  target.className = "atrium-climate-target";
  const plus = stepButton("Raise target", 1);
  mid.append(minus, target, plus);

  const controls = document.createElement("div");
  controls.className = "atrium-climate-controls";
  const ref = { card, now, target, minus, plus, controls, displayName, dropdowns: new Map(), turnOnMode: null };

  const power = document.createElement("button");
  power.type = "button";
  power.className = "atrium-climate-power";
  power.innerHTML = haIcon(ICONS.power, 16);
  power.addEventListener("click", () => {
    const isOff = this._hass.states?.[entityId]?.state === "off";
    this._call("climate", "set_hvac_mode", { entity_id: entityId, hvac_mode: isOff ? ref.turnOnMode : "off" });
  });
  controls.appendChild(power);
  ref.power = power;

  const services = {
    mode: (v) => this._call("climate", "set_hvac_mode", { entity_id: entityId, hvac_mode: v }),
    fan: (v) => this._call("climate", "set_fan_mode", { entity_id: entityId, fan_mode: v }),
    swing: (v) => this._call("climate", "set_swing_mode", { entity_id: entityId, swing_mode: v }),
  };
  const attrs = this._hass.states?.[entityId]?.attributes || {};
  const present = { mode: true, fan: !!attrs.fan_modes?.length, swing: !!attrs.swing_modes?.length };
  const labels = { mode: "Mode", fan: "Fan mode", swing: "Swing mode" };
  for (const key of ["mode", "fan", "swing"]) {
    if (!present[key]) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "atrium-climate-dd";
    btn.setAttribute("aria-haspopup", "menu");
    const icon = document.createElement("ha-icon");
    const value = document.createElement("span");
    value.className = "atrium-climate-dd-value";
    btn.append(icon, value);
    const slot = { btn, icon, value, options: [], current: null, labelFor: (v) => v, iconFor: null };
    btn.addEventListener("click", () => this._openOptionMenu(btn, labels[key], slot, services[key]));
    controls.appendChild(btn);
    ref.dropdowns.set(key, slot);
  }

  card.append(top, mid, controls);
  this._refs.areas.get(area.area_id).climates.set(entityId, ref);
  this._updateClimateRef(ref, entityId);
  return card;
}

// One card per media player: artwork, what's playing, transport controls
// and volume. Which controls show follows the player's supported_features.
export function _buildMediaSection(area, players) {
  const list = document.createElement("div");
  list.className = "atrium-media-list";
  for (const player of players) list.appendChild(this._buildMediaCard(area, player));
  return this._section(null, list);
}

export function _buildMediaCard(area, player) {
  const entityId = player.entity_id;
  const displayName = nameWithoutAreaPrefix(this._entityName(player), area);
  const call = (service, data = {}) => this._call("media_player", service, { entity_id: entityId, ...data });
  const iconButton = (cls, icon, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    if (icon) b.innerHTML = haIcon(icon, 20);
    b.addEventListener("click", onClick);
    return b;
  };

  const card = document.createElement("div");
  card.className = "atrium-media";
  card.dataset.entity = entityId;

  const art = document.createElement("span");
  art.className = "atrium-media-art";
  art.innerHTML = haIcon(this._hass.entities?.[entityId]?.icon || (this._hass.states?.[entityId]?.attributes?.device_class === "tv" ? "mdi:television" : "mdi:speaker"), 24);

  const info = document.createElement("button");
  info.type = "button";
  info.className = "atrium-media-info";
  info.addEventListener("click", () => this._moreInfo(entityId));
  const name = document.createElement("span");
  name.className = "atrium-media-name";
  name.textContent = displayName;
  const title = document.createElement("span");
  title.className = "atrium-media-title";
  const subtitle = document.createElement("span");
  subtitle.className = "atrium-media-sub";
  info.append(name, title, subtitle);

  const isOff = () => ["off", "standby"].includes(this._hass.states?.[entityId]?.state);
  const power = iconButton("atrium-media-power", "mdi:power", () => call(isOff() ? "turn_on" : "turn_off"));

  const controls = document.createElement("div");
  controls.className = "atrium-media-controls";
  const prev = iconButton("atrium-media-btn", "mdi:skip-previous", () => call("media_previous_track"));
  prev.setAttribute("aria-label", "Previous");
  const playPause = iconButton("atrium-media-btn play", "mdi:play", () => call("media_play_pause"));
  const next = iconButton("atrium-media-btn", "mdi:skip-next", () => call("media_next_track"));
  next.setAttribute("aria-label", "Next");
  controls.append(prev, playPause, next);

  const volumeRow = document.createElement("div");
  volumeRow.className = "atrium-media-volume";
  const mute = iconButton("atrium-media-mute", "mdi:volume-high", () => call("volume_mute", { is_volume_muted: !this._hass.states?.[entityId]?.attributes?.is_volume_muted }));
  mute.setAttribute("aria-label", `Mute ${displayName}`);
  const volume = document.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.className = "atrium-media-slider";
  volume.setAttribute("aria-label", `${displayName} volume`);
  volumeRow.append(mute, volume);

  card.append(art, info, power, controls, volumeRow);

  const ref = { card, art, title, subtitle, power, prev, next, playPause, volumeRow, mute, volume, displayName, artworkUrl: undefined, volumeDragging: false };
  volume.addEventListener("input", () => {
    ref.volumeDragging = true;
    volume.style.setProperty("--v", `${volume.value}%`);
  });
  volume.addEventListener("change", () => {
    ref.volumeDragging = false;
    call("volume_set", { volume_level: Number(volume.value) / 100 });
  });

  this._refs.areas.get(area.area_id).media.set(entityId, ref);
  this._updateMediaRef(ref, entityId);
  return card;
}

// Lights, switches, covers and toggle helpers sit side by side as
// independently headed groups in one wrapping row rather than stacked sections — a room's
// dimmers, plain on/off devices and blinds read as one glance.
export function _buildDeviceGroupsRow(area, { lights, switches, covers, inputBooleans, deviceSensors }) {
  const row = document.createElement("div");
  row.className = "atrium-groups-row";
  const group = (title, action, grid) => {
    const el = document.createElement("div");
    el.className = "atrium-group";
    el.append(this._sectionHead(title, action), grid);
    row.appendChild(el);
  };
  if (lights.length) {
    const anyOn = () => lights.some((l) => this._hass.states?.[l.entity_id]?.state === "on");
    group("Lights", lights.length > 1 ? this._bulkButton(() => this._toggleAllLights(lights), () => (anyOn() ? "All off" : "All on")) : null, this._divaGrid(area, lights, "light", deviceSensors));
  }
  if (switches.length) group("Devices", null, this._divaGrid(area, switches, "switch", deviceSensors));
  if (inputBooleans.length) group("Toggles", null, this._divaGrid(area, inputBooleans, "input_boolean"));
  if (covers.length) {
    const anyOpen = () => covers.some((c) => fmtCoverPct(this._hass.states?.[c.entity_id] || { attributes: {} }) > 5);
    group("Covers", covers.length > 1 ? this._bulkButton(() => this._toggleAllCovers(covers), () => (anyOpen() ? "Close all" : "Open all")) : null, this._divaGrid(area, covers, "cover"));
  }
  return this._section(null, row);
}

export function _sectionHead(title, action) {
  const head = document.createElement("div");
  head.className = "atrium-shead";
  const label = document.createElement("span");
  label.textContent = title;
  head.appendChild(label);
  if (action) head.appendChild(action);
  return head;
}

// "All off" / "Close all" style buttons: the label follows live state, so
// it's registered for the panel's in-place refresh.
export function _bulkButton(onClick, label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "atrium-act-btn";
  btn.textContent = label();
  btn.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  this._refs.bulk.push({ btn, label });
  return btn;
}

const DIVA_KIND = {
  light: { icon: ICONS.bulb, refKey: "lights" },
  switch: { icon: ICONS.toggle, refKey: "switches" },
  cover: { icon: "mdi:blinds-horizontal", refKey: "covers" },
  input_boolean: { icon: "mdi:toggle-switch-outline", refKey: "switches" },
};

export function _divaGrid(area, entities, kind, deviceSensors) {
  const grid = document.createElement("div");
  grid.className = "atrium-diva-grid";
  for (const entity of entities) grid.appendChild(this._buildDivaTile(area, entity, { kind, ...DIVA_KIND[kind] }, deviceSensors));
  return grid;
}

// Vertical track tile shared by lights, switches and covers — a fixed-width
// track that fills from the bottom, with a round icon thumb riding the
// current level. `kind` drives the drag/tap physics in `_bindDivaTrack`.
export function _buildDivaTile(area, entity, { kind, icon, refKey }, deviceSensors) {
  const wrap = document.createElement("div");
  wrap.className = "atrium-diva";
  wrap.dataset.entity = entity.entity_id;

  const track = document.createElement("button");
  track.type = "button";
  track.className = "atrium-diva-track";
  for (const pct of [25, 50, 75]) {
    const tick = document.createElement("span");
    tick.className = "atrium-diva-tick";
    tick.style.top = `${pct}%`;
    track.appendChild(tick);
  }
  const fill = document.createElement("span");
  fill.className = "atrium-diva-fill";
  const pctTop = document.createElement("span");
  pctTop.className = "atrium-diva-pct";
  const pctBottom = document.createElement("span");
  pctBottom.className = "atrium-diva-pct bottom";
  const thumb = document.createElement("span");
  thumb.className = "atrium-diva-thumb";
  const customIcon = this._hass.entities?.[entity.entity_id]?.icon ?? this._hass.states?.[entity.entity_id]?.attributes?.icon;
  thumb.innerHTML = haIcon(customIcon || icon, 17);
  track.append(fill, pctTop, pctBottom, thumb);

  const name = document.createElement("div");
  name.className = "atrium-diva-name";
  name.textContent = nameWithoutAreaPrefix(this._entityName(entity), area, entity.entity_id);
  const ago = document.createElement("div");
  ago.className = "atrium-diva-ago";

  wrap.append(track, name, ago);

  const ref = { wrap, track, fill, pctTop, pctBottom, thumb, name, ago, kind };
  this._refs.areas.get(area.area_id)[refKey].set(entity.entity_id, ref);
  this._bindDivaTrack(ref, entity.entity_id, kind);
  this._updateDivaRef(ref, entity.entity_id, kind);

  const linkedSensors = deviceSensors?.get(entity.entity_id);
  if (linkedSensors?.length) {
    // Sensors tied to the same device as this tile (e.g. a fan's power
    // meter) live in a caret popover instead of the generic sensors list.
    wrap.appendChild(this._buildDeviceSensorCaret(area, entity, linkedSensors));
  }

  return wrap;
}

export function _buildDeviceSensorCaret(area, entity, sensors) {
  const caret = document.createElement("button");
  caret.type = "button";
  caret.className = "atrium-diva-caret";
  caret.setAttribute("aria-label", `${nameWithoutAreaPrefix(this._entityName(entity), area)} sensors`);
  caret.innerHTML = haIcon("mdi:menu-down");
  caret.addEventListener("pointerdown", (e) => e.stopPropagation());

  const rows = sensors.map((s) => this._buildSensorTile(area, s, `${entity.entity_id}::${s.entity_id}`));

  caret.addEventListener("click", (e) => {
    e.stopPropagation();
    ensurePopoverItemStyle();
    this._openAnchors.add(caret);
    openListPopover({
      anchor: caret,
      title: nameWithoutAreaPrefix(this._entityName(entity), area),
      countLabel: String(sensors.length),
      items: rows,
      buildItem: (row) => row,
      listClass: "atrium-pop-list-sensors",
      width: 280,
      onClose: () => this._openAnchors.delete(caret),
    });
  });

  return caret;
}

export function _buildSensorsSection(area, sensors) {
  const grid = document.createElement("div");
  grid.className = "atrium-readings";
  for (const s of sensors) grid.appendChild(this._buildSensorTile(area, s));
  return this._section("Sensors", grid);
}

export function _buildSensorTile(area, sensor, mapKey = sensor.entity_id) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "atrium-reading";
  tile.dataset.entity = sensor.entity_id;
  tile.addEventListener("click", () => this._moreInfo(sensor.entity_id));

  const icon = document.createElement("ha-icon");
  icon.className = "atrium-reading-icon";
  const name = document.createElement("span");
  name.className = "atrium-reading-name";
  name.textContent = nameWithoutAreaPrefix(this._entityName(sensor), area);
  const value = document.createElement("span");
  value.className = "atrium-reading-value";
  tile.append(icon, name, value);

  const ref = { tile, icon, value, entityId: sensor.entity_id };
  this._refs.areas.get(area.area_id).sensors.set(mapKey, ref);
  this._updateSensorRef(ref);
  return tile;
}

// Each input_select is a labelled row of chips — every option one tap away,
// like the design's "Modes" section, instead of a dropdown.
export function _buildInputSelectsSection(area, inputSelects) {
  return this._section("Modes", inputSelects.map((s) => this._buildInputSelectTile(area, s)));
}

export function _buildInputSelectTile(area, entity) {
  const st = this._hass.states?.[entity.entity_id];
  const wrap = document.createElement("div");
  wrap.className = "atrium-mode";
  wrap.dataset.entity = entity.entity_id;

  const name = document.createElement("button");
  name.type = "button";
  name.className = "atrium-mode-name";
  name.textContent = nameWithoutAreaPrefix(this._entityName(entity), area);
  name.addEventListener("click", () => this._moreInfo(entity.entity_id));

  const chips = new Map();
  const row = document.createElement("div");
  row.className = "atrium-mode-chips";
  const options = Array.isArray(st?.attributes?.options) ? st.attributes.options : [];
  for (const option of options) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "atrium-mode-chip";
    chip.textContent = option;
    chip.addEventListener("click", () => this._call("input_select", "select_option", { entity_id: entity.entity_id, option }));
    chips.set(option, chip);
    row.appendChild(chip);
  }
  wrap.append(name, row);

  const ref = { wrap, chips };
  this._refs.areas.get(area.area_id).inputSelects.set(entity.entity_id, ref);
  this._updateInputSelectRef(ref, entity.entity_id);
  return wrap;
}

// Scenes and buttons share one wrapping row of icon pills. Firing a scene
// snapshots the colors the room's lights settle on and keeps them (in
// localStorage) as that scene's dimmed background — a preview of the scene.
export function _buildPillsSection(area, scenes, buttons, lights) {
  const wrap = document.createElement("div");
  wrap.className = "atrium-pills";
  const lightIds = lights.map((l) => l.entity_id);
  for (const scene of scenes) {
    const pill = this._buildPill(area, scene, {
      icon: (name) => iconForScene(scene, name),
      onPress: () => this._captureSceneColors(scene.entity_id, lightIds, pill, () => this._call("scene", "turn_on", { entity_id: scene.entity_id })),
    });
    const saved = readSceneGradient(scene.entity_id);
    if (saved) pill.style.setProperty("--pill-bg", saved);
    wrap.appendChild(pill);
  }
  for (const button of buttons) {
    wrap.appendChild(this._buildPill(area, button, {
      icon: () => "mdi:gesture-tap-button",
      onPress: () => this._call(button.entity_id.split(".")[0], "press", { entity_id: button.entity_id }),
    }));
  }
  return this._section(null, wrap);
}

export function _buildPill(area, entity, { icon, onPress }) {
  const hass = this._hass;
  const name = this._entityName(entity);
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "atrium-pill";
  pill.dataset.entity = entity.entity_id;
  const iconName = hass.entities?.[entity.entity_id]?.icon ?? hass.states?.[entity.entity_id]?.attributes?.icon ?? icon(name);
  pill.innerHTML = `${haIcon(iconName, 16)}<span class="atrium-pill-name"></span>`;
  pill.lastChild.textContent = nameWithoutAreaPrefix(name, area);
  let flashTimer = 0;
  bindLongPress(pill, {
    onTap: () => {
      onPress();
      pill.classList.add("flash");
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => pill.classList.remove("flash"), FLASH_MS);
    },
    onLongPress: () => this._moreInfo(entity.entity_id),
  });
  return pill;
}

// Lights fade into a scene over a moment (and a slow bulb or a busy
// integration can take a few seconds), so rather than a fixed delay the
// snapshot polls the room's lights and waits until they've changed and then
// held still — see settleStep.
const SCENE_POLL_MS = 250;
const SCENE_SETTLE = { stableMs: 800, maxMs: 8000 };

// `fire` applies the scene; the lights' "before" is read first, so even an
// instant state change counts as a change.
export function _captureSceneColors(sceneId, lightIds, pill, fire) {
  clearInterval(pill._sceneWatch);
  const sample = () => lightIds.map((id) => {
    const st = this._hass.states?.[id];
    const a = st?.attributes || {};
    return `${st?.state}|${a.brightness}|${a.rgb_color}|${a.color_temp_kelvin ?? a.color_temp}`;
  }).join(";");
  let state = settleStep(null, sample(), Date.now(), SCENE_SETTLE).state;
  fire();
  pill._sceneWatch = setInterval(() => {
    const step = settleStep(state, sample(), Date.now(), SCENE_SETTLE);
    state = step.state;
    if (!step.done) return;
    clearInterval(pill._sceneWatch);
    const gradient = lightsGradient(this._hass, lightIds);
    if (!gradient) return;
    pill.style.setProperty("--pill-bg", gradient);
    writeSceneGradient(sceneId, gradient);
  }, SCENE_POLL_MS);
}

// Scripts first, then automations (see routineRows). The "N off" badge
// under the list is a toggle: open, the switched-off automations are listed
// inline — no popover. Its open state is kept per room while the panel
// stays open. Routines hidden in HA are listed like any other.
export function _buildAutomationsSection(area, data) {
  const shown = data.scripts.length + data.automations.length;
  if (!shown && !data.disabledAutomations.length) return null;

  const open = { showDisabled: false, ...this._routineDrawers.get(area.area_id) };
  const section = this._section("Routines", []);
  const list = document.createElement("div");
  list.className = "atrium-alist";
  const rows = routineRows(data, open);
  for (const { entity } of rows) list.appendChild(this._buildAutomationRow(area, entity));
  list.hidden = !rows.length;

  const drawers = document.createElement("div");
  drawers.className = "atrium-routine-drawers";
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "atrium-autos-trigger";
  badge.innerHTML = `<span class="atrium-autos-trigger-iconwrap">${haIcon("mdi:pause-circle-outline", 20)}</span><span class="atrium-autos-trigger-label"><span></span><span class="atrium-autos-trigger-hint"></span></span>`;
  badge.addEventListener("click", () => {
    open.showDisabled = !open.showDisabled;
    this._routineDrawers.set(area.area_id, { ...open });
    this._refreshRoutines(this._dataForArea(area));
    // The rows open at the very end of the panel: follow them down, once
    // they've grown to full height.
    if (open.showDisabled) setTimeout(() => this._pin?.scrollTo({ top: this._pin.scrollHeight, behavior: "smooth" }), ROW_MOTION.duration);
  });
  drawers.appendChild(badge);
  section.append(list, drawers);

  this._routinesUI = { area, list, badge, drawers, open };
  this._updateRoutinesBadge(data);
  return section;
}

export function _updateRoutinesBadge(data) {
  const { badge, drawers, open } = this._routinesUI;
  const count = data.disabledAutomations.length;
  drawers.hidden = !count;
  const [countEl, hintEl] = badge.lastChild.children;
  countEl.textContent = `${count} off`;
  hintEl.textContent = ` · click to ${open.showDisabled ? "hide" : "show"}`;
  badge.classList.toggle("open", open.showDisabled);
  badge.setAttribute("aria-pressed", String(open.showDisabled));
}

// Brings the Routines list in line with the current states without a
// rebuild: after the badge toggle, or when an automation is switched on/off.
export function _refreshRoutines(data) {
  const ui = this._routinesUI;
  if (!ui?.list.isConnected) return;
  this._updateRoutinesBadge(data);
  this._syncRoutineRows(ui.area, ui.list, routineRows(data, ui.open));
}

const ROW_MOTION = { duration: 320, easing: "cubic-bezier(.32,.72,0,1)" };

// Rows that stay are left exactly as they are (same elements, nothing
// re-rendered); rows that move (switched on/off) slide into their new spot;
// rows that appear are inserted in place and grow open; rows that go away
// shrink closed, then are removed.
export function _syncRoutineRows(area, list, rows) {
  const refs = this._refs.areas.get(area.area_id).automations;
  const wanted = new Set(rows.map((r) => r.entity.entity_id));

  for (const [entityId, ref] of [...refs]) {
    if (wanted.has(entityId) || ref.row.parentElement !== list) continue;
    refs.delete(entityId);
    collapseRow(ref.row);
  }

  let cursor = list.firstElementChild;
  const skipLeaving = () => { while (cursor?.classList.contains("leaving")) cursor = cursor.nextElementSibling; };
  for (const { entity } of rows) {
    skipLeaving();
    const existing = refs.get(entity.entity_id)?.row;
    if (existing && existing.parentElement === list) {
      if (existing === cursor) cursor = cursor.nextElementSibling;
      else {
        list.insertBefore(existing, cursor);
        existing.animate([{ opacity: 0, transform: "translateY(10px) scale(.97)" }, { opacity: getComputedStyle(existing).opacity, transform: "none" }], ROW_MOTION);
      }
      continue;
    }
    const row = this._buildAutomationRow(area, entity);
    list.insertBefore(row, cursor);
    expandRow(row);
  }
  if (rows.length) list.hidden = false;
  else if (!list.querySelector(".atrium-auto-row:not(.leaving)")) setTimeout(() => { if (!list.querySelector(".atrium-auto-row:not(.leaving)")) list.hidden = true; }, ROW_MOTION.duration);
}

// Height animations need real pixel heights (auto isn't animatable); the
// list's 6px gap is folded into a negative margin so neighbours glide too.
function expandRow(row) {
  const style = getComputedStyle(row);
  const to = { height: `${row.offsetHeight}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, marginTop: "0px", opacity: style.opacity };
  const from = { height: "0px", paddingTop: "0px", paddingBottom: "0px", marginTop: "-6px", opacity: 0 };
  row.style.overflow = "hidden";
  row.animate([from, to], ROW_MOTION).finished.then(() => { row.style.overflow = ""; }, () => {});
}

function collapseRow(row) {
  const style = getComputedStyle(row);
  row.classList.add("leaving");
  row.style.overflow = "hidden";
  const from = { height: `${row.offsetHeight}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, marginTop: "0px", opacity: style.opacity };
  const to = { height: "0px", paddingTop: "0px", paddingBottom: "0px", marginTop: "-6px", opacity: 0 };
  row.animate([from, to], { ...ROW_MOTION, duration: 240, fill: "forwards" }).finished.then(() => row.remove(), () => row.remove());
}

// Toggle swatch left, name + labels / "On · 42 minutes ago" in the middle,
// run button right. Tapping the name opens more-info.
export function _buildAutomationRow(area, item) {
  const hass = this._hass;
  const state = hass.states?.[item.entity_id];
  const isScript = item.entity_id.startsWith("script.");
  const customIcon = hass.entities?.[item.entity_id]?.icon ?? state?.attributes?.icon ?? null;
  const displayName = nameWithoutAreaPrefix(this._entityName(item), area);

  const row = document.createElement("div");
  row.className = "atrium-auto-row" + (isScript ? " is-script" : "");
  row.dataset.entity = item.entity_id;

  const swatch = document.createElement(isScript ? "span" : "button");
  swatch.className = "atrium-auto-swatch" + (isScript ? " script" : "");
  swatch.innerHTML = haIcon(customIcon || (isScript ? ICONS.script : ICONS.auto), 17);
  if (!isScript) {
    swatch.type = "button";
    swatch.setAttribute("aria-label", `Toggle ${displayName}`);
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOn = this._hass.states?.[item.entity_id]?.state !== "off";
      this._call("automation", isOn ? "turn_off" : "turn_on", { entity_id: item.entity_id });
    });
  }

  const body = document.createElement("button");
  body.type = "button";
  body.className = "atrium-auto-body";
  // A script's whole row (▶ included) opens its details — HA's own way to run
  // it, with its fields if it has any. An automation's name does the same.
  if (isScript) row.addEventListener("click", () => this._moreInfo(item.entity_id));
  else body.addEventListener("click", () => this._moreInfo(item.entity_id));
  const titleLine = document.createElement("span");
  titleLine.className = "atrium-auto-title";
  const name = document.createElement("span");
  name.className = "atrium-auto-name";
  name.textContent = displayName;
  const labels = document.createElement("span");
  labels.className = "atrium-auto-labels";
  titleLine.append(name);
  const sub = document.createElement("span");
  sub.className = "atrium-auto-last";
  // Labels get their own line, above the name.
  body.append(labels, titleLine, sub);

  // For a script, ▶ is only a visual cue: clicks pass through to the row.
  const play = document.createElement(isScript ? "span" : "button");
  if (isScript) play.setAttribute("aria-hidden", "true");
  else play.type = "button";
  play.className = "atrium-auto-play";
  play.setAttribute("aria-label", `${isScript ? "Run" : "Trigger"} ${displayName}`);
  play.innerHTML = haIcon(ICONS.play, 15);

  row.append(swatch, body, play);

  const ref = { row, swatch, name, sub, labels, play, isScript, flashUntil: 0 };
  if (!isScript) {
    play.addEventListener("click", (e) => {
      e.stopPropagation();
      if (play.classList.contains("disabled")) return;
      this._call("automation", "trigger", { entity_id: item.entity_id });
      ref.flashUntil = Date.now() + FLASH_MS;
      this._updateAutomationRef(ref, item.entity_id);
      setTimeout(() => this._updateAutomationRef(ref, item.entity_id), FLASH_MS);
    });
  }

  this._refs.areas.get(area.area_id).automations.set(item.entity_id, ref);
  this._updateAutomationRef(ref, item.entity_id);
  return row;
}

