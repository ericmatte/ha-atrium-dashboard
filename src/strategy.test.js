// strategy.js registers a custom element with no direct exports; it also
// cascade-imports every other custom element in the dashboard (rooms-view,
// header) purely to register them, none of which are exercised by
// generate() itself. Stub the browser globals they all touch at import time
// (HTMLElement, customElements) so the whole module graph loads under plain
// Node, then grab the registered strategy class out of the
// customElements.define() call.
import test from "node:test";
import assert from "node:assert/strict";
import "../tools/register.mjs";

globalThis.HTMLElement = class {};
globalThis.window = globalThis;
let registered;
globalThis.customElements = { define: (_tag, cls) => { registered = cls; } };

await import("./strategy.js");
const AtriumStrategy = registered;

const hass = { floors: {}, areas: {}, user: { name: "Eric" } };

test("generate: with no cfg.tabs, ships zero custom tabs", async () => {
  const result = await AtriumStrategy.generate({}, hass);
  assert.deepEqual(
    result.views.map((v) => v.path),
    ["home"]
  );
});

test("generate: cfg.tabs are appended in order, after home", async () => {
  const cfg = {
    tabs: [
      { title: "Energy", icon: "mdi:lightning-bolt" },
      { title: "Maintenance", icon: "mdi:wrench" },
    ],
  };
  const result = await AtriumStrategy.generate(cfg, hass);
  assert.deepEqual(
    result.views.map((v) => v.path),
    ["home", "energy", "maintenance"]
  );
});

test("generate: Home ships one atrium-rooms card with every floor, real and virtual", async () => {
  const hassWithFloor = {
    floors: { main: { floor_id: "main", name: "Main", level: 0 } },
    areas: { garden: { area_id: "garden", floor_id: null, name: "Garden" } },
    user: { name: "Eric" },
  };
  const result = await AtriumStrategy.generate({}, hassWithFloor);
  const home = result.views.find((v) => v.path === "home");
  const roomsCards = home.cards[0].cards.filter((c) => c.type === "custom:atrium-rooms");
  assert.equal(roomsCards.length, 1);
  assert.deepEqual(
    roomsCards[0].floors.map((f) => f.floor_id),
    ["main", null]
  );
});

test("generate: a custom tab uses its title/icon, or falls back to a slugified path", async () => {
  const cfg = { tabs: [{ title: "Weird Name!" }] };
  const result = await AtriumStrategy.generate(cfg, hass);
  const tab = result.views.at(-1);
  assert.equal(tab.title, "Weird Name!");
  assert.equal(tab.path, "weird-name");
  assert.equal(tab.icon, "mdi:view-dashboard");
});

test("generate: a custom tab honors an explicit path override", async () => {
  const cfg = { tabs: [{ title: "Energy", path: "power" }] };
  const result = await AtriumStrategy.generate(cfg, hass);
  assert.equal(result.views.at(-1).path, "power");
});

test("generate: a custom tab's entities card uses entities_title, falling back to title", async () => {
  const cfg = {
    tabs: [
      { title: "Maintenance", entities: ["sensor.cpu"], entities_title: "System" },
      { title: "Energy", entities: ["sensor.power"] },
    ],
  };
  const result = await AtriumStrategy.generate(cfg, hass);
  const [maintenance, energy] = result.views.slice(-2);
  const maintenanceEntitiesCard = maintenance.cards[0].cards[1].cards[0];
  const energyEntitiesCard = energy.cards[0].cards[1].cards[0];
  assert.equal(maintenanceEntitiesCard.title, "System");
  assert.equal(energyEntitiesCard.title, "Energy");
});

test("generate: a custom tab's cards sit in a padded stack under the header, aligned with it", async () => {
  const cfg = { tabs: [{ title: "Energy", entities: ["sensor.power"], cards: [{ type: "markdown", content: "hi" }] }] };
  const result = await AtriumStrategy.generate(cfg, hass);
  const [header, body] = result.views.at(-1).cards[0].cards;
  assert.equal(header.type, "custom:atrium-header");
  assert.equal(body.type, "custom:atrium-padded-stack");
  assert.deepEqual(body.cards.map((c) => c.type), ["entities", "markdown"]);
});
