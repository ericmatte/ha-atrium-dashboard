import { openPopover, closePopoverFor, openListPopover } from "../lib/popover.js";
import { haIcon, bindLongPress, readSceneGradient, writeSceneGradient } from "../lib/dom-utils.js";
import {
  ICONS,
  nameWithoutAreaPrefix,
  ensurePopoverItemStyle,
  fmtCoverPct,
  computeSceneGradient,
} from "./area-card-shared.js";
import { FLASH_MS } from "./area-card-updaters.js";

// Panel content for one selected room, in the order the design settled on:
// climate (own full-width card), scenes/buttons (a pill strip), lights +
// switches side by side, mode selectors, covers, sensor readings, then
// automations & scripts last.
export function _buildRoomSections(area, data) {
  const sections = [];
  if (data.climates.length) sections.push(this._buildClimateSection(area, data.climates));

  if (data.scenes.length || data.buttons.length) sections.push(this._buildPillsSection(area, data.scenes, data.buttons));

  if (data.lights.length || data.switches.length) {
    sections.push(this._buildDeviceGroupsRow(area, data.lights, data.switches, data.deviceSensors));
  }
  if (data.inputSelects.length) sections.push(this._buildInputSelectsSection(area, data.inputSelects));
  if (data.covers.length) sections.push(this._buildCoversSection(area, data.covers));

  const genericSensors = [...data.sensors.extras, ...data.sensors.other];
  if (genericSensors.length) sections.push(this._buildSensorsSection(area, genericSensors));

  const routines = this._buildAutomationsSection(area, data.automations, data.scripts);
  if (routines) sections.push(routines);
  if (data.hiddenRoutines?.length) sections.push(this._buildHiddenRoutinesBtn(area, data.hiddenRoutines));

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

export function _buildClimateTile(area, climate) {
  const tile = document.createElement("div");
  tile.className = "atrium-tile wide atrium-climate";
  tile.dataset.entity = climate.entity_id;

  const swatch = document.createElement("div");
  swatch.className = "atrium-climate-swatch";
  swatch.style.cursor = "pointer";
  swatch.innerHTML = haIcon(ICONS.thermo, 16);

  const text = document.createElement("div");
  text.className = "atrium-climate-text";
  const name = document.createElement("button");
  name.type = "button";
  name.className = "atrium-climate-name";
  name.textContent = nameWithoutAreaPrefix(this._entityName(climate), area);
  name.addEventListener("click", (e) => {
    e.stopPropagation();
    this._moreInfo(climate.entity_id);
  });
  const meta = document.createElement("span");
  meta.className = "atrium-climate-meta";
  text.append(name, meta);

  const controls = document.createElement("div");
  controls.className = "atrium-climate-controls";
  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "atrium-climate-btn";
  minus.innerHTML = haIcon(ICONS.minus, 14);
  minus.addEventListener("click", (e) => { e.stopPropagation(); this._adjustClimate(climate.entity_id, -1); });
  const temp = document.createElement("div");
  temp.className = "atrium-climate-num";
  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "atrium-climate-btn";
  plus.innerHTML = haIcon(ICONS.plus, 14);
  plus.addEventListener("click", (e) => { e.stopPropagation(); this._adjustClimate(climate.entity_id, 1); });
  controls.append(minus, temp, plus);

  tile.append(swatch, text, controls);

  // The swatch doubles as the mode-picker anchor when the entity exposes
  // multiple hvac modes; otherwise it opens more-info.
  let modeItems = [], modeCurrent = null, modeOnPick = () => {};
  const modeMenu = {
    setItems: (items, current, onPick) => {
      modeItems = items;
      modeCurrent = current;
      modeOnPick = onPick;
    },
  };

  swatch.addEventListener("click", (e) => {
    e.stopPropagation();
    if (swatch.dataset.menu === "mode") {
      this._openClimateMenu(swatch, modeItems, modeCurrent, modeOnPick);
    } else {
      this._moreInfo(climate.entity_id);
    }
  });

  const ref = { tile, swatch, name, meta, temp, modeMenu };
  this._refs.areas.get(area.area_id).climates.set(climate.entity_id, ref);
  this._updateClimateRef(ref, climate.entity_id);
  return tile;
}

export function _openClimateMenu(anchor, items, current, onPick) {
  ensurePopoverItemStyle();
  const list = document.createElement("div");
  list.className = "atrium-pop-menu";
  for (const it of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "atrium-pop-menu-item" + (it.id === current ? " active" : "");
    b.innerHTML = `${haIcon(it.icon || ICONS.thermo)}<span>${it.label}</span>`;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      closePopoverFor(anchor);
      onPick(it.id);
    });
    list.appendChild(b);
  }
  this._openAnchors.add(anchor);
  openPopover({
    anchor,
    content: list,
    onClose: () => this._openAnchors.delete(anchor),
  });
}

// Lights and switches sit side by side as two independently-headed groups
// (one wrapping flex row) rather than two stacked sections — a room's
// dimmers and its plain on/off devices read as one glance.
export function _buildDeviceGroupsRow(area, lights, switches, deviceSensors) {
  const row = document.createElement("div");
  row.className = "atrium-groups-row";
  if (lights.length) {
    const group = document.createElement("div");
    group.className = "atrium-group";
    group.append(
      this._sectionHead("Lights", lights.length > 1 ? this._bulkButton(() => this._toggleAllLights(lights), () => (lights.some((l) => this._hass.states?.[l.entity_id]?.state === "on") ? "All off" : "All on")) : null),
      this._divaGrid(area, lights, "light", deviceSensors),
    );
    row.appendChild(group);
  }
  if (switches.length) {
    const group = document.createElement("div");
    group.className = "atrium-group";
    group.append(this._sectionHead("Devices"), this._divaGrid(area, switches, "switch", deviceSensors));
    row.appendChild(group);
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
};

export function _divaGrid(area, entities, kind, deviceSensors) {
  const grid = document.createElement("div");
  grid.className = "atrium-diva-grid";
  for (const entity of entities) grid.appendChild(this._buildDivaTile(area, entity, { kind, ...DIVA_KIND[kind] }, deviceSensors));
  return grid;
}

export function _buildCoversSection(area, covers) {
  const action = covers.length > 1
    ? this._bulkButton(() => this._toggleAllCovers(covers), () => (covers.some((c) => fmtCoverPct(this._hass.states?.[c.entity_id] || { attributes: {} }) > 5) ? "Close all" : "Open all"))
    : null;
  const wrap = document.createElement("div");
  wrap.className = "atrium-section";
  wrap.append(this._sectionHead("Covers", action), this._divaGrid(area, covers, "cover"));
  return wrap;
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
  name.textContent = nameWithoutAreaPrefix(this._entityName(entity), area);
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
  caret.setAttribute("aria-label", `${this._entityName(entity)} sensors`);
  caret.innerHTML = haIcon("mdi:menu-down");
  caret.addEventListener("pointerdown", (e) => e.stopPropagation());

  const rows = sensors.map((s) => this._buildSensorTile(area, s, `${entity.entity_id}::${s.entity_id}`));

  caret.addEventListener("click", (e) => {
    e.stopPropagation();
    ensurePopoverItemStyle();
    this._openAnchors.add(caret);
    openListPopover({
      anchor: caret,
      title: this._entityName(entity),
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

// Scenes and buttons share one wrapping row of pills, each marked by a color
// dot (a scene's last-seen light colors, when known).
export function _buildPillsSection(area, scenes, buttons) {
  const wrap = document.createElement("div");
  wrap.className = "atrium-pills";
  for (const scene of scenes) {
    wrap.appendChild(this._buildPill(area, scene, {
      dot: readSceneGradient(scene.entity_id) || computeSceneGradient(this._hass, scene.entity_id),
      onPress: (pill) => {
        this._call("scene", "turn_on", { entity_id: scene.entity_id });
        this._refreshSceneGradient(scene.entity_id, pill.querySelector(".atrium-pill-dot"));
      },
    }));
  }
  for (const button of buttons) {
    wrap.appendChild(this._buildPill(area, button, {
      onPress: () => this._call("button", "press", { entity_id: button.entity_id }),
    }));
  }
  return this._section(null, wrap);
}

export function _buildPill(area, entity, { dot, onPress }) {
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "atrium-pill";
  pill.dataset.entity = entity.entity_id;
  pill.innerHTML = `<span class="atrium-pill-dot"></span><span class="atrium-pill-name"></span>`;
  if (dot) pill.firstChild.style.background = dot;
  pill.lastChild.textContent = nameWithoutAreaPrefix(this._entityName(entity), area);
  let flashTimer = 0;
  bindLongPress(pill, {
    onTap: () => {
      onPress(pill);
      pill.classList.add("flash");
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => pill.classList.remove("flash"), FLASH_MS);
    },
    onLongPress: () => this._moreInfo(entity.entity_id),
  });
  return pill;
}

export function _refreshSceneGradient(entityId, dot) {
  setTimeout(() => {
    const gradient = computeSceneGradient(this._hass, entityId);
    if (!gradient) return;
    dot.style.background = gradient;
    writeSceneGradient(entityId, gradient);
  }, 700);
}

export function _buildAutomationsSection(area, automations, scripts) {
  const items = [...automations, ...scripts];
  if (!items.length) return null;

  let title;
  if (automations.length && scripts.length) title = "Automations & scripts";
  else if (scripts.length) title = scripts.length > 1 ? "Scripts" : "Script";
  else title = automations.length > 1 ? "Automations" : "Automation";

  const list = document.createElement("div");
  list.className = "atrium-alist";
  for (const item of items) list.appendChild(this._buildAutomationRow(area, item));
  return this._section(title, list);
}

// Toggle swatch left, name + labels / "On · 42 minutes ago" in the middle,
// run button right. Tapping the name opens more-info.
export function _buildAutomationRow(area, item) {
  const hass = this._hass;
  const state = hass.states?.[item.entity_id];
  const isScript = item.entity_id.startsWith("script.");
  const customIcon = hass.entities?.[item.entity_id]?.icon ?? state?.attributes?.icon ?? null;
  const displayName = this._entityName(item);

  const row = document.createElement("div");
  row.className = "atrium-auto-row";
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
  body.addEventListener("click", () => this._moreInfo(item.entity_id));
  const titleLine = document.createElement("span");
  titleLine.className = "atrium-auto-title";
  const name = document.createElement("span");
  name.className = "atrium-auto-name";
  name.textContent = displayName;
  const labels = document.createElement("span");
  labels.className = "atrium-auto-labels";
  titleLine.append(name, labels);
  const sub = document.createElement("span");
  sub.className = "atrium-auto-last";
  body.append(titleLine, sub);

  const play = document.createElement("button");
  play.type = "button";
  play.className = "atrium-auto-play";
  play.setAttribute("aria-label", `${isScript ? "Run" : "Trigger"} ${displayName}`);
  play.innerHTML = haIcon(ICONS.play, 15);

  row.append(swatch, body, play);

  const ref = { row, swatch, name, sub, labels, play, isScript, flashUntil: 0 };
  play.addEventListener("click", (e) => {
    e.stopPropagation();
    if (play.classList.contains("disabled")) return;
    if (isScript) this._call("script", "turn_on", { entity_id: item.entity_id });
    else this._call("automation", "trigger", { entity_id: item.entity_id });
    ref.flashUntil = Date.now() + FLASH_MS;
    this._updateAutomationRef(ref, item.entity_id);
    setTimeout(() => this._updateAutomationRef(ref, item.entity_id), FLASH_MS);
  });

  this._refs.areas.get(area.area_id).automations.set(item.entity_id, ref);
  this._updateAutomationRef(ref, item.entity_id);
  return row;
}

export function _buildHiddenRoutinesBtn(area, hiddenItems) {
  const rows = hiddenItems.map((item) => this._buildAutomationRow(area, item));

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "atrium-autos-trigger";
  const count = hiddenItems.length;
  btn.innerHTML =
    `<span class="atrium-autos-trigger-iconwrap">${haIcon("mdi:eye-off-outline", 20)}</span>` +
    `<span class="atrium-autos-trigger-label">${count} hidden</span>`;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    ensurePopoverItemStyle();
    this._openAnchors.add(btn);
    openListPopover({
      anchor: btn,
      title: "Hidden routines",
      countLabel: String(count),
      items: rows,
      buildItem: (row) => row,
      listClass: "atrium-pop-list-rooms",
      listStyle: "border-radius:12px;overflow:hidden",
      width: 320,
      onClose: () => this._openAnchors.delete(btn),
    });
  });

  return btn;
}
