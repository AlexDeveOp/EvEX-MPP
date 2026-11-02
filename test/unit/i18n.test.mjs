import { test } from "node:test";
import assert from "node:assert/strict";
import { t, resolveLang } from "../../src/renderer/js/i18n.js";
import * as main from "../../src/main/i18n.js";
import en from "../../src/renderer/locales/en.js";

test("t sustituye variables y deja intactas las que no recibe", () => {
  assert.equal(t("hace {n} min", { n: 5 }), "hace 5 min");
  assert.equal(t("hace {n} min"), "hace {n} min");
});

test("resolveLang acepta los idiomas conocidos y si no sigue al sistema", () => {
  assert.equal(resolveLang("es"), "es");
  assert.equal(resolveLang("en"), "en");
  assert.ok(["es", "en"].includes(resolveLang("auto")));
});

test("el proceso principal traduce al inglés con el mismo diccionario", () => {
  assert.equal(main.setLanguage("en"), "en");
  assert.equal(main.t("Ayer"), en["Ayer"]);
  assert.equal(main.t("hace {n} min", { n: 3 }), en["hace {n} min"].replace("{n}", "3"));
  assert.equal(main.t("Texto que no existe"), "Texto que no existe");
  assert.equal(main.setLanguage("es"), "es");
  assert.equal(main.t("Ayer"), "Ayer");
});

test("cada traducción conserva las mismas {variables} que el original", () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  const bad = Object.entries(en).filter(([es, tr]) => vars(es) !== vars(tr));
  assert.deepEqual(bad, []);
});
