import { haIcon, setIcon, tint, vibrate } from "../lib/dom-utils.js";
import { sensorTone } from "../lib/area-data.js";
import {
  TONE, ICONS,
  CLIMATE_LABELS, CLIMATE_ICONS,
  canDimLight, fmtBrightnessPct, fmtCoverPct, fmtTimeAgoShort, fmtTimeAgoLong,
  fmtSensorValue, iconForSensor,
  lightRgbTriple,
  labelDescriptor,
} from "./area-card-shared.js";

// Diva track geometry (px), matching the approved design: a 58×108 track
// around a round 34px icon thumb, 6px of padding top/bottom.
const THUMB = 34;
const PAD = 6;
// A light's fill fades out across the icon: solid up to 1/3 of its height,
// transparent at 2/3, so the fill reads as glowing from under the icon.
const FADE_START = Math.round(THUMB / 3);
const FADE_END = Math.round((THUMB * 2) / 3);
// Over the last 10 %, the fill grows to the top of the track and its fade
// turns solid, so 99 % → 100 % has no visible jump; mirrored under 10 % so
// 1 % → 0 % has none either.
const TOP_BLEND_FROM = 0.9;
const BOTTOM_BLEND_TO = 0.1;
// Slop before a press counts as a drag rather than a tap.
const DRAG_SLOP = 3;
// On/off tiles have two notches (closed/open); a press stretches the thumb
// a little toward the other end, then flicks once pulled 80% of the way.
const NOTCH_STRETCH = 0.1;
const NOTCH_STIFFNESS = 2.5;
const NOTCH_FLICK_AT = 0.8;
const FLICK_MS = 450;
// The live "NN%" label sits above the thumb at low levels, below it at high
// levels, crossfading in between so it's never covered by the icon.
const PCT_SWAP_FROM = 40;
const PCT_SWAP_TO = 60;
// Kept in sync with the `.flash` state in area-card.css.
export const FLASH_MS = 1400;

const SWITCH_COLOR = "#79d99a";
const TOGGLE_COLOR = "#8cc1ff";

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const alpha = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

function isDimmableFor(kind, st) {
  return kind === "cover" || (kind === "light" && canDimLight(st));
}

function accentFor(kind, st) {
  if (kind === "cover") return TONE.curtain;
  if (kind === "switch") return SWITCH_COLOR;
  if (kind === "input_boolean") return TOGGLE_COLOR;
  const rgb = lightRgbTriple(st);
  return rgb ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : TONE.light;
}

function onOffAndLevel(kind, st) {
  const dimmable = isDimmableFor(kind, st);
  if (kind === "cover") {
    const level = fmtCoverPct(st);
    return { on: level > 0, level, dimmable };
  }
  const on = st.state === "on";
  const level = dimmable ? fmtBrightnessPct(st) : on ? 100 : 0;
  return { on, level, dimmable };
}

// Everything a Diva track draws, from its state alone — a port of the
// design's divaVM. `thumbFrac` is where the icon rides (the rubber-banded
// drag position for on/off tiles); the fill of an on/off tile only ever
// snaps between empty and full.
export function divaVisual({ kind, on, level, dimmable, thumbFrac, color }) {
  const frac = on ? (dimmable ? level / 100 : 1) : 0;
  const thumb = thumbFrac ?? frac;
  const solid = kind === "cover" || !dimmable;
  const fillTop = solid ? THUMB / 2 : FADE_END;
  const topBlend = clamp01((frac - TOP_BLEND_FROM) / (1 - TOP_BLEND_FROM));
  const bottomBlend = clamp01(frac / BOTTOM_BLEND_TO);
  const travel = THUMB + PAD * 2;

  let fillHeight;
  if (!dimmable) fillHeight = on ? "100%" : "0%";
  else if (!on) fillHeight = "0px";
  else {
    const extra = (PAD + fillTop + topBlend * (PAD + THUMB - fillTop)) * bottomBlend;
    fillHeight = `calc((100% - ${travel}px) * ${frac.toFixed(3)} * ${bottomBlend.toFixed(3)} + ${extra.toFixed(1)}px)`;
  }
  const fillBackground = solid
    ? alpha(color, 90)
    : `linear-gradient(to top, ${alpha(color, 90)} 0, ${alpha(color, 90)} calc(100% - ${((FADE_END - FADE_START) * (1 - topBlend)).toFixed(1)}px), ${alpha(color, +(90 * topBlend).toFixed(1))} 100%)`;

  const showPct = on && dimmable;
  const pctBelow = clamp01((level - PCT_SWAP_FROM) / (PCT_SWAP_TO - PCT_SWAP_FROM));
  return {
    on,
    thumbBottom: `calc((100% - ${travel}px) * ${clamp01(thumb).toFixed(3)} + ${PAD}px)`,
    fillHeight,
    fillBackground,
    showPct,
    pctLabel: showPct ? `${level}%` : "",
    pctTopOpacity: (1 - pctBelow).toFixed(2),
    pctBottomOpacity: pctBelow.toFixed(2),
  };
}

export function _toggleEntity(entityId, kind, wantOn) {
  if (kind === "light") {
    if (!wantOn) this._call("light", "turn_off", { entity_id: entityId });
    else if (canDimLight(this._hass.states?.[entityId])) this._call("light", "turn_on", { entity_id: entityId, brightness_pct: 100 });
    else this._call("light", "turn_on", { entity_id: entityId });
  } else if (kind === "switch" || kind === "input_boolean") {
    this._call(kind, wantOn ? "turn_on" : "turn_off", { entity_id: entityId });
  } else if (kind === "cover") {
    this._call("cover", wantOn ? "open_cover" : "close_cover", { entity_id: entityId });
  }
}

// Renders a Diva track from the entity's real current state, or from the
// live drag preview in `override` ({ on, level, thumbFrac }) while a pointer
// owns it.
export function _updateDivaRef(ref, entityId, kind, override) {
  const st = this._hass.states?.[entityId];
  if (!st) return;
  const unavailable = st.state === "unavailable";
  const real = onOffAndLevel(kind, unavailable ? { ...st, state: "off" } : st);
  const { on, level } = override ?? real;
  const v = divaVisual({ kind, on, level, dimmable: real.dimmable, thumbFrac: override?.thumbFrac, color: accentFor(kind, st) });

  ref.track.classList.toggle("un", unavailable);
  ref.track.classList.toggle("dim", real.dimmable);
  ref.track.classList.toggle("onoff", !real.dimmable);
  ref.track.classList.toggle("on", v.on);
  ref.track.disabled = unavailable;
  ref.track.setAttribute(
    "aria-label",
    kind === "cover"
      ? `${ref.name.textContent}, ${level === 0 ? "closed" : level + "% open"}. Drag to set position, tap to open or close.`
      : `${ref.name.textContent}, ${unavailable ? "unavailable" : on ? (real.dimmable ? level + "%" : "on") : "off"}.` + (real.dimmable ? " Drag to dim, tap to toggle." : " Tap to toggle.")
  );

  ref.fill.style.height = v.fillHeight;
  ref.fill.style.background = v.fillBackground;
  ref.thumb.style.bottom = v.thumbBottom;
  ref.pctTop.style.display = ref.pctBottom.style.display = v.showPct ? "" : "none";
  ref.pctTop.textContent = ref.pctBottom.textContent = v.pctLabel;
  ref.pctTop.style.opacity = v.pctTopOpacity;
  ref.pctBottom.style.opacity = v.pctBottomOpacity;

  if (unavailable) ref.ago.textContent = "Unavailable";
  else {
    const since = fmtTimeAgoShort(st.last_changed || st.last_updated);
    ref.ago.textContent = since === "now" ? "Just now" : `${since} ago`;
  }
}

// Pointer physics for one Diva track. Dimmable entities (lights with
// brightness, covers) drop anywhere along the track; on/off-only entities
// (switches, non-dimmable lights) rubber-band toward whichever end the press
// started nearer, and flick to the other end only once pulled 80% of the way
// there (hysteresis both ways).
export function _bindDivaTrack(ref, entityId, kind) {
  const { track } = ref;

  track.addEventListener("pointerdown", (e) => {
    const st = this._hass.states?.[entityId];
    if (!st || st.state === "unavailable") return;
    const { on, level, dimmable } = onOffAndLevel(kind, st);
    const startFrac = on ? (dimmable ? level / 100 : 1) : 0;
    const rect = track.getBoundingClientRect();
    try { track.setPointerCapture(e.pointerId); } catch (_) {}

    const drag = { pointerId: e.pointerId, y: e.clientY, startFrac, dimmable, held: false, notch: null, rect, flickTimer: 0 };
    const usable = rect.height - THUMB - PAD * 2;
    const fracFromPointer = (clientY) => clamp01((rect.bottom - clientY - PAD - THUMB / 2) / usable);

    const onMove = (ev) => {
      if (ev.pointerId !== drag.pointerId) return;
      if (!drag.held) {
        if (Math.abs(ev.clientY - drag.y) <= DRAG_SLOP) return;
        drag.held = true;
        this._dragState.set(entityId, drag);
        track.classList.add("dragging");
      }
      if (drag.dimmable) {
        drag.finalLevel = Math.round(fracFromPointer(ev.clientY) * 100);
        this._updateDivaRef(ref, entityId, kind, { on: drag.finalLevel > 0, level: drag.finalLevel, thumbFrac: drag.finalLevel / 100 });
        return;
      }
      // Measured from where the press started, so pressing anywhere on the
      // track never flips it by itself.
      const rel = clamp01(drag.startFrac + (drag.y - ev.clientY) / usable);
      const prevNotch = drag.notch == null ? Math.round(drag.startFrac) : drag.notch;
      drag.notch = prevNotch === 1 ? (rel <= 1 - NOTCH_FLICK_AT ? 0 : 1) : rel >= NOTCH_FLICK_AT ? 1 : 0;
      if (drag.notch !== prevNotch) {
        vibrate(8);
        track.classList.add("flick");
        clearTimeout(drag.flickTimer);
        drag.flickTimer = setTimeout(() => track.classList.remove("flick"), FLICK_MS);
      }
      const pull = rel - drag.notch;
      const stretchedFrac = drag.notch + Math.sign(pull) * NOTCH_STRETCH * (1 - Math.exp(-Math.abs(pull) * NOTCH_STIFFNESS));
      this._updateDivaRef(ref, entityId, kind, { on: drag.notch === 1, level: drag.notch === 1 ? 100 : 0, thumbFrac: stretchedFrac });
    };

    const finish = (ev, commit) => {
      if (ev.pointerId !== drag.pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      try { track.releasePointerCapture(drag.pointerId); } catch (_) {}
      clearTimeout(drag.flickTimer);
      track.classList.remove("flick", "dragging");
      this._dragState.delete(entityId);

      if (commit && drag.held && drag.dimmable) {
        const pct = drag.finalLevel;
        if (kind === "cover") {
          if (pct <= 0) this._call("cover", "close_cover", { entity_id: entityId });
          else if (pct >= 100) this._call("cover", "open_cover", { entity_id: entityId });
          else this._call("cover", "set_cover_position", { entity_id: entityId, position: pct });
        } else if (pct <= 0) this._call("light", "turn_off", { entity_id: entityId });
        else this._call("light", "turn_on", { entity_id: entityId, brightness_pct: pct });
        return;
      }
      if (commit && drag.held && drag.notch != null) {
        // The thumb settles on its notch right away; HA's state change then
        // confirms it (or snaps it back if the call fails).
        const wantOn = drag.notch === 1;
        this._updateDivaRef(ref, entityId, kind, { on: wantOn, level: wantOn ? 100 : 0 });
        if (wantOn !== on) this._toggleEntity(entityId, kind, wantOn);
        return;
      }
      if (commit && !drag.held) {
        vibrate(8);
        this._toggleEntity(entityId, kind, !on);
        return;
      }
      this._updateDivaRef(ref, entityId, kind);
    };
    const onUp = (ev) => finish(ev, true);
    const onCancel = (ev) => finish(ev, false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  });
}

const WARM_MODES = new Set(["heat", "heat_cool", "auto"]);
const COOL_MODES = new Set(["cool", "dry"]);
const TREND_FROM_MODE = { off: "off", cool: "cooling", auto: "auto", dry: "drying", fan_only: "fan" };
const humanize = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1).replace(/_/g, " ") : v);

// Icons for the free-form fan/swing mode names integrations report
// ("med", "quiet", "static", …); anything unknown gets the generic one.
const FAN_MODE_ICONS = [
  [/^(auto|automatic)/, "mdi:fan-auto"],
  [/^(off)$/, "mdi:fan-off"],
  [/^(quiet|silent|sleep|night)/, "mdi:weather-night"],
  [/^(low|min)/, "mdi:fan-speed-1"],
  [/^(med|mid)/, "mdi:fan-speed-2"],
  [/^(high|max|turbo|strong)/, "mdi:fan-speed-3"],
];
export function fanModeIcon(mode) {
  const m = String(mode ?? "").toLowerCase();
  return FAN_MODE_ICONS.find(([re]) => re.test(m))?.[1] || "mdi:fan";
}

export function swingModeIcon(mode) {
  const m = String(mode ?? "").toLowerCase();
  if (/^(off|static|stop|stopped|fixed|none)$/.test(m)) return "mdi:arrow-oscillating-off";
  if (m === "vertical") return "mdi:arrow-up-down";
  if (m === "horizontal") return "mdi:arrow-left-right";
  return "mdi:arrow-oscillating";
}

// What the climate card shows, from the entity's state alone. `lastMode` is
// the hvac mode it was in before being switched off, so the power button can
// bring it back.
export function climateView(st, lastMode) {
  const attrs = st.attributes || {};
  const mode = st.state;
  const off = mode === "off";
  const hvacModes = Array.isArray(attrs.hvac_modes) ? attrs.hvac_modes : [];
  const activeModes = hvacModes.filter((m) => m !== "off");
  const cur = attrs.current_temperature;
  const tgt = attrs.temperature;
  const decimals = Number.isInteger(Number(attrs.target_temp_step) || 0.5) ? 0 : 1;
  const fmt = (v) => String(+(+v).toFixed(decimals));
  let target = "—";
  if (tgt != null) target = `${fmt(tgt)}°`;
  else if (attrs.target_temp_low != null && attrs.target_temp_high != null) target = `${fmt(attrs.target_temp_low)}–${fmt(attrs.target_temp_high)}°`;
  const trend = attrs.hvac_action || TREND_FROM_MODE[mode] || (cur != null && tgt != null && cur < tgt ? "heating" : "idle");
  const shownMode = off ? (activeModes.includes(lastMode) ? lastMode : activeModes[0]) : mode;
  const modeIcon = (m) => CLIMATE_ICONS[m] || ICONS.thermo;
  const dropdowns = [
    { key: "mode", label: "Mode", icon: modeIcon(shownMode), value: shownMode, options: activeModes, labelFor: (m) => CLIMATE_LABELS[m] || humanize(m), iconFor: modeIcon },
  ];
  if (Array.isArray(attrs.fan_modes) && attrs.fan_modes.length) dropdowns.push({ key: "fan", label: "Fan mode", icon: fanModeIcon(attrs.fan_mode), value: attrs.fan_mode, options: attrs.fan_modes, labelFor: humanize, iconFor: fanModeIcon });
  if (Array.isArray(attrs.swing_modes) && attrs.swing_modes.length) dropdowns.push({ key: "swing", label: "Swing mode", icon: swingModeIcon(attrs.swing_mode), value: attrs.swing_mode, options: attrs.swing_modes, labelFor: humanize, iconFor: swingModeIcon });
  return {
    off,
    tone: off ? "neutral" : WARM_MODES.has(mode) ? "warm" : COOL_MODES.has(mode) ? "cool" : "neutral",
    now: cur != null ? `Now ${cur}° · ${humanize(trend).toLowerCase()}` : humanize(trend),
    target,
    canAdjust: tgt != null && !off,
    // Single-mode thermostats show no mode chips or power button.
    hasControls: hvacModes.length > 1,
    turnOnMode: shownMode,
    dropdowns,
  };
}

export function _updateClimateRef(ref, entityId) {
  const st = this._hass.states?.[entityId];
  if (!st) return;
  if (st.state !== "off") this._lastClimateMode.set(entityId, st.state);
  const v = climateView(st, this._lastClimateMode.get(entityId));
  ref.card.classList.toggle("off", v.off);
  for (const tone of ["warm", "cool", "neutral"]) ref.card.classList.toggle(`tone-${tone}`, v.tone === tone);
  ref.now.textContent = v.now;
  ref.target.textContent = v.target;
  ref.minus.disabled = ref.plus.disabled = !v.canAdjust;
  ref.controls.hidden = !v.hasControls;
  if (!v.hasControls) return;
  ref.power.classList.toggle("on", !v.off);
  ref.power.setAttribute("aria-pressed", String(!v.off));
  ref.power.setAttribute("aria-label", `Turn ${ref.displayName} ${v.off ? "on" : "off"}`);
  ref.turnOnMode = v.turnOnMode;
  for (const dd of v.dropdowns) {
    const slot = ref.dropdowns.get(dd.key);
    if (!slot) continue;
    setIcon(slot.icon, dd.icon);
    slot.value.textContent = dd.labelFor(dd.value) ?? "—";
    slot.btn.setAttribute("aria-label", `${dd.label}: ${slot.value.textContent}`);
    slot.options = dd.options;
    slot.current = dd.value;
    slot.labelFor = dd.labelFor;
    slot.iconFor = dd.iconFor;
  }
}

export function _updateInputSelectRef(ref, entityId) {
  const st = this._hass.states?.[entityId];
  if (!st) return;
  const current = st.state === "unavailable" || st.state === "unknown" ? null : st.state;
  for (const [option, chip] of ref.chips) {
    chip.classList.toggle("sel", option === current);
    chip.setAttribute("aria-pressed", String(option === current));
  }
}

// media_player supported_features bits (homeassistant.components.media_player).
const MP = { PAUSE: 1, VOLUME_SET: 4, VOLUME_MUTE: 8, PREVIOUS: 16, NEXT: 32, TURN_ON: 128, TURN_OFF: 256, PLAY: 16384 };
const MEDIA_STATE_LABEL = { playing: "Playing", paused: "Paused", idle: "Idle", on: "On", off: "Off", standby: "Standby", buffering: "Buffering", unavailable: "Unavailable" };

// What the media card shows, from the player's state alone. An entity that
// doesn't report supported_features (some dev/test fixtures) gets every control.
export function mediaView(st) {
  const a = st.attributes || {};
  const f = a.supported_features;
  const has = (bit) => f == null || (Number(f) & bit) === bit;
  const off = st.state === "off" || st.state === "standby" || st.state === "unavailable";
  const playing = st.state === "playing" || st.state === "buffering";
  const title = a.media_title || (off ? null : a.app_name || a.source) || null;
  const subtitle = [a.media_artist || a.media_series_title, a.media_album_name].filter(Boolean).join(" · ") || null;
  return {
    off,
    playing,
    title: title || MEDIA_STATE_LABEL[st.state] || st.state,
    subtitle: title ? subtitle || MEDIA_STATE_LABEL[st.state] || null : null,
    artwork: off ? null : a.entity_picture || null,
    canPower: off ? has(MP.TURN_ON) && st.state !== "unavailable" : f != null && has(MP.TURN_OFF),
    canPlayPause: !off && (has(MP.PAUSE) || has(MP.PLAY)),
    canPrev: !off && has(MP.PREVIOUS),
    canNext: !off && has(MP.NEXT),
    canVolume: !off && has(MP.VOLUME_SET) && a.volume_level != null,
    canMute: !off && has(MP.VOLUME_MUTE),
    volume: Math.round((Number(a.volume_level) || 0) * 100),
    muted: !!a.is_volume_muted,
  };
}

export function _updateMediaRef(ref, entityId) {
  const st = this._hass.states?.[entityId];
  if (!st) return;
  const v = mediaView(st);
  ref.card.classList.toggle("off", v.off);
  ref.card.classList.toggle("playing", v.playing);
  ref.title.textContent = v.title;
  ref.subtitle.textContent = v.subtitle || "";
  ref.subtitle.hidden = !v.subtitle;
  if (ref.artworkUrl !== v.artwork) {
    ref.artworkUrl = v.artwork;
    ref.art.style.backgroundImage = v.artwork ? `url("${v.artwork}")` : "";
    ref.art.classList.toggle("has-img", !!v.artwork);
  }
  ref.power.hidden = !v.canPower;
  ref.power.setAttribute("aria-label", `Turn ${ref.displayName} ${v.off ? "on" : "off"}`);
  ref.prev.hidden = !v.canPrev;
  ref.next.hidden = !v.canNext;
  ref.playPause.hidden = !v.canPlayPause;
  setIcon(ref.playPause.firstElementChild, v.playing ? "mdi:pause" : "mdi:play");
  ref.playPause.setAttribute("aria-label", `${v.playing ? "Pause" : "Play"} ${ref.displayName}`);
  ref.volumeRow.hidden = !v.canVolume && !v.canMute;
  ref.mute.hidden = !v.canMute;
  setIcon(ref.mute.firstElementChild, v.muted ? "mdi:volume-off" : "mdi:volume-high");
  ref.mute.setAttribute("aria-pressed", String(v.muted));
  ref.volume.hidden = !v.canVolume;
  // Leave the slider alone while it's being dragged; HA's echo catches up after.
  if (!ref.volumeDragging) ref.volume.value = String(v.volume);
  ref.volume.style.setProperty("--v", `${v.volume}%`);
}

export function _updateSensorRef(ref) {
  const st = this._hass.states?.[ref.entityId];
  ref.value.textContent = fmtSensorValue(st);
  setIcon(ref.icon, iconForSensor(st));
  const tone = sensorTone(st);
  for (const t of ["alert", "warn", "info"]) ref.tile.classList.toggle(`t-${t}`, tone === t);
}

export function _updateAutomationRef(ref, entityId) {
  const hass = this._hass;
  const st = hass.states?.[entityId];
  if (!st) return;
  const enabled = ref.isScript ? true : st.state !== "off";
  const flashing = ref.flashUntil > Date.now();
  ref.row.classList.toggle("off", !enabled);
  if (ref.swatch.tagName === "BUTTON") ref.swatch.setAttribute("aria-pressed", String(enabled));
  const lastTs = st.attributes?.last_triggered;
  const when = lastTs ? fmtTimeAgoLong(lastTs) : "never";
  if (flashing) ref.sub.textContent = ref.isScript ? "Running…" : "Triggered just now";
  else if (ref.isScript) ref.sub.textContent = `Script · ${lastTs ? when : "never run"}`;
  else ref.sub.textContent = `${enabled ? "On" : "Off"} · ${when}`;

  const labels = (hass.entities[entityId]?.labels || []).map((lid) => labelDescriptor(hass, lid)).filter(Boolean);
  const labelsKey = labels.map((d) => `${d.name}|${d.icon}|${d.color}`).join(";");
  if (ref.labelsKey !== labelsKey) this._renderAutomationLabels(ref, labels, labelsKey);
  ref.play.classList.toggle("disabled", !enabled);
  ref.play.classList.toggle("flash", flashing);
}

export function _renderAutomationLabels(ref, labels, labelsKey) {
  ref.labelsKey = labelsKey;
  ref.labels.innerHTML = "";
  for (const desc of labels) {
    const chip = document.createElement("span");
    chip.className = "atrium-auto-label";
    chip.style.color = desc.color;
    chip.style.background = tint(desc.color, 16);
    chip.innerHTML = `${haIcon(desc.icon || "mdi:star-outline", 11)}<span></span>`;
    chip.lastChild.textContent = desc.name;
    ref.labels.appendChild(chip);
  }
}
