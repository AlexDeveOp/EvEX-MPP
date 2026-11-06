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

test("un campo de hora: la hora y el día salen del propio campo", () => {
  const ts = utc(3, 21, 33);
  assert.equal(parseFieldTime("tomorrow 17:15", ts), utc(4, 17, 15));
  assert.equal(parseFieldTime("Jita", ts), null, "un campo sin hora no es una hora");
  assert.equal(parseFieldTime("friday 19:00", ts), utc(6, 19, 0));
  assert.equal(parseFieldTime("downtime", utc(3, 8, 0)), utc(3, 11, 0), "en un campo de hora, «downtime» vale solo");
});

// Regresiones de la revisión del #66: el día o la fecha de otra línea no mueven el formup.
test("una fecha en otra línea o en una dirección no mueve el formup", () => {
  const ts = utc(3, 12, 0);
  const lines = (...l) => l.join(NL);
  assert.equal(parseFormup(parsePing(lines("Structure timer", "Formup Time: 19:00", "Timer exits: 2026.11.08 23:00")), ts), utc(3, 19, 0));
  assert.equal(parseFormup(parsePing(lines("Big op", "Formup Time: 19:00", "Info: https://news.example.com/2026/11/08/timers")), ts), utc(3, 19, 0));
  assert.equal(parseFleetTime("fleet at 19:00, see https://forum.example.com/2026/11/08/op", ts), utc(3, 19, 0));
});

test("«downtime» suelto no es una flota", () => {
  assert.equal(parseFleetTime("Server downtime is extended today, no ops", utc(3, 8, 0)), null);
  assert.equal(parseFleetTime("we form at downtime", utc(3, 8, 0)), utc(3, 11, 0));
});

test("un día de la semana en otra línea no mueve el formup", () => {
  const ts = utc(3, 12, 0); // martes
  assert.equal(parseFormup(parsePing(["Capital fleet", "Formup Time: 19:00", "Next op: Saturday"].join(NL)), ts), utc(3, 19, 0));
  assert.equal(parseFleetTime(["fleet at 19:00", "Next op: Saturday"].join(NL), ts), utc(3, 19, 0));
  assert.equal(parseFleetTime("Saturday we form at 19:00", ts), utc(7, 19, 0), "pegado a la hora, sí cuenta");
});

// Avisos del mantenimiento diario: no son un formup. Casos genéricos (sin pings reales).
const ping = (lines, to = "all") => parsePing([...lines, "", `~~~ This was a coord broadcast from bob to ${to} at 2026-11-03 08:00:00.000000 EVE ~~~`].join(NL));
test("un aviso de downtime («do not log in», 11:00 EVE) no es un formup", () => {
  const ts = utc(3, 8, 0);
  for (const lines of [
    ["Reminder - DO NOT LOGIN AT DOWNTIME", "Servers go down at 11:00 EVE, stay logged off until they are back"],
    ["Reminder - DO NOT LOGIN AT DOWNTIME"],
    ["Please log off before 11:00 EVE, extended downtime today"],
    ["Maintenance at 11:00 EVE"],
    [`Don't log in at downtime${ZW}`, "11:00 EVE"],
  ]) {
    assert.equal(parseFormup(ping(lines), ts), null, lines.join(" / "));
    assert.equal(parseFleetTime(lines.join(NL), ts), null, lines.join(" / "));
  }
});

test("los pings de flota con «downtime» siguen dando su formup", () => {
  const ts = utc(3, 8, 0);
  assert.equal(parseFormup(ping(["Formup 19:00 EVE, back before downtime"]), ts), utc(3, 19, 0));
  assert.equal(parseFormup(ping(["Fleet up at 11:00 EVE, right after maintenance"]), ts), utc(3, 11, 0), "con palabra de flota");
  assert.equal(parseFormup(ping(["Undock at 11:00 EVE, do not log in before"]), ts), utc(3, 11, 0));
  assert.equal(parseFormup(ping(["Form up at downtime, do not log off"]), ts), utc(3, 11, 0));
  assert.equal(parseFormup(ping(["CTA at downtime, maintenance is short today"]), ts), utc(3, 11, 0));
  // Un campo de hora explícito manda siempre.
  assert.equal(parseFormup(ping(["Do not log in at downtime", "Formup Time: 11:00"]), ts), utc(3, 11, 0));
  // Otra hora distinta de la del downtime: no se toca (mejor un aviso de más que perder un formup).
  assert.equal(parseFormup(ping(["Downtime extended until 11:30 EVE, do not log in"]), ts), utc(3, 11, 30));
  // Un «downtime» o «DT» suelto no basta para decir que es un aviso de mantenimiento.
  assert.equal(parseFleetTime("after DT tomorrow", ts), utc(4, 11, 0));
  assert.equal(parseFleetTime("we form at downtime", utc(3, 20, 0)), utc(4, 11, 0));
  // «op», «timer» y «server» no cuentan en ningún sentido.
  assert.equal(parseFormup(ping(["Server timer at 11:00 EVE, do not log in early"]), ts), null);
  assert.equal(parseFormup(ping(["Op at 19:00 EVE", "Server is fine"]), ts), utc(3, 19, 0));
});
