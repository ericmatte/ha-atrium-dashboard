import test from "node:test";
import assert from "node:assert/strict";
import { t, setLanguage, getLanguage, relativeAge, shortAge } from "./i18n.js";

test("i18n: English by default; fr, fr-CA and FR switch to French; unknown falls back to English", () => {
  setLanguage(undefined);
  assert.equal(getLanguage(), "en");
  assert.equal(t("routines"), "Routines");
  for (const v of ["fr", "fr-CA", "FR"]) {
    setLanguage(v);
    assert.equal(getLanguage(), "fr");
  }
  assert.equal(t("holdToTrigger"), "Maintenir pour déclencher");
  assert.equal(t("inactiveForAWeek", 2), "2 inactives depuis plus d'une semaine");
  setLanguage("de");
  assert.equal(getLanguage(), "en");
});

test("i18n: every English key has a French counterpart", async () => {
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("./i18n.js", import.meta.url), "utf8"));
  const keys = (block) => [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
  const en = keys(src.slice(src.indexOf("const EN = {"), src.indexOf("const FR = {")));
  const fr = new Set(keys(src.slice(src.indexOf("const FR = {"), src.indexOf("const STRINGS"))));
  assert.deepEqual(en.filter((k) => !fr.has(k)), []);
});

test("i18n: relative and short ages follow the language", () => {
  setLanguage("en");
  assert.equal(relativeAge(30), "just now");
  assert.equal(relativeAge(5 * 60), "5 minutes ago");
  assert.equal(shortAge(13 * 60), "13m");
  setLanguage("fr");
  assert.equal(relativeAge(5 * 60), "il y a 5 minutes");
  assert.equal(relativeAge(3 * 3600), "il y a 3 heures");
  assert.equal(shortAge(2 * 3600), "2 h");
  setLanguage("en");
});
