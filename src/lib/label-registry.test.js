import test from "node:test";
import assert from "node:assert/strict";

const { getLabel, subscribeLabelsLoaded, _resetForTests } = await import("./label-registry.js");

test("getLabel reads straight from hass.labels when HA already populated it", () => {
  _resetForTests();
  const hass = { labels: { important: { label_id: "important", name: "Important" } } };
  assert.equal(getLabel(hass, "important").name, "Important");
});

test("getLabel returns null and never calls callWS when hass.labels is missing and there's no way to fetch it", () => {
  _resetForTests();
  const hass = {};
  assert.equal(getLabel(hass, "important"), null);
});

// Reproduces the real-world bug: hass.entities[id].labels is populated (the
// entity really has the label) but hass.labels — the registry itself — is
// undefined, which is what a plain `hass.labels?.[labelId]` lookup can't
// recover from.
test("getLabel falls back to a fetched registry when hass.labels is undefined", async () => {
  _resetForTests();
  let calls = 0;
  const hass = {
    callWS: async (msg) => {
      calls += 1;
      assert.deepEqual(msg, { type: "config/label_registry/list" });
      return [{ label_id: "important", name: "Important", icon: "mdi:star", color: "amber" }];
    },
  };

  assert.equal(getLabel(hass, "important"), null); // not loaded yet, fetch kicked off
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(getLabel(hass, "important").name, "Important");
  assert.equal(calls, 1);
});

test("getLabel only fetches once even when called repeatedly while the request is in flight", async () => {
  _resetForTests();
  let calls = 0;
  let resolveFetch;
  const hass = {
    callWS: () =>
      new Promise((resolve) => {
        calls += 1;
        resolveFetch = () => resolve([{ label_id: "important", name: "Important" }]);
      }),
  };

  getLabel(hass, "important");
  getLabel(hass, "important");
  getLabel(hass, "important");
  assert.equal(calls, 1);

  resolveFetch();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getLabel(hass, "important").name, "Important");
});

test("subscribeLabelsLoaded fires once the fallback fetch resolves, and unsubscribe stops it", async () => {
  _resetForTests();
  let resolveFetch;
  const hass = {
    callWS: () => new Promise((resolve) => { resolveFetch = () => resolve([]); }),
  };

  let fired = 0;
  const unsub = subscribeLabelsLoaded(() => { fired += 1; });

  getLabel(hass, "important");
  resolveFetch();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fired, 1);

  unsub();
  _resetForTests();
  const hass2 = { callWS: async () => [] };
  getLabel(hass2, "important");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fired, 1); // unsubscribed, no further increment
});
