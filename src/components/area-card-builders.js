import { openPopover, closePopoverFor, openListPopover } from "../lib/popover.js";
import { haIcon, vibrate, bindLongPress, readSceneGradient, writeSceneGradient, navigateTo, automationEditorPath } from "../lib/dom-utils.js";
import {
  ICONS,
  nameWithoutAreaPrefix,
  ensurePopoverItemStyle,
  fmtCoverPct,
  iconForScene,
  lightsGradient,
} from "./area-card-shared.js";
import { routineGroups } from "../lib/area-data.js";
import { routineColors } from "../lib/routine-colors.js";
import { t } from "../lib/i18n.js";
import { settleStep } from "../lib/settle.js";
import { FLASH_MS, TOUCH_INTENT_MS, SCROLL_SLOP } from "./area-card-updaters.js";

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
  const minus = stepButton(t("lowerTarget"), -1);
  const target = document.createElement("span");
  target.className = "atrium-climate-target";
  const plus = stepButton(t("raiseTarget"), 1);
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
  const labels = { mode: t("mode"), fan: t("fanMode"), swing: t("swingMode") };
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
  // The slider keeps the volume asked for until HA reports it (see _updateMediaRef).
  const setVolume = (pct) => {
    this._optimistic?.set(`${entityId}:volume`, pct);
    call("volume_set", { volume_level: pct / 100 });
  };
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
  const deviceIcon = this._hass.entities?.[entityId]?.icon || (this._hass.states?.[entityId]?.attributes?.device_class === "tv" ? "mdi:television" : "mdi:speaker");
  art.innerHTML = haIcon(deviceIcon, 24);

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
  prev.setAttribute("aria-label", t("previous"));
  const playPause = iconButton("atrium-media-btn play", "mdi:play", () => call("media_play_pause"));
  const next = iconButton("atrium-media-btn", "mdi:skip-next", () => call("media_next_track"));
  next.setAttribute("aria-label", t("next"));
  controls.append(prev, playPause, next);

  const volumeRow = document.createElement("div");
  volumeRow.className = "atrium-media-volume";
  const mute = iconButton("atrium-media-mute", "mdi:volume-high", () => call("volume_mute", { is_volume_muted: !this._hass.states?.[entityId]?.attributes?.is_volume_muted }));
  mute.setAttribute("aria-label", t("muteName", displayName));
  const volume = document.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.className = "atrium-media-slider";
  volume.setAttribute("aria-label", t("volumeOf", displayName));
  volumeRow.append(mute, volume);

  card.append(art, info, power, controls, volumeRow);

  const ref = { card, art, deviceIcon, title, subtitle, power, controls, prev, next, playPause, volumeRow, mute, volume, displayName, artworkUrl: undefined, volumeDragging: false };
  let touchDrag = null;
  let sliderPointer = null;
  let clickAnimation = 0;
  const sliderValueAt = (clientX) => {
    const rect = volume.getBoundingClientRect();
    const inset = 8;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - inset) / Math.max(1, rect.width - inset * 2)));
    return Math.round(Number(volume.min || 0) + ratio * (Number(volume.max || 100) - Number(volume.min || 0)));
  };
  const setSliderValue = (value) => {
    volume.value = String(value);
    volume.style.setProperty("--v", `${value}%`);
  };
  const animateSlider = (from, to, done) => {
    cancelAnimationFrame(clickAnimation);
    const startedAt = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - startedAt) / 180);
      setSliderValue(t === 1 ? to : Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
      if (t < 1) clickAnimation = requestAnimationFrame(frame);
      else done?.();
    };
    clickAnimation = requestAnimationFrame(frame);
  };
  const onSliderPointerMove = (event) => {
    if (!sliderPointer || event.pointerId !== sliderPointer.pointerId) return;
    if (Math.hypot(event.clientX - sliderPointer.x, event.clientY - sliderPointer.y) > 3) {
      sliderPointer.moved = true;
      cancelAnimationFrame(clickAnimation);
      setSliderValue(sliderValueAt(event.clientX));
    }
  };
  const endSliderPointer = (event) => {
    if (sliderPointer?.pointerId !== event.pointerId) return;
    if (event.type === "pointerup") {
      if (sliderPointer.moved) {
        setSliderValue(sliderValueAt(event.clientX));
        ref.volumeDragging = false;
        setVolume(Number(volume.value));
      } else {
        const target = sliderPointer.target;
        sliderPointer = null;
        window.removeEventListener("pointermove", onSliderPointerMove);
        window.removeEventListener("pointerup", endSliderPointer);
        window.removeEventListener("pointercancel", endSliderPointer);
        animateSlider(Number(volume.value), target, () => {
          ref.volumeDragging = false;
          setVolume(target);
        });
        return;
      }
    } else {
      cancelAnimationFrame(clickAnimation);
      ref.volumeDragging = false;
    }
    sliderPointer = null;
    window.removeEventListener("pointermove", onSliderPointerMove);
    window.removeEventListener("pointerup", endSliderPointer);
    window.removeEventListener("pointercancel", endSliderPointer);
  };
  volume.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse") return;
    event.preventDefault();
    cancelAnimationFrame(clickAnimation);
    sliderPointer = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    const from = Number(volume.value);
    const to = sliderValueAt(event.clientX);
    sliderPointer.target = to;
    ref.volumeDragging = true;
    setSliderValue(from);
    window.addEventListener("pointermove", onSliderPointerMove);
    window.addEventListener("pointerup", endSliderPointer);
    window.addEventListener("pointercancel", endSliderPointer);
  });
  const endTouchDrag = (event) => {
    if (touchDrag?.pointerId !== event.pointerId) return;
    if (event.type === "pointercancel") {
      touchDrag.cancelled = true;
      volume.value = touchDrag.value;
      ref.volumeDragging = false;
      volume.style.setProperty("--v", `${volume.value}%`);
    }
    volume.classList.remove("touch-pending");
    window.removeEventListener("pointermove", onTouchMove);
    window.removeEventListener("pointerup", endTouchDrag);
    window.removeEventListener("pointercancel", endTouchDrag);
  };
  const onTouchMove = (event) => {
    if (!touchDrag || event.pointerId !== touchDrag.pointerId || touchDrag.cancelled) return;
    if (event.timeStamp - touchDrag.startedAt >= TOUCH_INTENT_MS) return;
    if (Math.hypot(event.clientX - touchDrag.x, event.clientY - touchDrag.y) <= SCROLL_SLOP) return;
    touchDrag.cancelled = true;
    volume.value = touchDrag.value;
    ref.volumeDragging = false;
    volume.style.setProperty("--v", `${volume.value}%`);
  };
  volume.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") {
      touchDrag = null;
      volume.classList.remove("touch-pending");
      window.removeEventListener("pointermove", onTouchMove);
      window.removeEventListener("pointerup", endTouchDrag);
      window.removeEventListener("pointercancel", endTouchDrag);
      return;
    }
    touchDrag = { pointerId: event.pointerId, startedAt: event.timeStamp, x: event.clientX, y: event.clientY, value: volume.value, cancelled: false };
    volume.classList.add("touch-pending");
    window.addEventListener("pointermove", onTouchMove);
    window.addEventListener("pointerup", endTouchDrag);
    window.addEventListener("pointercancel", endTouchDrag);
  });
  volume.addEventListener("keydown", () => { touchDrag = null; });
  volume.addEventListener("input", (event) => {
    if (touchDrag?.cancelled) {
      volume.value = touchDrag.value;
      volume.style.setProperty("--v", `${volume.value}%`);
      return;
    }
    if (touchDrag && event.timeStamp - touchDrag.startedAt < TOUCH_INTENT_MS) return;
    volume.classList.remove("touch-pending");
    ref.volumeDragging = true;
    volume.style.setProperty("--v", `${volume.value}%`);
  });
  volume.addEventListener("change", () => {
    volume.classList.remove("touch-pending");
    if (touchDrag?.cancelled) {
      volume.value = touchDrag.value;
      volume.style.setProperty("--v", `${volume.value}%`);
      touchDrag = null;
      return;
    }
    if (touchDrag && !touchDrag.cancelled) {
      const target = sliderValueAt(touchDrag.x);
      const from = Number(touchDrag.value);
      touchDrag = null;
      ref.volumeDragging = true;
      setSliderValue(from);
      animateSlider(from, target, () => {
        ref.volumeDragging = false;
        setVolume(target);
      });
      return;
    }
    touchDrag = null;
    ref.volumeDragging = false;
    setVolume(Number(volume.value));
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
    const anyOn = () => lights.some((l) => this._shownOn(l.entity_id));
    group(t("lights"), lights.length > 1 ? this._bulkButton(() => this._toggleAllLights(lights), () => (anyOn() ? t("allOff") : t("allOn"))) : null, this._divaGrid(area, lights, "light", deviceSensors));
  }
  if (switches.length) group(t("devices"), null, this._divaGrid(area, switches, "switch", deviceSensors));
  if (inputBooleans.length) group(t("toggles"), null, this._divaGrid(area, inputBooleans, "input_boolean"));
  if (covers.length) {
    const anyOpen = () => covers.some((c) => this._shownLevel(c.entity_id) > 5);
    group(t("covers"), covers.length > 1 ? this._bulkButton(() => this._toggleAllCovers(covers), () => (anyOpen() ? t("closeAll") : t("openAll"))) : null, this._divaGrid(area, covers, "cover"));
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
  thumb.innerHTML = haIcon(customIcon || icon, 24);
  track.append(fill, pctTop, pctBottom, thumb);
  // Covers draw a shade instead, with a handle bar on its edge.
  let bar = null;
  if (kind === "cover") {
    track.classList.add("cover");
    bar = document.createElement("span");
    bar.className = "atrium-diva-bar";
    track.append(bar);
  }

  // The track toggles/drags; the name opens the entity's details.
  const name = document.createElement("button");
  name.type = "button";
  name.className = "atrium-diva-name";
  name.textContent = nameWithoutAreaPrefix(this._entityName(entity), area, entity.entity_id);
  name.addEventListener("click", () => this._moreInfo(entity.entity_id));
  const ago = document.createElement("div");
  ago.className = "atrium-diva-ago";

  wrap.append(track, name, ago);

  const ref = { wrap, track, fill, pctTop, pctBottom, thumb, bar, name, ago, kind };
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
  caret.setAttribute("aria-label", t("sensorsOf", nameWithoutAreaPrefix(this._entityName(entity), area)));
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
  return this._section(t("sensors"), grid);
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
  return this._section(t("modes"), inputSelects.map((s) => this._buildInputSelectTile(area, s)));
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

// Scripts first (always shown: they're what you run yourself), then the
// automations, most recently triggered first. Automations that haven't run
// for over a week, on or off, fold into an "inactive" drawer under the list;
// opened or closed in one room, it's the same in every room. Each routine
// has its own color (see routine-colors.js).
export function _buildAutomationsSection(area, data) {
  const groups = routineGroups(this._hass, data);
  if (!groups.scripts.length && !groups.active.length && !groups.inactive.length) return null;

  const section = this._section(t("routines"), []);
  const list = () => {
    const el = document.createElement("div");
    el.className = "atrium-alist";
    return el;
  };
  const scriptsList = list();

  const autosHead = document.createElement("div");
  autosHead.className = "atrium-routines-sub";
  autosHead.innerHTML = `<span class="atrium-routines-subtitle"></span><span class="atrium-routines-hint">${haIcon("mdi:gesture-tap-hold", 15)}<span></span></span>`;
  autosHead.firstChild.textContent = t("automations");
  autosHead.lastChild.lastChild.textContent = t("holdToTrigger");
  const activeList = list();

  const drawer = document.createElement("button");
  drawer.type = "button";
  drawer.className = "atrium-routines-drawer";
  drawer.innerHTML = `${haIcon("mdi:sleep", 18)}<span></span>${haIcon("mdi:chevron-down", 18)}`;
  drawer.addEventListener("click", () => {
    this._showInactive = !this._showInactive;
    this._refreshRoutines(this._dataForArea(area));
    // The rows land at their full height at once (they fade in rather than
    // grow), so the panel can glide all the way down to them in one go.
    if (this._showInactive) requestAnimationFrame(() => {
      const pin = this._pin;
      if (pin) pin.scrollTo({ top: pin.scrollHeight - pin.clientHeight, behavior: "smooth" });
    });
  });
  const inactiveList = list();

  section.append(scriptsList, autosHead, activeList, drawer, inactiveList);
  this._routinesUI = { area, scriptsList, autosHead, activeList, drawer, inactiveList };
  this._refreshRoutines(data, { building: true });
  return section;
}

// Brings the Routines lists in line with the current states without a
// rebuild: on every update, after the drawer toggle, or when an automation
// is switched on/off, triggers or goes quiet.
// `building`: the section isn't in the panel yet (its first fill).
export function _refreshRoutines(data, { building = false } = {}) {
  const ui = this._routinesUI;
  if (!ui || (!building && !ui.activeList.isConnected)) return;
  const groups = routineGroups(this._hass, data);
  const shown = [...groups.scripts, ...groups.active, ...groups.inactive];
  const hass = this._hass;
  ui.colors = routineColors(shown.map((e) => ({
    id: e.entity_id,
    isScript: e.entity_id.startsWith("script."),
    // An automation's config id survives renames; the entity_id otherwise.
    key: hass.states?.[e.entity_id]?.attributes?.id ?? e.entity_id,
  })));

  const autos = groups.active.length + groups.inactive.length;
  ui.autosHead.hidden = !autos;
  ui.drawer.hidden = !groups.inactive.length;
  ui.drawer.querySelector("span").textContent = t("inactiveForAWeek", groups.inactive.length);
  ui.drawer.setAttribute("aria-expanded", String(this._showInactive));

  this._syncRoutineLists(ui.area, [
    [ui.scriptsList, groups.scripts],
    [ui.activeList, groups.active],
    [ui.inactiveList, this._showInactive ? groups.inactive : []],
  ]);
  for (const [entityId, ref] of this._refs.areas.get(ui.area.area_id).automations) {
    const color = ui.colors.get(entityId);
    if (color) ref.row.style.setProperty("--routine", color);
  }
}

const ROW_MOTION = { duration: 260, easing: "cubic-bezier(.32,.72,0,1)" };

// Rows that stay are left exactly as they are (same elements, nothing
// re-rendered); rows that move within a list slide into their new spot;
// rows that appear are inserted in place and grow open; rows that leave a
// list (going inactive, or the drawer closing) shrink closed, then are removed.
export function _syncRoutineLists(area, groups) {
  const refs = this._refs.areas.get(area.area_id).automations;
  const home = new Map();
  for (const [list, entities] of groups) for (const e of entities) home.set(e.entity_id, list);

  for (const [entityId, ref] of [...refs]) {
    if (home.get(entityId) === ref.row.parentElement) continue;
    refs.delete(entityId);
    collapseRow(ref.row);
  }

  for (const [list, entities] of groups) {
    let cursor = list.firstElementChild;
    const skipLeaving = () => { while (cursor?.classList.contains("leaving")) cursor = cursor.nextElementSibling; };
    for (const entity of entities) {
      skipLeaving();
      const existing = refs.get(entity.entity_id)?.row;
      if (existing) {
        if (existing === cursor) cursor = cursor.nextElementSibling;
        else {
          list.insertBefore(existing, cursor);
          existing.animate([{ opacity: 0, transform: "translateY(10px) scale(.97)" }, { opacity: getComputedStyle(existing).opacity, transform: "none" }], ROW_MOTION);
        }
        continue;
      }
      const row = this._buildAutomationRow(area, entity);
      list.insertBefore(row, cursor);
      // Rows only grow open once the panel is showing; the first fill just appears.
      // The inactive drawer's rows fade in at full height, so the panel can
      // scroll straight down to them; elsewhere a new row grows open.
      if (list.isConnected) (list === this._routinesUI?.inactiveList ? fadeInRow : expandRow)(row);
    }
    if (entities.length) list.hidden = false;
    else if (!list.querySelector(".atrium-auto-row:not(.leaving)")) {
      if (!list.firstElementChild) list.hidden = true;
      else setTimeout(() => { if (!list.querySelector(".atrium-auto-row:not(.leaving)")) list.hidden = true; }, ROW_MOTION.duration);
    }
  }
}

// Height animations need real pixel heights (auto isn't animatable); the
// list's gap is folded into a negative margin so neighbours glide too.
function expandRow(row) {
  const style = getComputedStyle(row);
  const to = { height: `${row.offsetHeight}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, marginTop: "0px", opacity: style.opacity };
  const from = { height: "0px", paddingTop: "0px", paddingBottom: "0px", marginTop: "-8px", opacity: 0 };
  row.style.overflow = "hidden";
  row.animate([from, to], ROW_MOTION).finished.then(() => { row.style.overflow = ""; }, () => {});
}

function fadeInRow(row) {
  row.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: getComputedStyle(row).opacity, transform: "none" }], ROW_MOTION);
}

function collapseRow(row) {
  const style = getComputedStyle(row);
  row.classList.add("leaving");
  row.style.overflow = "hidden";
  const from = { height: `${row.offsetHeight}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, marginTop: "0px", opacity: style.opacity };
  const to = { height: "0px", paddingTop: "0px", paddingBottom: "0px", marginTop: "-8px", opacity: 0 };
  row.animate([from, to], { ...ROW_MOTION, duration: 200, fill: "forwards" }).finished.then(() => row.remove(), () => row.remove());
}

// A press shows nothing for HOLD_DELAY_MS (a quick tap stays a tap), then
// fills the ring for HOLD_MS (matching the CSS animation) before it triggers
// the automation; drifting HOLD_SLOP px counts as a scroll instead.
const HOLD_DELAY_MS = 100;
const HOLD_MS = 650;
const HOLD_SLOP = 8;

// A routine just ran: a sweep of its color across the row and a burst of
// sparks from its icon.
function sparkRow(row) {
  row.classList.remove("spark");
  void row.offsetWidth;
  row.classList.add("spark");
  setTimeout(() => row.classList.remove("spark"), 950);
  const burst = document.createElement("span");
  burst.className = "atrium-auto-burst";
  burst.innerHTML = Array.from({ length: 10 }, (_, i) => `<i style="--r:${i * 36 + 8}deg"></i>`).join("");
  row.appendChild(burst);
  setTimeout(() => burst.remove(), 800);
}

// Colored tile left, name + labels + when it last ran in the middle; an
// automation's switch or a script's Run button right. A script's row opens
// its details; an automation's opens its editor, and holding it triggers it.
export function _buildAutomationRow(area, item) {
  const hass = this._hass;
  const state = hass.states?.[item.entity_id];
  const entityId = item.entity_id;
  const isScript = entityId.startsWith("script.");
  const customIcon = hass.entities?.[entityId]?.icon ?? state?.attributes?.icon ?? null;
  const displayName = nameWithoutAreaPrefix(this._entityName(item), area);

  const row = document.createElement("div");
  row.className = "atrium-auto-row" + (isScript ? " is-script" : "");
  row.dataset.entity = entityId;
  const color = this._routinesUI?.colors?.get(entityId);
  if (color) row.style.setProperty("--routine", color);

  const ring = document.createElement("span");
  ring.className = "atrium-auto-ring";
  const tile = document.createElement("span");
  tile.className = "atrium-auto-tile";
  tile.innerHTML = haIcon(customIcon || (isScript ? ICONS.script : ICONS.auto), 24);

  const body = document.createElement("button");
  body.type = "button";
  body.className = "atrium-auto-body";
  const name = document.createElement("span");
  name.className = "atrium-auto-name";
  name.textContent = displayName;
  // Second line: when it last ran first, then its labels.
  const line = document.createElement("span");
  line.className = "atrium-auto-line";
  const meta = document.createElement("span");
  meta.className = "atrium-auto-meta";
  meta.innerHTML = `<span class="atrium-auto-dot"></span><span></span>`;
  const labels = document.createElement("span");
  labels.className = "atrium-auto-labels";
  line.append(meta, labels);
  body.append(name, line);

  const ref = { row, tile, name, sub: meta.lastChild, labels, isScript, flashUntil: 0 };
  const flash = () => {
    ref.flashUntil = Date.now() + FLASH_MS;
    this._updateAutomationRef(ref, entityId);
    sparkRow(row);
    setTimeout(() => this._updateAutomationRef(ref, entityId), FLASH_MS);
  };

  let control;
  if (isScript) {
    // A script with fields needs them filled in: its details dialog runs it.
    control = document.createElement("button");
    control.type = "button";
    control.className = "atrium-auto-run";
    control.innerHTML = `${haIcon(ICONS.play, 18)}<span></span>`;
    control.lastChild.textContent = t("run");
    control.setAttribute("aria-label", t("runName", displayName));
    control.addEventListener("click", (e) => {
      e.stopPropagation();
      const fields = this._hass.services?.script?.[entityId.slice("script.".length)]?.fields;
      if (fields && Object.keys(fields).length) return this._moreInfo(entityId);
      this._call("script", "turn_on", { entity_id: entityId });
      flash();
    });
    row.addEventListener("click", () => this._moreInfo(entityId));
  } else {
    control = document.createElement("button");
    control.type = "button";
    control.className = "atrium-auto-switch";
    control.setAttribute("role", "switch");
    control.setAttribute("aria-label", t("toggleName", displayName));
    control.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOn = this._hass.states?.[entityId]?.state !== "off";
      this._call("automation", isOn ? "turn_off" : "turn_on", { entity_id: entityId });
    });
    body.setAttribute("aria-description", t("holdToTrigger"));
    // Press and hold: nothing shows for HOLD_DELAY_MS, so a quick tap stays a
    // tap (it opens the editor). Past that, the ring fills for HOLD_MS and the
    // automation fires only if the finger stays down to the end; let go
    // sooner and nothing happens at all, editor included.
    let hold = null;
    let swallowClick = false;
    // Cmd/Ctrl-click (or a middle click) opens the editor in a new tab.
    const openEditor = (newTab) => {
      const path = automationEditorPath(this._hass, entityId);
      if (path && newTab) window.open(path, "_blank", "noopener");
      else if (path) navigateTo(path);
      else this._moreInfo(entityId);
    };
    body.addEventListener("click", (e) => {
      if (swallowClick) { swallowClick = false; return; }
      openEditor(e.metaKey || e.ctrlKey);
    });
    body.addEventListener("auxclick", (e) => {
      if (e.button === 1) openEditor(true);
    });
    const stop = () => {
      if (!hold) return;
      clearTimeout(hold.timer);
      row.classList.remove("holding");
      hold = null;
    };
    row.addEventListener("pointerdown", (e) => {
      swallowClick = false;
      if (e.button > 0 || e.metaKey || e.ctrlKey || e.target.closest(".atrium-auto-switch")) return;
      if (this._hass.states?.[entityId]?.state === "off") return;
      hold = { x: e.clientX, y: e.clientY };
      hold.timer = setTimeout(() => {
        // The hold has begun: from here the release is never a tap.
        swallowClick = true;
        row.classList.add("holding");
        hold.timer = setTimeout(() => {
          row.classList.remove("holding");
          hold = null;
          vibrate(12);
          this._call("automation", "trigger", { entity_id: entityId });
          flash();
        }, HOLD_MS);
      }, HOLD_DELAY_MS);
    });
    // Drifting off counts as a scroll; lifting or leaving before the end cancels.
    row.addEventListener("pointermove", (e) => { if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > HOLD_SLOP) stop(); });
    row.addEventListener("pointerup", stop);
    row.addEventListener("pointercancel", stop);
    row.addEventListener("pointerleave", stop);
    // Long-press on a phone would otherwise open the text-selection menu.
    row.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  ref.control = control;
  row.append(ring, tile, body, control);

  this._refs.areas.get(area.area_id).automations.set(entityId, ref);
  this._updateAutomationRef(ref, entityId);
  return row;
}
