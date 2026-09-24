import { haIcon, tint, vibrate } from "../lib/dom-utils.js";
import {
  TONE, ICONS,
  CLIMATE_ACCENT, CLIMATE_LABELS, CLIMATE_ICONS,
  canDimLight, fmtBrightnessPct, fmtCoverPct, fmtTimeAgoShort, fmtTimeAgoLong,
  lightRgbTriple,
  labelDescriptor,
} from "./area-card-shared.js";

// Diva track geometry (px), matching the approved design: a 58×108 track
// around a round 34px icon thumb, 6px of padding top/bottom.
const THUMB = 34;
const PAD = 6;
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

function isDimmableFor(kind, st) {
  return kind === "cover" || (kind === "light" && canDimLight(st));
}

function accentFor(kind, st) {
  if (kind === "cover") return TONE.curtain;
  if (kind === "switch") return TONE.good;
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

export function _toggleEntity(entityId, kind, wantOn) {
  if (kind === "light") {
    if (!wantOn) this._call("light", "turn_off", { entity_id: entityId });
    else if (canDimLight(this._hass.states?.[entityId])) this._call("light", "turn_on", { entity_id: entityId, brightness_pct: 100 });
    else this._call("light", "turn_on", { entity_id: entityId });
  } else if (kind === "switch") {
    this._call("switch", wantOn ? "turn_on" : "turn_off", { entity_id: entityId });
  } else if (kind === "cover") {
    this._call("cover", wantOn ? "open_cover" : "close_cover", { entity_id: entityId });
  }
}

// Renders a Diva track from the entity's real current state — called once
// right after building it, and again (via a fresh build) whenever the panel
// re-renders. `frac`/`showPct` can be overridden by the live drag preview in
// `_bindDivaTrack`; absent that, they're derived from `kind`+`entityId`.
export function _updateDivaRef(ref, entityId, kind, override) {
  const st = this._hass.states?.[entityId];
  if (!st) return;
  const unavailable = st.state === "unavailable";
  const { on, level, dimmable } = override ?? onOffAndLevel(kind, unavailable ? { ...st, state: "off" } : st);
  const frac = override?.frac ?? (unavailable ? 0 : on ? (dimmable ? level / 100 : 1) : 0);

  ref.track.classList.toggle("un", unavailable);
  ref.track.classList.toggle("dim", dimmable);
  ref.track.classList.toggle("onoff", !dimmable);
  ref.track.disabled = unavailable;
  ref.track.setAttribute(
    "aria-label",
    kind === "cover"
      ? `${ref.name.textContent}, ${level === 0 ? "closed" : level + "% open"}. Drag to set position, tap to open or close.`
      : `${ref.name.textContent}, ${unavailable ? "unavailable" : on ? (dimmable ? level + "%" : "on") : "off"}.`
  );

  const color = accentFor(kind, st);
  const solid = tint(color, 85);
  const faded = tint(color, 15);
  ref.fill.style.height = `${Math.round(Math.max(0, frac) * 100)}%`;
  ref.fill.style.background = dimmable ? `linear-gradient(to top, ${solid} 0%, ${solid} calc(100% - 22px), ${faded} 100%)` : solid;
  ref.thumb.style.bottom = `calc((100% - ${THUMB + PAD * 2}px) * ${Math.max(0, Math.min(1, frac)).toFixed(4)} + ${PAD}px)`;
  ref.thumb.classList.toggle("on", frac > 0.001);

  const showPct = (override?.showPct ?? (on && dimmable)) && !unavailable;
  ref.pctTop.style.display = ref.pctBottom.style.display = showPct ? "" : "none";
  if (showPct) {
    const label = `${level}%`;
    ref.pctTop.textContent = label;
    ref.pctBottom.textContent = label;
    const pctBelow = Math.max(0, Math.min(1, (level - PCT_SWAP_FROM) / (PCT_SWAP_TO - PCT_SWAP_FROM)));
    ref.pctTop.style.opacity = String(1 - pctBelow);
    ref.pctBottom.style.opacity = String(pctBelow);
  }

  ref.ago.textContent = unavailable
    ? "Unavailable"
    : (on ? (dimmable ? `${level}%` : "On") : "Off") + (st.last_updated ? ` · ${fmtTimeAgoShort(st.last_updated)}` : "");
}

// Pointer physics for one Diva track. Dimmable entities (lights with
// brightness, covers) drop anywhere along the track; on/off-only entities
// (switches, non-dimmable lights) rubber-band toward whichever end the press
// started nearer, and flick to the other end only once pulled 80% of the way
// there (hysteresis both ways) — see the design rationale in memory.
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
    const fracFromPointer = (clientY) => {
      const fromBottom = rect.bottom - clientY - PAD - THUMB / 2;
      return Math.max(0, Math.min(1, fromBottom / usable));
    };

    const onMove = (ev) => {
      if (ev.pointerId !== drag.pointerId) return;
      if (!drag.held) {
        if (Math.abs(ev.clientY - drag.y) <= DRAG_SLOP) return;
        drag.held = true;
        this._dragState.set(entityId, drag);
        track.classList.add("dragging");
      }
      if (drag.dimmable) {
        const raw = fracFromPointer(ev.clientY);
        drag.finalLevel = Math.round(raw * 100);
        this._updateDivaRef(ref, entityId, kind, { on: true, level: drag.finalLevel, dimmable: true, frac: raw, showPct: true });
        return;
      }
      // Measured from where the press started, so pressing anywhere on the
      // track never flips it by itself.
      const rel = Math.max(0, Math.min(1, drag.startFrac + (drag.y - ev.clientY) / usable));
      const prevNotch = drag.notch == null ? Math.round(drag.startFrac) : drag.notch;
      drag.notch = prevNotch === 1 ? (rel <= 1 - NOTCH_FLICK_AT ? 0 : 1) : rel >= NOTCH_FLICK_AT ? 1 : 0;
      if (drag.notch !== prevNotch) {
        track.classList.add("flick");
        clearTimeout(drag.flickTimer);
        drag.flickTimer = setTimeout(() => track.classList.remove("flick"), FLICK_MS);
      }
      const pull = rel - drag.notch;
      const stretchedFrac = drag.notch + Math.sign(pull) * NOTCH_STRETCH * (1 - Math.exp(-Math.abs(pull) * NOTCH_STIFFNESS));
      this._updateDivaRef(ref, entityId, kind, { on: drag.notch === 1, level: drag.notch === 1 ? 100 : 0, dimmable: false, frac: stretchedFrac, showPct: false });
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

      let handled = false;
      if (commit && drag.held) {
        if (drag.dimmable) {
          const pct = drag.finalLevel;
          if (kind === "cover") {
            if (pct <= 0) this._call("cover", "close_cover", { entity_id: entityId });
            else if (pct >= 100) this._call("cover", "open_cover", { entity_id: entityId });
            else this._call("cover", "set_cover_position", { entity_id: entityId, position: pct });
          } else if (pct <= 0) this._call("light", "turn_off", { entity_id: entityId });
          else this._call("light", "turn_on", { entity_id: entityId, brightness_pct: pct });
          handled = true;
        } else if (drag.notch != null) {
          const wantOn = drag.notch === 1;
          if (wantOn !== on) {
            this._toggleEntity(entityId, kind, wantOn);
            handled = true;
          }
        }
      } else if (commit && !drag.held) {
        vibrate(8);
        this._toggleEntity(entityId, kind, !on);
        handled = true;
      }
      if (!handled) this._updateDivaRef(ref, entityId, kind);
    };
    const onUp = (ev) => finish(ev, true);
    const onCancel = (ev) => finish(ev, false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  });
}

export function _updateClimateRef(ref, entityId) {
  const st = this._hass.states?.[entityId];
  if (!st) return;
  const mode = st.state;
  const attrs = st.attributes || {};
  const accent = CLIMATE_ACCENT[mode] || TONE.cool;

  ref.tile.style.background = tint(accent, 10);
  ref.tile.style.borderColor = tint(accent, 28);
  ref.swatch.style.background = accent;
  ref.swatch.innerHTML = haIcon(CLIMATE_ICONS[mode] || ICONS.thermo, 16);

  const cur = attrs.current_temperature;
  const tgt = attrs.temperature;
  const modeLabel = CLIMATE_LABELS[mode] || mode.replace("_", " ");
  ref.meta.textContent = `${modeLabel}${cur != null ? ` · ${cur}°` : ""}`;

  if (tgt != null && mode !== "off" && mode !== "fan_only") {
    const decimals = Number.isInteger(Number(attrs.target_temp_step) || 0.5) ? 0 : 1;
    ref.temp.textContent = `${(+tgt).toFixed(decimals)}°`;
  } else {
    ref.temp.textContent = mode === "off" ? "Off" : "—";
  }

  this._wireClimateMode(ref, entityId, attrs, mode);
}

// Fan/swing/schedule live behind more-info — the inline row only wires up
// the hvac-mode quick picker behind the swatch.
export function _wireClimateMode(ref, entityId, attrs, mode) {
  const hvacModes = Array.isArray(attrs.hvac_modes) ? attrs.hvac_modes : [];
  const isMultiMode = hvacModes.length > 1;

  ref.swatch.dataset.menu = isMultiMode ? "mode" : "";
  if (isMultiMode) {
    ref.modeMenu.setItems(
      hvacModes.map((m) => ({ id: m, label: CLIMATE_LABELS[m] || m, icon: CLIMATE_ICONS[m] })),
      mode,
      (id) => this._call("climate", "set_hvac_mode", { entity_id: entityId, hvac_mode: id }),
    );
  }
}

export function _updateInputSelectRef(ref, entityId) {
  const st = this._hass.states?.[entityId];
  if (!st) return;
  const options = Array.isArray(st.attributes?.options) ? st.attributes.options : [];
  const unavailable = st.state === "unavailable" || st.state === "unknown";
  const current = unavailable ? null : st.state;
  ref.value.textContent = unavailable ? "—" : st.state;
  ref.setItems(
    options.map((opt) => ({
      id: opt,
      label: opt,
      icon: opt === current ? "mdi:check" : "mdi:circle-small",
    })),
    current,
  );
}

export function _updateAutomationRef(ref, entityId) {
  const hass = this._hass;
  const st = hass.states?.[entityId];
  if (!st) return;
  const enabled = ref.isScript ? true : st.state !== "off";
  ref.row.classList.toggle("disabled", !enabled);
  ref.name.classList.toggle("disabled", !enabled);
  if (ref.status) ref.status.textContent = enabled ? "On" : "Off";
  const lastTs = st.attributes?.last_triggered;
  ref.last.textContent = lastTs ? fmtTimeAgoLong(lastTs) : "Never triggered";
  ref.labels.innerHTML = "";
  const ent = hass.entities[entityId];
  const labelIds = ent?.labels || [];
  for (const lid of labelIds) {
    const desc = labelDescriptor(hass, lid);
    if (!desc) continue;
    const chip = document.createElement("span");
    chip.className = "atrium-auto-label";
    chip.style.color = desc.color;
    chip.innerHTML = desc.icon ? `${haIcon(desc.icon, 9)}${desc.name}` : desc.name;
    ref.labels.appendChild(chip);
  }
  ref.play.classList.toggle("disabled", !enabled);
}
