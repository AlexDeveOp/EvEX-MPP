import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { S } from "../../src/renderer/js/state.js";
import { srpSettings, srpEnabled, isMarked, toggleMark, updateMark, clearMarks, srpDeadline, srpText, srpTextAll, validKillmail, markedCount } from "../../src/renderer/js/srp.js";
import { pingMatches, visiblePings } from "../../src/renderer/js/pings.js";
import { TEST_SETTINGS } from "./helpers.mjs";

// saveSettings llama al proceso principal: aquí no hace nada.
globalThis.window.evex = { call: async () => {} };

const DAY = 86400000;
const ZW = String.fromCharCode(0x200b);
const ping = (key, ts, body = `Fleet up${ZW}\nFC Name: Bob FC\n\n~~~ This was a coord broadcast from bob to all ~~~`) => ({ key, ts, body });

beforeEach(() => {
  S.settings = structuredClone(TEST_SETTINGS);
});

test("desactivado por defecto: sin SRP no se filtra por marcados", () => {
  assert.equal(srpEnabled(), false);
  assert.deepEqual(srpSettings().marks, {});
  const m = ping("a", 1);
  assert.equal(pingMatches(m, "", "", true), false, "con el filtro de marcados y el SRP apagado no sale nada");
  assert.equal(pingMatches(m, "", "", false), true);
});

test("marcar y desmarcar, y el filtro «Marcados»", () => {
  S.settings.srp = { enabled: true, deadlineDays: 0, marks: {} };
  const a = ping("a", 1000);
  const b = ping("b", 2000);
  assert.equal(toggleMark(a), true);
  assert.equal(isMarked("a"), true);
  assert.equal(isMarked("b"), false);
  assert.equal(pingMatches(a, "", "", true), true);
  assert.equal(pingMatches(b, "", "", true), false);
  assert.equal(markedCount([a, b]), 1);
  assert.deepEqual(Object.keys(S.settings.srp.marks), ["a"]);
  assert.equal(S.settings.srp.marks.a.status, "pending");
  assert.equal(toggleMark(a), false);
  assert.equal(isMarked("a"), false);
});

test("killmail, nota y estado se guardan por ping, y se borran todos a la vez", () => {
  S.settings.srp = { enabled: true, deadlineDays: 0, marks: {} };
  const a = ping("a", 1000);
  toggleMark(a);
  updateMark("a", { killmail: "https://zkillboard.com/kill/123/", note: "Typhoon", status: "requested" });
  assert.deepEqual({ ...S.settings.srp.marks.a, at: 0 }, { at: 0, ts: 1000, killmail: "https://zkillboard.com/kill/123/", note: "Typhoon", status: "requested" });
  updateMark("zz", { note: "no existe" }); // un ping sin marcar no se crea
  assert.equal(isMarked("zz"), false);
  clearMarks();
  assert.deepEqual(S.settings.srp.marks, {});
});

test("plazo para pedir el SRP: sin plazo, quedan días, menos de un día y vencido", () => {
  const ts = Date.UTC(2026, 10, 1, 12);
  assert.equal(srpDeadline(ts, 0, ts), null, "0 = sin plazo");
  const ok = srpDeadline(ts, 30, ts + 2 * DAY + 3600000);
  assert.equal(ok.state, "ok");
  assert.equal(ok.at, ts + 30 * DAY);
  assert.match(ok.text, /Quedan 27 d 23 h/);
  assert.equal(ok.short, "27 d 23 h");
  const soon = srpDeadline(ts, 1, ts + 20 * 3600000);
  assert.equal(soon.state, "soon");
  assert.equal(soon.short, "4 h");
  const late = srpDeadline(ts, 1, ts + 2 * DAY);
  assert.equal(late.state, "late");
  assert.match(late.text, /vencido/);
});

test("texto para el SRP: el ping tal cual (con sus caracteres invisibles), la hora EVE, el killmail y la nota", () => {
  S.settings.srp = { enabled: true, deadlineDays: 0, marks: {} };
  const a = ping("a", Date.UTC(2026, 10, 2, 12, 5));
  toggleMark(a);
  updateMark("a", { killmail: " https://zkillboard.com/kill/1/ ", note: "Perdí un Typhoon" });
  const text = srpText(a);
  assert.ok(text.startsWith(`Fleet up${ZW}\nFC Name: Bob FC`), "con su marca invisible, tal cual");
  assert.match(text, /Ping: 2026-11-02 12:05 EVE/);
  assert.match(text, /Killmail: https:\/\/zkillboard\.com\/kill\/1\/$/m);
  assert.match(text, /Nota: Perdí un Typhoon/);
  // Sin killmail ni nota, solo el ping y su hora.
  const b = ping("b", Date.UTC(2026, 10, 1, 9));
  toggleMark(b);
  assert.doesNotMatch(srpText(b), /Killmail|Nota/);
  // Todos los marcados, del más antiguo al más reciente.
  const all = srpTextAll([a, b, ping("c", 5)]);
  assert.ok(all.indexOf("2026-11-01 09:00") < all.indexOf("2026-11-02 12:05"));
  assert.equal(all.split("----------").length, 2);
  assert.ok(all.includes(`Fleet up${ZW}`), "«Copiar todos» también tal cual");
});

test("texto para el SRP: solo se quitan espacios normales; un U+FEFF en el borde se queda", () => {
  S.settings.srp = { enabled: true, deadlineDays: 0, marks: {} };
  const BOM = String.fromCharCode(0xfeff);
  const m = ping("z", Date.UTC(2026, 10, 2, 12, 0), `  ${BOM}Op${ZW} now${BOM}  `);
  toggleMark(m);
  assert.ok(srpText(m).startsWith(`${BOM}Op${ZW} now${BOM}\n`));
});

test("enlace de killmail: vacío o http(s)", () => {
  assert.equal(validKillmail(""), true);
  assert.equal(validKillmail("https://zkillboard.com/kill/1/"), true);
  assert.equal(validKillmail("http://killboard.ejemplo.com/kill/1"), true);
  assert.equal(validKillmail("javascript:alert(1)"), false);
  assert.equal(validKillmail("zkillboard.com/kill/1"), false);
});

test("burbuja de estado: solo en los marcados, con su estado (y «Sin pedir» si falta)", async () => {
  const { chipStatus } = await import("../../src/renderer/js/srp.js");
  S.settings.srp = { enabled: true, deadlineDays: 0, marks: {} };
  const a = ping("a", 1000);
  assert.equal(chipStatus(a), null, "sin marcar no hay burbuja");
  toggleMark(a);
  assert.equal(chipStatus(a), "pending");
  for (const st of ["requested", "paid", "rejected"]) {
    updateMark("a", { status: st });
    assert.equal(chipStatus(a), st);
  }
  updateMark("a", { status: "raro" });
  assert.equal(chipStatus(a), "pending");
});

test("apagar el SRP con el filtro «Marcados» puesto vuelve a enseñar todos los pings", () => {
  S.settings.srp = { enabled: true, deadlineDays: 0, marks: {} };
  const a = ping("a", 1000);
  const b = ping("b", 2000);
  toggleMark(a);
  const filter = { query: "", group: "", srpOnly: true };
  assert.deepEqual(visiblePings([a, b], filter).map((m) => m.key), ["a"], "con el SRP encendido, solo los marcados");
  S.settings.srp.enabled = false;
  assert.deepEqual(visiblePings([a, b], filter).map((m) => m.key), ["b", "a"], "con el SRP apagado, todos (lo más nuevo primero)");
  assert.equal(filter.srpOnly, false, "el filtro «Marcados» se quita");
});
