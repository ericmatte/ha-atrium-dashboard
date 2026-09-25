// Run: node --test www/atrium/lib/dom-utils.test.js
import test from "node:test";
import assert from "node:assert/strict";

const { tint, injectStyleOnce } = await import("./dom-utils.js");

test("tint builds a color-mix string with the given percentage", () => {
  assert.equal(tint("red", 16), "color-mix(in srgb, red 16%, transparent)");
  assert.equal(tint("var(--x)"), "color-mix(in srgb, var(--x) 12%, transparent)");
});

test("injectStyleOnce appends a keyed <style> exactly once", () => {
  const appended = [];
  const byId = {};
  globalThis.document = {
    getElementById: (id) => byId[id] || null,
    createElement: () => ({ id: "", textContent: "" }),
    head: { appendChild: (node) => { appended.push(node); byId[node.id] = node; } },
  };
  injectStyleOnce("dup-style", "a{}");
  injectStyleOnce("dup-style", "a{}");
  assert.equal(appended.length, 1);
  assert.equal(appended[0].textContent, "a{}");
  delete globalThis.document;
});

test("setIcon: only touches the attribute when the icon changes", async () => {
  const { setIcon } = await import("./dom-utils.js");
  let writes = 0;
  const el = { attrs: {}, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { writes++; this.attrs[k] = v; } };
  setIcon(el, "mdi:play");
  setIcon(el, "mdi:play");
  setIcon(el, "mdi:pause");
  assert.equal(writes, 2);
});

test("automationEditorPath: the editor for admins when the automation has an id, else null", async () => {
  const { automationEditorPath } = await import("./dom-utils.js");
  const hass = (isAdmin, id) => ({ user: { is_admin: isAdmin }, states: { "automation.a": { attributes: id == null ? {} : { id } } } });
  assert.equal(automationEditorPath(hass(true, "1690000000000"), "automation.a"), "/config/automation/edit/1690000000000");
  assert.equal(automationEditorPath(hass(false, "1690000000000"), "automation.a"), null);
  assert.equal(automationEditorPath(hass(true, null), "automation.a"), null);
});
