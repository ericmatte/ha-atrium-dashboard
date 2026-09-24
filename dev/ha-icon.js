// Standalone `<ha-icon>` replacement for local dev. The real element ships
// with Home Assistant's frontend; outside HA it's an undefined custom
// element, so icons just wouldn't render. This wraps Iconify's
// `<iconify-icon>` (same "mdi:name" identifiers HA uses) so every card looks
// like it does in production. All Atrium code only ever sets the `icon`
// attribute (never a `.icon` property), so an attribute observer is enough.
class HaIconPolyfill extends HTMLElement {
  static get observedAttributes() {
    return ["icon"];
  }

  connectedCallback() {
    if (this._built) {
      this._sync();
      return;
    }
    this._built = true;
    this.style.display = "inline-flex";
    this.style.alignItems = "center";
    this.style.justifyContent = "center";
    this.style.width = "var(--mdc-icon-size, 24px)";
    this.style.height = "var(--mdc-icon-size, 24px)";
    this.style.flexShrink = "0";
    this._inner = document.createElement("iconify-icon");
    // iconify-icon draws its internal <svg> at 1em×1em — width/height:100%
    // on the host does NOT resize that svg, it only sizes the custom
    // element's own layout box, leaving the (default 16px) glyph stranded
    // top-left inside it. font-size is what iconify actually scales by.
    this._inner.style.fontSize = "var(--mdc-icon-size, 24px)";
    this.appendChild(this._inner);
    this._sync();
  }

  attributeChangedCallback() {
    if (this._built) this._sync();
  }

  _sync() {
    this._inner.setAttribute("icon", this.getAttribute("icon") || "mdi:help-circle-outline");
  }
}

if (!customElements.get("ha-icon")) {
  customElements.define("ha-icon", HaIconPolyfill);
}
