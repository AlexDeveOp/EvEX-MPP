// Los errores de las flotas y del .ics que llegan a un aviso salen en el idioma de la interfaz.
// El idioma se fija al cargar i18n.js y cada fichero de test va en su propio proceso: aquí se pone el inglés antes de
// importar nada (por eso los import son dinámicos).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { TEST_SETTINGS } from "./helpers.mjs";

let S, F, ics, currentLang;
before(async () => {
  localStorage.setItem("evex.lang", "en");
  ({ currentLang } = await import("../../src/renderer/js/i18n.js"));
  ({ S } = await import("../../src/renderer/js/state.js"));
  F = await import("../../src/renderer/js/fleets.js");
  ics = await import("../../src/renderer/js/ics.js");
  globalThis.window.evex = { call: async () => {} };
  S.settings = structuredClone(TEST_SETTINGS);
  delete S.settings.fleets;
  F._resetFleetsForTests();
});

test("la interfaz está en inglés en este test", () => {
  assert.equal(currentLang(), "en");
});

test("flota con hora rota: «Invalid fleet time» al añadirla o al cambiarla", () => {
  assert.throws(() => F.addFleet({ at: "mañana", title: "Roam" }), { message: "Invalid fleet time" });
  const ok = F.addFleet({ at: Date.UTC(2026, 10, 7, 19), title: "Roam" });
  assert.throws(() => F.updateFleet(ok.id, { at: Number.NaN }), { message: "Invalid fleet time" });
});

test("errores del .ics traducidos: fecha no válida y evento sin UID", () => {
  assert.throws(() => ics.formatUtc("no es fecha"), { message: "Invalid date in the calendar" });
  assert.throws(() => ics.eventLines({ start: Date.UTC(2026, 10, 7, 19) }), { message: "A calendar event is missing its identifier (UID)" });
});
