// A vertical-stack with the dashboard's side and bottom gutter. Views are
// `panel: true` (full width, no padding), so a custom tab's own cards would
// otherwise touch the screen edges; this lines them up with atrium-header's
// content, which sits 18px in (see .atrium-shell-header-top in shell.css).
const GUTTER = "0 18px 18px";

class AtriumPaddedStack extends HTMLElement {
  setConfig(config) {
    if (!Array.isArray(config.cards)) throw new Error("cards is required");
    this._config = config;
    this._build();
  }

  connectedCallback() {
    this.style.display = "block";
    this.style.padding = GUTTER;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._card) this._card.hass = hass;
  }

  // HA's own card factory, so every card type (built-in or custom) renders
  // exactly as it would in a plain vertical-stack.
  async _build() {
    const token = (this._buildToken = {});
    const helpers = await window.loadCardHelpers?.();
    if (!helpers || token !== this._buildToken) return;
    const card = helpers.createCardElement({ type: "vertical-stack", cards: this._config.cards });
    if (this._hass) card.hass = this._hass;
    this._card = card;
    this.replaceChildren(card);
  }

  getCardSize() {
    return this._card?.getCardSize?.() ?? this._config?.cards.length ?? 1;
  }
}

customElements.define("atrium-padded-stack", AtriumPaddedStack);
