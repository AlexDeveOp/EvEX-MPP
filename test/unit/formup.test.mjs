import { test } from "node:test";
import assert from "node:assert/strict";
import { S } from "../../src/renderer/js/state.js";
import { parsePing } from "../../src/renderer/js/pings.js";
import { parseFormup, countdownText, countdownSettings, dueAlerts, wantedGroups, reminderSpeech } from "../../src/renderer/js/formup.js";
import { TEST_SETTINGS } from "./helpers.mjs";

S.settings = structuredClone(TEST_SETTINGS);

const TS = Date.UTC(2026, 10, 3, 18, 0); // ping enviado a las 18:00 EVE
const at = (body, ts = TS) => parseFormup(parsePing(body), ts);
const utc = (h, m, day = 3) => Date.UTC(2026, 10, day, h, m);

test("lee la hora de campos como «Formup Time» o «Time», con o sin EVE", () => {
  assert.equal(at("Capital fleet\nFC Name: Bob\nFormup Time: 19:00\nDoctrine: Ferox"), utc(19, 0));
  assert.equal(at("Op\nTime: 1930 EVE"), utc(19, 30));
  assert.equal(at("Op\nWhen: 20:15 ET"), utc(20, 15));
});

test("en texto libre la hora necesita contexto", () => {
  assert.equal(at("Fleet forming, formup at 19:45 in Jita"), utc(19, 45));
  assert.equal(at("Big fight 21:00 EVE, be there"), utc(21, 0));
  assert.equal(at("Doctrine 12:5 bombers, 300 pilots"), null, "un número cualquiera no es una hora");
  assert.equal(at("Capital fleet up now!!\nFormup Location: Jita"), null);
});

test("«in 20 min» y «en 1 hora» son relativos a la hora del ping", () => {
  assert.equal(at("Undock in 20 min"), TS + 20 * 60e3);
  assert.equal(at("Formup: en 1 hora"), TS + 3600e3);
});

test("una hora muy anterior al ping es del día siguiente, y una fecha explícita manda", () => {
  assert.equal(at("Formup Time: 00:15", Date.UTC(2026, 10, 3, 23, 30)), utc(0, 15, 4));
  assert.equal(at("Formup Time: 17:30"), utc(17, 30), "media hora antes sigue siendo hoy (formup ya en marcha)");
  assert.equal(at("Formup Time: 2026-11-05 19:00"), utc(19, 0, 5));
});

test("la hora del pie (envío del ping) no cuenta como formup", () => {
  assert.equal(at("Capital fleet up now!!\nFC Name: Bob\n~~~ This was a coord broadcast from bob to all at 2026-11-03 18:00:00.000000 EVE ~~~"), null);
});

test("countdownText: minutos, horas, ahora y pasado", () => {
  const T = utc(19, 0);
  assert.deepEqual(countdownText(T, T - (12 * 60 + 34) * 1000), { state: "soon", text: "Formup en 12:34" });
  assert.equal(countdownText(T, T - (3600 + 5 * 60) * 1000).text, "Formup en 1:05:00");
  assert.equal(countdownText(T, T + 60e3).state, "now");
  assert.equal(countdownText(T, T + 30 * 60e3).text, "Formup hace 30 min");
  assert.equal(countdownText(T, T + 3 * 3600e3).state, "old");
});

test("dueAlerts avisa antes y a la hora, una sola vez y nunca tarde", () => {
  const cfg = countdownSettings({ pingCountdown: { before: 10 } });
  const msgs = [{ key: "p1", ts: TS, body: "Op\nFormup Time: 19:00" }];
  assert.deepEqual(dueAlerts(msgs, cfg, utc(18, 49)), []);
  const early = dueAlerts(msgs, cfg, utc(18, 50, 3) + 5000);
  const id10 = `${utc(19, 0)}|op|10`;
  assert.deepEqual(early.map((a) => [a.id, a.minutes]), [[id10, 10]]);
  assert.deepEqual(dueAlerts(msgs, cfg, utc(18, 50) + 5000, { [id10]: 1 }), [], "ya avisado");
  assert.deepEqual(dueAlerts(msgs, cfg, utc(18, 55)), [], "pasado el margen no avisa tarde");
  assert.deepEqual(dueAlerts(msgs, cfg, utc(19, 0) + 1000).map((a) => a.id), [`${utc(19, 0)}|op|0`]);
  assert.deepEqual(dueAlerts(msgs, { ...cfg, alert: false }, utc(19, 0) + 1000), []);
});

test("countdownSettings: el «before» antiguo pasa a la lista de avisos antes", () => {
  assert.deepEqual(countdownSettings({ pingCountdown: { before: 15 } }).befores, [15]);
  assert.deepEqual(countdownSettings({ pingCountdown: { before: 0 } }).befores, [], "0 era «solo a la hora»");
  assert.deepEqual(countdownSettings({}).befores, [5], "por defecto, 5 min antes, como antes");
  assert.deepEqual(countdownSettings({ pingCountdown: { before: 15, befores: [10, 60, 10, -3, "x"] } }).befores, [60, 10], "manda la lista nueva, sin repetidos ni valores raros");
  assert.equal("before" in countdownSettings({ pingCountdown: { before: 15 } }), false, "al guardar ya no se escribe el campo antiguo");
});

test("dueAlerts: varios avisos antes, cada uno en su momento", () => {
  const cfg = countdownSettings({ pingCountdown: { befores: [60, 15, 5], atTime: false } });
  const msgs = [{ key: "p1", ts: Date.UTC(2026, 10, 3, 17, 30), body: "Op\nFormup Time: 19:00" }];
  assert.deepEqual(dueAlerts(msgs, cfg, utc(18, 0) + 1000).map((a) => a.minutes), [60]);
  assert.deepEqual(dueAlerts(msgs, cfg, utc(18, 45) + 1000).map((a) => a.minutes), [15]);
  assert.deepEqual(dueAlerts(msgs, cfg, utc(18, 55) + 1000).map((a) => a.minutes), [5]);
  assert.deepEqual(dueAlerts(msgs, cfg, utc(19, 0) + 1000), [], "sin el aviso a la hora");
  // Un ping que llega 20 min antes del formup no avisa de la hora previa ni de los 30 que ya pasaron.
  const late = [{ key: "p2", ts: utc(18, 40), body: "Op\nFormup Time: 19:00" }];
  assert.deepEqual(dueAlerts(late, cfg, utc(18, 0) + 1000), []);
  assert.deepEqual(dueAlerts(late, cfg, utc(18, 45) + 1000).map((a) => a.minutes), [15]);
});

test("dueAlerts: solo los grupos elegidos y una vez por ping aunque llegue repetido", () => {
  const body = (to, stamp) => `Capital fleet
Formup Time: 19:00

~~~ This was a coord broadcast from bob to ${to} at 2026-11-03 18:00:${stamp} EVE ~~~`;
  const msgs = [
    { key: "a", ts: TS, body: body("all", "00.1") },
    { key: "b", ts: TS + 20, body: body("all", "01.1") },
    { key: "c", ts: TS, body: body("caps", "00.1").replace("Capital fleet", "Dread fleet") },
  ];
  const cfg = countdownSettings({ pingCountdown: { befores: [10] } });
  assert.deepEqual(dueAlerts(msgs, cfg, utc(18, 50) + 1000).map((a) => a.m.key), ["a", "c"], "las dos copias de «a» avisan una vez");
  assert.deepEqual(dueAlerts(msgs, { ...cfg, groups: "Caps" }, utc(18, 50) + 1000).map((a) => a.m.key), ["c"]);
  assert.deepEqual(wantedGroups(" all, Caps\n"), ["all", "caps"]);
  assert.deepEqual(wantedGroups(""), []);
});

test("reminderSpeech: lo que se lee en voz alta", () => {
  assert.equal(reminderSpeech(15, "Capital fleet up"), "Formup in 15 minutes. Capital fleet up");
  assert.equal(reminderSpeech(1, ""), "Formup in 1 minute");
  assert.equal(reminderSpeech(0, "Op"), "Formup now. Op");
});
