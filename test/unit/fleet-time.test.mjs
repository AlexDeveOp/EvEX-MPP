import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFleetTime, parseFieldTime, parseFormup } from "../../src/renderer/js/fleet-time.js";
import { parsePing } from "../../src/renderer/js/pings.js";
import { S } from "../../src/renderer/js/state.js";
import { TEST_SETTINGS } from "./helpers.mjs";

S.settings = structuredClone(TEST_SETTINGS);

// Martes 3 de noviembre de 2026.
const utc = (d, h, m) => Date.UTC(2026, 10, d, h, m);
const NL = String.fromCharCode(10);
const ZW = String.fromCharCode(0x200b);

test("el caso real: ping a las 21:33 EVE con «Tomorrow at 17:15» es el día siguiente a las 17:15", () => {
  const ts = utc(3, 21, 33);
  assert.equal(parseFleetTime("Tomorrow at 17:15 we are forming for the final timer", ts), utc(4, 17, 15));
  const ping = ["Tomorrow at 17:15 we are forming for the final timer", `FC Name:${ZW} Bob`, "Doctrine: Ferox", "", "~~~ This was a coord broadcast from bob to allcaps at 2026-11-03 21:33:00.000000 EVE ~~~"].join(NL);
  assert.equal(parseFormup(parsePing(ping), ts), utc(4, 17, 15));
});

test("today, tonight, tomorrow y los días de la semana", () => {
  const ts = utc(3, 12, 0); // martes
  assert.equal(parseFleetTime("tonight at 22:00", ts), utc(3, 22, 0));
  assert.equal(parseFleetTime("today 18:30 EVE", ts), utc(3, 18, 30));
  assert.equal(parseFleetTime("tmrw 0900 EVE", ts), utc(4, 9, 0));
  assert.equal(parseFleetTime("big op on friday at 21:00, be there", ts), utc(6, 21, 0));
  assert.equal(parseFleetTime("Sat 18:30 roam", ts), utc(7, 18, 30));
  assert.equal(parseFleetTime("tuesday 19:00", ts), utc(3, 19, 0), "el mismo día de la semana, si aún no ha pasado mucho: hoy");
  assert.equal(parseFleetTime("tuesday 01:00", ts), utc(10, 1, 0), "si ya pasó hace más de 6 h: el de la semana que viene");
});

test("«at downtime» es a las 11:00 EVE", () => {
  assert.equal(parseFleetTime("form up at downtime for the timer", utc(3, 8, 0)), utc(3, 11, 0));
  assert.equal(parseFleetTime("after DT tomorrow", utc(3, 8, 0)), utc(4, 11, 0));
  assert.equal(parseFleetTime("we form at downtime", utc(3, 20, 0)), utc(4, 11, 0), "si ya pasó hace más de 6 h, el siguiente");
});

test("en mensajes normales, un número suelto no es una hora (hace falta contexto)", () => {
  const ts = utc(3, 12, 0);
  assert.equal(parseFleetTime("I lost 12:30 worth of isk lol", ts), null);
  assert.equal(parseFleetTime("Doctrine 12:5 bombers, 300 pilots", ts), null);
  assert.equal(parseFleetTime("see you tomorrow", ts), null, "un día sin hora no es una flota");
  assert.equal(parseFleetTime("", ts), null);
  assert.equal(parseFleetTime("fleet at 19:00", 0), null, "sin la hora del mensaje no se calcula");
});

test("la hora del pie (envío del broadcast) no cuenta, y una fecha explícita manda", () => {
  const ts = utc(3, 18, 0);
  assert.equal(parseFleetTime("Capital fleet up now!! ~~~ This was a coord broadcast from bob to all at 2026-11-03 18:00:00.000000 EVE ~~~", ts), null);
  assert.equal(parseFleetTime("Formup at 2026-11-05 19:00", ts), utc(5, 19, 0));
  assert.equal(parseFleetTime("undock in 20 min", ts), ts + 20 * 60e3);
});

test("un campo de hora: la hora del campo y, si no lo dice, el día del resto del ping", () => {
  const ts = utc(3, 21, 33);
  assert.equal(parseFieldTime("17:15", ts, "Tomorrow we form for the final timer"), utc(4, 17, 15));
  assert.equal(parseFieldTime("Jita", ts, "fleet at 19:00"), null, "un campo sin hora no coge la del resto del ping");
  assert.equal(parseFieldTime("friday 19:00", ts, "tomorrow"), utc(6, 19, 0), "el día del campo manda");
});
