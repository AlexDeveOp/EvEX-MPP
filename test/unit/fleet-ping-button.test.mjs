// Calendario de flotas: el botón de cada ping, de dónde viene una flota sacada de una sala (origin) y no sugerir lo
// que ya está en el calendario. Con el fleets.js de verdad y pings de prueba.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { S } from "../../src/renderer/js/state.js";
import { pingsConv } from "../../src/renderer/js/convs.js";
import * as F from "../../src/renderer/js/fleets.js";
import { parseFleetTime } from "../../src/renderer/js/fleet-time.js";
import { useFleets, pingButtonState, fleetForPing, prefillFromMessage } from "../../src/renderer/js/fleet-manual.js";
import { normGroup, groupOf, coveringFleet, createFleetSuggester, retireCovered, SAME_FLEET_MS } from "../../src/renderer/js/fleet-suggest.js";
import { TEST_SETTINGS } from "./helpers.mjs";

globalThis.window.evex = { call: async () => {} };
const NL = String.fromCharCode(10);
const NOW = Date.UTC(2026, 10, 5, 12, 0);
const at = (h, m = 0) => Date.UTC(2026, 10, 5, h, m);
const ping = (key, title, time, to = "all") => ({ key, ts: NOW - 3600e3, nick: "pingbot", body: [title, "FC Name: Bob", `Formup Time: 2026-11-05 ${time}`, "", `~~~ This was a coord broadcast from bob to ${to} at 2026-11-05 11:00:00.000000 EVE ~~~`].join(NL) });
const msg = (key, body) => ({ key, ts: NOW - 60e3, nick: "fc_bob", body });
const deps = () => ({ parseFleetTime, addFleet: F.addFleet, updateFleet: F.updateFleet, isDismissed: F.isDismissed, allFleets: F.allFleets, onChange: F.onChange });

beforeEach(() => {
  S.settings = structuredClone(TEST_SETTINGS);
  delete S.settings.fleets;
  S.accounts = [{ id: "a1", jid: "yo@ejemplo.com", nick: "yo", alias: "yo", rooms: [{ jid: "capitales@conference.ejemplo.com", name: "Capitales (mi marcador)" }] }];
  pingsConv().messages.length = 0;
  F._resetFleetsForTests();
  useFleets(null);
});

test("normGroup y groupOf reconocen los grupos y sus otros nombres", () => {
  assert.deepEqual(["Caps", "capitales", "CAPITALS", "allcaps", "dreads", "Supers", "titans", "subcaps", "Subcapitales", "all", "everyone", "logistics", ""].map(normGroup), ["caps", "caps", "caps", "caps", "caps", "supers", "supers", "subcaps", "subcaps", "all", "all", "logistics", ""]);
  assert.equal(groupOf("subcaps op at 21:00 in jita"), "subcaps");
  assert.equal(groupOf("big op at 21:00, all hands"), "all");
  assert.equal(groupOf("big op at 21:00"), "");
  assert.equal(groupOf("capsule pilots welcome"), "", "solo palabras enteras");
});

test("no se sugiere una flota que ya está en el calendario a ±30 min", () => {
  pingsConv().messages.push(ping("p1", "Capital fleet", "21:10", "caps"));
  const consider = createFleetSuggester(deps(), { now: () => NOW });
  // Misma hora (a 10 min) y sin grupo en el mensaje: es la misma op.
  assert.equal(consider("a1", "capitales@conference.ejemplo.com", msg("m1", "big op at 21:00, be there")), null);
  // Con el mismo grupo, tampoco.
  assert.equal(consider("a1", "capitales@conference.ejemplo.com", msg("m2", "caps fleet at 21:00")), null);
  // Con otro grupo distinto: dos ops a la misma hora, sí se sugiere.
  const sub = consider("a1", "capitales@conference.ejemplo.com", msg("m3", "subcaps fleet at 21:00"));
  assert.equal(sub?.status, "pending");
  assert.equal(sub.group, "subcaps");
  // Fuera de la ventana de 30 minutos: es otra op.
  assert.ok(consider("a1", "capitales@conference.ejemplo.com", msg("m4", "fleet at 21:45")), "a 35 min");
  assert.equal(SAME_FLEET_MS, 30 * 60e3);
});

test("una flota a mano o aceptada también cuenta; una pendiente o descartada no", () => {
  F.addFleet({ at: at(19, 0), title: "Roam", source: "manual" });
  const pend = F.addFleet({ at: at(20, 0), title: "otra sugerida", source: "message", msgKey: "x" });
  const gone = F.addFleet({ at: at(22, 0), title: "descartada", source: "manual" });
  F.dismissFleet(gone.id);
  const list = F.allFleets({ includeDismissed: true });
  assert.ok(coveringFleet(list, at(19, 20)), "la manual");
  assert.equal(coveringFleet(list, at(20, 0), "", { except: "nada" }), null, "una pendiente no tapa a otra");
  assert.equal(pend.status, "pending");
  assert.equal(coveringFleet(list, at(22, 0)), null, "la descartada no cuenta");
});

test("una sugerida pendiente se retira sola si luego llega el ping de esa op, y no vuelve al repasar el historial", () => {
  const consider = createFleetSuggester(deps(), { now: () => NOW });
  const s = consider("a1", "capitales@conference.ejemplo.com", msg("m1", "big op at 21:00, be there"));
  assert.equal(s.status, "pending");
  // Llega el ping de la misma op.
  pingsConv().messages.push(ping("p1", "Capital fleet", "21:05", "caps"));
  assert.equal(retireCovered(deps()), 1);
  assert.equal(F.getFleet(s.id).status, "dismissed");
  assert.equal(F.isDismissed("m1"), false, "no la ha descartado el usuario");
  assert.ok(!F.allFleets().some((f) => f.id === s.id), "ya no sale en la agenda");
  // El historial se vuelve a repasar (otro arranque): el mensaje no se sugiere otra vez.
  const again = createFleetSuggester(deps(), { now: () => NOW });
  assert.equal(again("a1", "capitales@conference.ejemplo.com", msg("m1", "big op at 21:00, be there")), null);
  // Una de otro grupo distinto se queda.
  const sub = again("a1", "capitales@conference.ejemplo.com", msg("m2", "subcaps op at 21:00"));
  assert.equal(retireCovered(deps()), 0);
  assert.equal(F.getFleet(sub.id).status, "pending");
});

test("conectado a fleets.js, la retirada va sola con cada cambio del calendario", () => {
  useFleets(F, { parseFleetTime });
  const s = F.addFleet({ at: at(21, 0), title: "«big op»", source: "message", msgKey: "m9", origin: { accountId: "a1", room: "capitales@conference.ejemplo.com", nick: "fc_bob" } });
  assert.equal(F.getFleet(s.id).status, "pending");
  F.addFleet({ at: at(21, 20), title: "Op a mano", source: "manual" });
  assert.equal(F.getFleet(s.id).status, "dismissed");
  useFleets(null);
});

test("addFleet guarda de qué sala y de quién viene (sin el nombre visible) y updateFleet lo conserva", () => {
  const f = F.addFleet({ at: at(21, 0), title: "x", source: "message", msgKey: "m1", origin: { accountId: "a1", room: "capitales@conference.ejemplo.com", nick: "fc_bob", name: "no se guarda" } });
  assert.deepEqual(F.getFleet(f.id).origin, { accountId: "a1", room: "capitales@conference.ejemplo.com", nick: "fc_bob" });
  F.acceptFleet(f.id);
  F.updateFleet(f.id, { title: "y" });
  assert.deepEqual(F.getFleet(f.id).origin, { accountId: "a1", room: "capitales@conference.ejemplo.com", nick: "fc_bob" });
  // Sin sala no hay origin.
  assert.equal(F.getFleet(F.addFleet({ at: at(22, 0), title: "z", origin: { nick: "solo" } }).id).origin, undefined);
  assert.equal(F.getFleet(F.addFleet({ at: at(22, 0), title: "z", origin: "texto" }).id).origin, undefined);
  // «Añadir al calendario» desde un mensaje lo pasa al formulario.
  assert.deepEqual(prefillFromMessage(msg("m5", "fleet at 21:00"), "capitales", parseFleetTime, { accountId: "a1", room: "capitales@conference.ejemplo.com", nick: "fc_bob" }).origin, { accountId: "a1", room: "capitales@conference.ejemplo.com", nick: "fc_bob" });
  assert.equal(prefillFromMessage(msg("m6", "fleet at 21:00"), "capitales", parseFleetTime).origin, undefined);
});

test("el botón de cada ping: «Añadir al calendario» o, si ya es una flota, «En el calendario: editar»", () => {
  useFleets(F, { parseFleetTime });
  pingsConv().messages.push(ping("p1", "Capital fleet", "19:00", "caps"));
  assert.equal(fleetForPing("p1")?.source, "ping");
  assert.deepEqual(pingButtonState("p1"), { inCal: true, icon: "calendar-check", label: "En el calendario: editar" });
  assert.deepEqual(pingButtonState("p-sin-hora"), { inCal: false, icon: "calendar-plus", label: "Añadir al calendario" });
  assert.equal(fleetForPing(""), null);
  useFleets(null);
  assert.equal(pingButtonState("p1").inCal, false, "sin calendario conectado");
});
