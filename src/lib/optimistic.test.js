import test from "node:test";
import assert from "node:assert/strict";
import { Optimistic } from "./optimistic.js";

test("Optimistic: shows the asked value until HA's state matches it", () => {
  const o = new Optimistic({ ttl: 5000 });
  o.set("light.a", { on: true, level: 70 });
  const matches = (real) => (v) => v.on === real.on && Math.abs(v.level - real.level) <= 2;
  assert.deepEqual(o.get("light.a", matches({ on: true, level: 35 })), { on: true, level: 70 }); // still fading
  assert.equal(o.get("light.a", matches({ on: true, level: 69 })), undefined); // caught up
  assert.equal(o.get("light.a", matches({ on: true, level: 35 })), undefined); // gone for good
  o.clear();
});

test("Optimistic: gives up after its delay, then the real state shows", () => {
  let t = 1000;
  const o = new Optimistic({ ttl: 5000, now: () => t });
  o.set("cover.a", 40);
  t += 4999;
  assert.equal(o.get("cover.a"), 40);
  t += 1;
  assert.equal(o.get("cover.a"), undefined);
  o.clear();
});

test("Optimistic: a newer value replaces the older one and restarts its delay", () => {
  let t = 0;
  const o = new Optimistic({ ttl: 5000, now: () => t });
  o.set("climate.a:temperature", 21);
  t = 3000;
  o.set("climate.a:temperature", 21.5);
  t = 7000;
  assert.equal(o.get("climate.a:temperature"), 21.5);
  o.clear();
});
