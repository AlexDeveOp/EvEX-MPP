// Calendario de flotas, parte manual: horas EVE del formulario, validación, datos iniciales desde un mensaje o un ping
// y las flotas sugeridas de los mensajes de las salas. fleets.js y parseFleetTime se sustituyen por versiones de prueba.
import { test } from "node:test";
import assert from "node:assert/strict";
import { S } from "../../src/renderer/js/state.js";
import { eveParts, fromEveParts, nextHour, validateFleet, trimSpaces, prefillFromMessage, prefillFromPing, pendingFor, useFleets, fleetsReady, calendarMenuItem } from "../../src/renderer/js/fleet-manual.js";
import { createFleetSuggester, looksLikeFleet, titleFromText, considerRoomMessage } from "../../src/renderer/js/fleet-suggest.js";
import { TEST_SETTINGS } from "./helpers.mjs";

S.settings = structuredClone(TEST_SETTINGS);

const NOW = Date.UTC(2026, 10, 5, 12, 0); // jueves 5 nov 2026, 12:00 EVE
// parseFleetTime de prueba: entiende «at HH:MM» (hoy, o mañana si ya pasó) y «tomorrow at HH:MM».
function fakeParse(text, ts) {
  const m = /(tomorrow\s+)?at\s+(\d{1,2}):(\d{2})/i.exec(text);
  if (!m) return null;
  const d = new Date(ts);
  let at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(m[2]), Number(m[3]));
  if (m[1] || at < ts) at += 86400e3;
  return at;
}
function fakeFleets() {
  const list = [];
  const dismissed = new Set();
  return {
    list,
    dismissed,
    addFleet: (f) => (list.push({ id: `f${list.length + 1}`, ...f }), list.at(-1)),
    updateFleet: () => {},
    removeFleet: () => {},
    allFleets: () => list,
    isDismissed: (k) => dismissed.has(k),
    fleetFromPing: (m) => ({ at: NOW + 3600e3, title: "Capital fleet up now!!", group: "caps", link: "https://ejemplo.com/cal" }),
  };
}

test("eveParts y fromEveParts van y vuelven en hora EVE (UTC), sin depender de la zona horaria local", () => {
  assert.deepEqual(eveParts(Date.UTC(2026, 10, 6, 17, 15)), { date: "2026-11-06", time: "17:15" });
  assert.equal(fromEveParts("2026-11-06", "17:15"), Date.UTC(2026, 10, 6, 17, 15));
  assert.equal(fromEveParts("2026-11-06", "7:05"), Date.UTC(2026, 10, 6, 7, 5));
  for (const [d, tm] of [["2026-02-30", "10:00"], ["2026-11-06", "24:00"], ["2026-11-06", "10:60"], ["06/11/2026", "10:00"], ["", ""], ["2026-11-06", "x"]]) assert.equal(fromEveParts(d, tm), null, `${d} ${tm}`);
  assert.equal(nextHour(NOW + 1), NOW + 3600e3);
  assert.equal(nextHour(NOW), NOW + 3600e3);
});

test("validateFleet pide título y una hora válida que no haya pasado", () => {
  assert.equal(validateFleet({ at: NOW + 3600e3, title: "Roam" }, NOW), "");
  assert.match(validateFleet({ at: NOW, title: "  " }, NOW), /título/);
  assert.match(validateFleet({ at: NOW, title: String.fromCharCode(0x200b, 0xfeff) }, NOW), /título/, "solo invisibles");
  const BOM = String.fromCharCode(0xfeff);
  assert.equal(trimSpaces(`  ${BOM}Roam${BOM} 	`), `${BOM}Roam${BOM}`, "trimSpaces no quita U+FEFF");
  assert.match(validateFleet({ at: null, title: "Roam" }, NOW), /no son válidas/);
  assert.match(validateFleet({ at: NOW - 13 * 3600e3, title: "Roam" }, NOW), /ya ha pasado/);
  // Un formup de hace poco aún se puede apuntar (p. ej. para el SRP).
  assert.equal(validateFleet({ at: NOW - 3600e3, title: "Roam" }, NOW), "");
});

test("prefillFromMessage toma la hora del texto, la primera línea como título y la clave del mensaje", () => {
  const m = { key: "k1", ts: NOW, nick: "fc_bob", body: "\u200BBig op at 21:00, be there\nbring caps" };
  assert.deepEqual(prefillFromMessage(m, "capitales", fakeParse), { at: Date.UTC(2026, 10, 5, 21, 0), title: `${String.fromCharCode(0x200b)}Big op at 21:00, be there`, note: "De fc_bob en capitales", msgKey: "k1", source: "manual" });
  // Sin hora en el texto, el formulario propone la siguiente hora en punto.
  assert.equal(prefillFromMessage({ ...m, body: "roam later" }, "x", fakeParse).at, null);
});

test("sin el calendario conectado, el menú «Añadir al calendario» sale desactivado", () => {
  useFleets(null);
  assert.equal(fleetsReady(), false);
  const item = calendarMenuItem(() => ({}));
  assert.equal(item.label, "Añadir al calendario");
  assert.equal(item.disabled, true);
  assert.equal(considerRoomMessage("a", "r@conference.x", { key: "z", ts: NOW, body: "fleet at 20:00" }), null);
});

test("prefillFromPing usa lo que saca fleets.js del ping y guarda la clave del ping", () => {
  const f = fakeFleets();
  useFleets(f, { parseFleetTime: fakeParse });
  assert.equal(fleetsReady(), true);
  assert.equal(calendarMenuItem(() => ({})).disabled, false);
  assert.equal(calendarMenuItem(() => ({})).label, "Añadir al calendario");
  assert.deepEqual(prefillFromPing({ key: "p1", body: "Capital fleet up now!!\nFC: Bob" }), { at: NOW + 3600e3, title: "Capital fleet up now!!", group: "caps", link: "https://ejemplo.com/cal", pingKeys: ["p1"], source: "manual" });
  // Un ping sin hora de formup: título y grupo (del pie) del propio ping.
  f.fleetFromPing = () => null;
  const PING = "Roam now\n\n~~~ This was a coord broadcast from bob to allcaps at 2026-11-05 12:00:00 EVE ~~~";
  assert.deepEqual(prefillFromPing({ key: "p2", body: PING }), { at: null, title: "Roam now", group: "allcaps", link: "", pingKeys: ["p2"], source: "manual" });
  // Un ping que ya es una flota del calendario: se abre esa para editarla.
  f.list.push({ id: "ping-op-1", at: NOW, title: "Op", pingKeys: ["p3"], status: "active" });
  assert.equal(prefillFromPing({ key: "p3", body: PING }).id, "ping-op-1");
  assert.equal(calendarMenuItem(() => prefillFromPing({ key: "p3", body: PING })).label, "Editar en el calendario");
  useFleets(null);
});

test("pendingFor encuentra la sugerida pendiente de un mensaje para aceptarla en vez de duplicarla", () => {
  const f = fakeFleets();
  useFleets(f, { parseFleetTime: fakeParse });
  f.list.push({ id: "s1", msgKey: "m9", status: "pending" }, { id: "s2", msgKey: "m8", status: "active" });
  assert.equal(pendingFor("m9")?.id, "s1");
  assert.equal(pendingFor("m8"), null, "ya aceptada");
  assert.equal(pendingFor(""), null);
  useFleets(null);
});

test("looksLikeFleet y titleFromText", () => {
  for (const s of ["big op on friday at 21:00", "Formup 19:00 in Jita", "CTA at 18:00", "roam tonight", "flota a las 21:00", "Stratop tomorrow"]) assert.ok(looksLikeFleet(s), s);
  for (const s of ["dinner at 21:00", "operator error", "shops open at 9:00", "topology"]) assert.ok(!looksLikeFleet(s), s);
  assert.equal(titleFromText("\n\n  hola mundo  \nsegunda"), "hola mundo");
  assert.equal(titleFromText("x".repeat(100), 10), `${"x".repeat(9)}…`);
});

test("titleFromText deja los caracteres invisibles tal cual (marcas de agua) y no parte un emoji al recortar", () => {
  const [ZW, ZNJ, WJ, BOM] = [0x200b, 0x200c, 0x2060, 0xfeff].map((c) => String.fromCharCode(c));
  const marked = `${BOM}Capital${ZW} fleet${ZNJ} up${WJ}${BOM}`;
  assert.equal(titleFromText(`  ${marked}  \nFC: Bob`), marked, "con todos sus invisibles, también U+FEFF en los bordes");
  // Una línea que solo tiene invisibles cuenta como vacía, pero no se quita de la siguiente.
  assert.equal(titleFromText(`${ZW}${WJ}\n${ZW}Roam now`), `${ZW}Roam now`);
  const rocket = String.fromCodePoint(0x1f680);
  const long = `${"a".repeat(8)}${rocket}${"b".repeat(20)}`;
  const cut = titleFromText(long, 10);
  assert.equal(cut, `${"a".repeat(8)}${rocket}…`);
  assert.equal(Array.from(cut).length, 10);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cut), "sin mitades de emoji");
  // Las sugeridas también guardan el título tal cual.
  const f = fakeFleets();
  const consider = createFleetSuggester({ parseFleetTime: fakeParse, addFleet: f.addFleet, isDismissed: f.isDismissed, allFleets: f.allFleets }, { now: () => NOW });
  const s = consider("a1", "r", { key: "w1", ts: NOW, nick: "bob", body: `big${ZW} op at 21:00` });
  assert.equal(s.title, `«big${ZW} op at 21:00»`);
});

test("las sugeridas: solo mensajes de flota con hora futura, una vez por mensaje, sin las descartadas ni las ya añadidas", () => {
  const f = fakeFleets();
  const consider = createFleetSuggester({ parseFleetTime: fakeParse, addFleet: f.addFleet, isDismissed: f.isDismissed, allFleets: f.allFleets }, { now: () => NOW });
  const msg = (over) => ({ key: `k${Math.random()}`, ts: NOW - 60e3, nick: "fc_bob", body: "big op at 21:00, be there", ...over });

  const first = consider("a1", "capitales@conference.x", msg({ key: "m1" }), { roomName: "capitales" });
  assert.deepEqual(first, { id: "f1", at: Date.UTC(2026, 10, 5, 21, 0), title: "«big op at 21:00, be there»", group: "", note: "Sugerida: hora encontrada en un mensaje de fc_bob en capitales", source: "message", msgKey: "m1" });
  // El mismo mensaje otra vez (historial y directo) no se repite.
  assert.equal(consider("a1", "capitales@conference.x", msg({ key: "m1" })), null);
  // Ya en el calendario desde otra sesión de la app.
  f.list.push({ id: "x", msgKey: "m2" });
  assert.equal(consider("a1", "r", msg({ key: "m2" })), null);
  // Descartada antes: no vuelve.
  f.dismissed.add("m3");
  assert.equal(consider("a1", "r", msg({ key: "m3" })), null);
  // Sin palabra de flota, sin hora, propios, del sistema, correcciones, sin clave.
  for (const over of [{ body: "dinner at 21:00" }, { body: "fleet soon" }, { out: true }, { sys: true }, { rep: "id1" }, { editOf: "id1" }, { key: "" }]) assert.equal(consider("a1", "r", msg(over)), null, JSON.stringify(over));
  // Una hora ya pasada (historial viejo) o a más de dos semanas no se sugiere.
  const old = msg({ key: "m4", ts: NOW - 10 * 86400e3 });
  assert.equal(consider("a1", "r", old), null);
  const late = createFleetSuggester({ parseFleetTime: () => NOW + 20 * 86400e3, addFleet: f.addFleet, isDismissed: f.isDismissed, allFleets: f.allFleets }, { now: () => NOW });
  assert.equal(late("a1", "r", msg({ key: "m5" })), null);
  assert.equal(f.list.filter((x) => x.source === "message").length, 1);
});

test("considerRoomMessage usa el calendario conectado y no rompe la entrada de mensajes si algo falla", () => {
  const f = fakeFleets();
  useFleets(f, { parseFleetTime: fakeParse });
  // No hay reloj inyectado aquí: la hora del mensaje es ahora.
  const ts = Date.now();
  assert.ok(considerRoomMessage("a1", "r@conference.x", { key: "live1", ts, nick: "bob", body: "Formup tomorrow at 19:00" }, { roomName: "r" }));
  assert.equal(f.list.length, 1);
  useFleets({ ...f, addFleet: () => { throw new Error("almacén roto"); } }, { parseFleetTime: fakeParse });
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(" "));
  try {
    assert.equal(considerRoomMessage("a1", "r", { key: "live2", ts, nick: "bob", body: "fleet at 23:59" }), null);
  } finally {
    console.error = orig;
  }
  assert.ok(errors.some((e) => e.includes("almacén roto")));
  useFleets(null);
});
