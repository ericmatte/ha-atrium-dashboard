import { sameRegistries, areaIdForEntity } from "../lib/hass-utils.js";
import { tint } from "../lib/dom-utils.js";
import { toggleLights } from "../lib/ha-actions.js";
import { SHELL_TONE, SHELL_STYLE } from "../lib/shell.js";

class AtriumFloorLabel extends HTMLElement {
  setConfig(config) {
    if (config.floor === undefined) throw new Error("floor is required");
    this._name = config.name || "";
    this._icon = typeof config.icon === "string" ? config.icon : null;
    // `floor: null` targets areas not assigned to any floor.
    this.floorId = config.floor === null ? null : config.floor;
    this._showControls = config.show_controls !== false;
  }

  connectedCallback() {
    this.style.display = "block";
    this.style.padding = "0 16px";
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  floorLights() {
    const hass = this._hass;
    if (!hass) return [];
    if (sameRegistries(this, "_lightsReg", hass, this.floorId) && this._lightsCache) {
      return this._lightsCache;
    }
    const out = [];
    for (const ent of Object.values(hass.entities)) {
      if (!ent.entity_id?.startsWith("light.")) continue;
      if (ent.hidden) continue;
      const areaId = areaIdForEntity(hass, ent);
      if (!areaId) continue;
      const area = hass.areas?.[areaId];
      if (!area || (area.floor_id ?? null) !== this.floorId) continue;
      out.push(ent.entity_id);
    }
    this._lightsCache = out;
    return out;
  }

  _mount() {
    if (this._mounted) return;
    this.innerHTML = `
      <style>${SHELL_STYLE}</style>
      <div class="atrium-shell-floor-label">
        ${this._icon ? `<ha-icon class="atrium-shell-fl-icon" icon="${this._icon}"></ha-icon>` : ""}
        <span class="atrium-shell-fl-name"></span>
        <div class="atrium-shell-fl-line"></div>
        ${this._showControls ? `
        <div class="atrium-shell-fl-controls">
          <span class="atrium-shell-fl-count"></span>
          <button class="atrium-shell-fl-bulb" type="button" aria-label="Toggle all floor lights">
            <ha-icon icon="mdi:lightbulb"></ha-icon>
          </button>
        </div>
        ` : ""}
      </div>
    `;
    this._nameEl = this.querySelector(".atrium-shell-fl-name");
    this._lineEl = this.querySelector(".atrium-shell-fl-line");
    this._labelEl = this.querySelector(".atrium-shell-floor-label");
    this._nameEl.textContent = this._name;

    if (this._showControls) {
      this._controlsEl = this.querySelector(".atrium-shell-fl-controls");
      this._countEl = this.querySelector(".atrium-shell-fl-count");
      this._btnEl = this.querySelector(".atrium-shell-fl-bulb");
      this._btnEl.addEventListener("click", () => this._toggleAll());
    }
    this._mounted = true;
  }

  _computeVisibleState(lightIds) {
    let onCount = 0;
    for (const id of lightIds) {
      const s = this._hass.states[id];
      if (s?.state === "on") onCount += 1;
    }
    return { onCount, totalCount: lightIds.length, isOn: onCount > 0 };
  }

  _render() {
    this._mount();

    const lightIds = this.floorLights();
    const hasLights = lightIds.length > 0;

    if (!this._showControls) return;

    this._controlsEl.style.display = hasLights ? "" : "none";
    if (!hasLights) return;

    const { onCount, totalCount, isOn } = this._computeVisibleState(lightIds);

    const sig = `${onCount}/${totalCount}|${isOn ? 1 : 0}`;
    if (sig === this._lastRenderSig) return;
    this._lastRenderSig = sig;

    this._countEl.textContent = `${onCount}/${totalCount}`;

    const accent = SHELL_TONE.light;
    this._btnEl.style.background = isOn ? tint(SHELL_TONE.light, 16) : tint(SHELL_TONE.text, 5);
    this._btnEl.style.color = isOn ? accent : SHELL_TONE.textMute;
  }

  _toggleAll() {
    if (!this._hass) return;
    const ids = this.floorLights();
    if (ids.length === 0) return;
    toggleLights(this._hass, ids);
  }

  getCardSize() {
    return 1;
  }
}
customElements.define("atrium-floor-label", AtriumFloorLabel);
