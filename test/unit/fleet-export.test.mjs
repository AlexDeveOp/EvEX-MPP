// De un ping de flota al .ics, con la API real de fleets.js: mínimo por defecto y, con detalles, FC/formup/doctrina.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { S } from "../../src/renderer/js/state.js";
import { pingsConv } from "../../src/renderer/js/convs.js";
import * as F from "../../src/renderer/js/fleets.js";
import { fleetsCalendar, unfold } from "../../src/renderer/js/ics.js";
import { icsOptions } from "../../src/renderer/js/fleet-export.js";
import { TEST_SETTINGS } from "./helpers.mjs";

globalThis.window.evex = { call: async () => {} };
const NL = String.fromCharCode(10);
const ZW = String.fromCharCode(0x200b);
const utc = (d, h, m) => Date.UTC(2026, 10, d, h, m);
const ping = (key, ts, title, extra = [], to = "all") => ({ key, ts, nick: "pingbot", body: [title, `FC Name:${ZW} Ejemplo FC`, ...extra, "", `~~~ This was a coord broadcast from bob to ${to} at 2026-11-03 12:00:00.000000 EVE ~~~`].join(NL) });

beforeEach(() => {
  S.settings = structuredClone(TEST_SETTINGS);
  delete S.settings.fleets;
  pingsConv().messages.length = 0;
  F._resetFleetsForTests();
});

test("un ping → flota → .ics mínimo: «Fleet (caps)», la hora del formup en UTC y nada más", () => {
  pingsConv().messages.push(ping("a", utc(3, 12, 0), "Capital fleet up", ["Formup Time: 19:00", "Formup Location: 1DQ1-A", "Doctrine: Typhoons"], "caps"));
  const ics = unfold(fleetsCalendar(F.allFleets(), { ...icsOptions({ details: false, includeLink: false, alarm: 0 }), dtstamp: utc(3, 12, 1) }));
  assert.ok(ics.includes("UID:p-a@evex-mpp\r\n"));
  assert.ok(ics.includes("SUMMARY:Fleet (caps)\r\n"));
  assert.ok(ics.includes("DTSTART:20261103T190000Z\r\n"));
  for (const leak of ["Capital", "Ejemplo FC", "1DQ1-A", "Typhoons", "DESCRIPTION", "LOCATION", "VALARM"]) assert.ok(!ics.includes(leak), `no debe salir «${leak}»`);
});

test("con detalles: título, FC, formup y doctrina del ping (sin invisibles), el formup como lugar y la alarma", () => {
  pingsConv().messages.push(ping("a", utc(3, 12, 0), "Capital fleet up", ["Formup Time: 19:00", "Formup Location: 1DQ1-A", "Doctrine: Typhoons"], "caps"));
  const [fleet] = F.allFleets();
  assert.equal(F.fleetDetails(fleet).fc, `${ZW} Ejemplo FC`.trim(), "fleetDetails los da tal cual");
  const ics = unfold(fleetsCalendar([fleet], { ...icsOptions({ details: true, includeLink: false, alarm: 30 }), dtstamp: utc(3, 12, 1) }));
  assert.ok(ics.includes("SUMMARY:Fleet (caps): Capital fleet up\r\n"));
  assert.ok(ics.includes("DESCRIPTION:FC: Ejemplo FC\\nFormup: 1DQ1-A\\nDoctrine: Typhoons\r\n"), "sin el carácter invisible");
  assert.ok(ics.includes("LOCATION:1DQ1-A\r\n"));
  assert.ok(ics.includes("TRIGGER:-PT30M\r\n"));
  assert.ok(!ics.includes(ZW));
});

test("las flotas descartadas o pendientes no se exportan", () => {
  pingsConv().messages.push(ping("a", utc(3, 12, 0), "Capital fleet up", ["Formup Time: 19:00"]), ping("b", utc(3, 12, 30), "Roam", ["Formup Time: 20:00"]));
  F.dismissFleet("p-b");
  const ics = fleetsCalendar(F.allFleets({ includeDismissed: true }), icsOptions({ details: false, includeLink: false, alarm: 0 }));
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 1);
  assert.ok(ics.includes("UID:p-a@evex-mpp"));
});
