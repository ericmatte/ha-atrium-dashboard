// header.js is a custom element with no direct exports (it only calls
// customElements.define at the bottom). Stub the browser globals it touches
// at import time (HTMLElement, customElements) so the module graph can load
// under plain Node, then grab the registered class out of the
// customElements.define() call.
import test from "node:test";
import assert from "node:assert/strict";
import "../../tools/register.mjs";

globalThis.HTMLElement = class {};
globalThis.window = globalThis;
let registered;
globalThis.customElements = { define: (_tag, cls) => { registered = cls; } };

await import("./header.js");
const AtriumHeader = registered;

function makeHeader() {
  return Object.create(AtriumHeader.prototype);
}

test("_welcomeTitle: falls back to 'dev' when __ATRIUM_VERSION__ isn't inlined (unbundled/test run)", () => {
  delete globalThis.__ATRIUM_VERSION__;
  const header = makeHeader();
  assert.equal(header._welcomeTitle(), "Atrium vdev");
});

test("_welcomeTitle: uses __ATRIUM_VERSION__ when esbuild has inlined it (bundled dist)", () => {
  globalThis.__ATRIUM_VERSION__ = "9.9.9";
  const header = makeHeader();
  assert.equal(header._welcomeTitle(), "Atrium v9.9.9");
  delete globalThis.__ATRIUM_VERSION__;
});
