// Guardar el .ics de las flotas: validación en el proceso principal y opciones según Preferencias.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkIcs, safeIcsName, ICS_MAX_BYTES } from "../../src/main/ics-save.js";
import { icsOptions } from "../../src/renderer/js/fleet-export.js";
import { buildCalendar } from "../../src/renderer/js/ics.js";

test("checkIcs: solo calendarios iCalendar de hasta 1 MB", () => {
  const ok = buildCalendar([{ uid: "a@evex-mpp", start: Date.UTC(2026, 10, 5, 21), summary: "Fleet" }]);
  assert.equal(checkIcs(ok), ok);
  assert.throws(() => checkIcs(42), /no es válido/);
  assert.throws(() => checkIcs("hola"), /no es válido/);
  assert.throws(() => checkIcs("BEGIN:VCALENDAR\r\nsin final"), /no es válido/);
  assert.throws(() => checkIcs(`BEGIN:VCALENDAR\r\n${"x".repeat(ICS_MAX_BYTES)}\r\nEND:VCALENDAR\r\n`), /grande/);
});

test("safeIcsName: sin carpetas ni caracteres raros, siempre .ics", () => {
  assert.equal(safeIcsName("fleets-2026-11-05.ics"), "fleets-2026-11-05.ics");
  assert.equal(safeIcsName("../../Windows/System32/evil.ics"), "evil.ics");
  assert.equal(safeIcsName("C:\\Users\\x\\Desktop\\a b?c.exe"), "a_b_c.exe.ics");
  assert.equal(safeIcsName(".hidden"), "hidden.ics");
  assert.equal(safeIcsName(""), "fleets.ics");
  assert.equal(safeIcsName(null), "fleets.ics");
  assert.ok(safeIcsName("x".repeat(300)).length <= 84);
});

test("icsOptions: por defecto lo mínimo; los detalles, el enlace y la alarma según Preferencias", () => {
  const info = () => ({ fc: "Ejemplo FC" });
  assert.deepEqual({ ...icsOptions({ details: false, includeLink: false, alarm: 0 }, info), infoOf: undefined }, { details: false, includeLink: false, alarmMinutes: null, infoOf: undefined });
  const full = icsOptions({ details: true, includeLink: true, alarm: 30 }, info);
  assert.equal(full.details, true);
  assert.equal(full.includeLink, true);
  assert.equal(full.alarmMinutes, 30);
  assert.equal(full.infoOf, info);
});
