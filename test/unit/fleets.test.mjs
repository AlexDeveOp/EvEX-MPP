import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { S } from "../../src/renderer/js/state.js";
import { pingsConv } from "../../src/renderer/js/convs.js";
import * as F from "../../src/renderer/js/fleets.js";
import { fleetAlerts, countdownSettings, alertContent } from "../../src/renderer/js/formup.js";
import { TEST_SETTINGS } from "./helpers.mjs";

globalThis.window.evex = { call: async () => {} };
const NL = String.fromCharCode(10);
const ZW = String.fromCharCode(0x200b);
const utc = (d, h, m) => Date.UTC(2026, 10, d, h, m);
const ping = (key, ts, title, extra = [], to = "all") => ({ key, ts, nick: "pingbot", body: [title, `FC Name:${ZW} Bob`, ...extra, "", `~~~ This was a coord broadcast from bob to ${to} at 2026-11-03 12:00:00.000000 EVE ~~~`].join(NL) });

beforeEach(() => {
  S.settings = structuredClone(TEST_SETTINGS);
  delete S.settings.fleets;
  pingsConv().messages.length = 0;
  F._resetFleetsForTests();
});

test("una flota por cada op anunciada en los pings, con su hora, grupo y título tal cual", () => {
  pingsConv().messages.push(ping("a", utc(3, 12, 0), `Capital${ZW} fleet`, ["Formup Time: 19:00"], "caps"), ping("b", utc(3, 12, 5), "No time in this one"));
  const [f, ...rest] = F.allFleets();
  assert.equal(rest.length, 0, "el ping sin hora no es una flota");
  assert.deepEqual({ id: f.id, at: f.at, title: f.title, group: f.group, source: f.source, pingKeys: f.pingKeys, status: f.status }, { id: "p-a", at: utc(3, 19, 0), title: `Capital${ZW} fleet`, group: "caps", source: "ping", pingKeys: ["a"], status: "active" });
});

test("los recordatorios de la misma op se juntan, y el id es siempre el del ping más antiguo", () => {
  const msgs = pingsConv().messages;
  msgs.push(ping("late", utc(3, 18, 0), "Capital fleet reminder", ["Formup Time: 19:10"]));
  msgs.push(ping("first", utc(3, 12, 0), "Capital fleet", ["Formup Time: 19:00"]));
  msgs.push(ping("other", utc(3, 12, 30), "Roam with the corp", ["Formup Time: 19:05"]));
  const list = F.allFleets();
  assert.deepEqual(list.map((f) => f.id).sort(), ["p-first", "p-other"]);
  const op = list.find((f) => f.id === "p-first");
  assert.deepEqual(op.pingKeys, ["first", "late"]);
  assert.equal(op.at, utc(3, 19, 10), "la hora del recordatorio más reciente");
  // Un retoque guardado sigue con la misma flota aunque llegue otro recordatorio.
  F.updateFleet("p-first", { note: "llevar cyno" });
  msgs.push(ping("later", utc(3, 18, 30), "Capital fleet last call", ["Formup Time: 19:10"]));
  assert.equal(F.getFleet("p-first").note, "llevar cyno");
  assert.deepEqual(F.getFleet("p-first").pingKeys, ["first", "late", "later"]);
});

test("el mismo enlace al calendario junta pings con títulos distintos; el enlace solo se guarda", () => {
  const link = "https://forum.example.com/calendar/event/123-final-timer-in-c-j";
  const msgs = pingsConv().messages;
  msgs.push(ping("x", utc(3, 12, 0), "Big op", ["Formup Time: 17:15", `More: ${link}`]));
  msgs.push(ping("y", utc(3, 16, 0), "Everyone undock", ["Formup Time: 17:20", `Info ${link}.`]));
  const list = F.allFleets();
  assert.equal(list.length, 1);
  assert.equal(list[0].link, link);
  assert.equal(F.titleFromLink(link), "final timer in c j");
  assert.equal(F.calendarLink("see https://example.com/news/1 and nothing else"), "");
});

test("manuales y de mensaje: añadir, cambiar, aceptar, descartar y que la descartada no vuelva", () => {
  const m = F.addFleet({ at: utc(7, 18, 30), title: "Roam con la corp", note: "llevar 2 interceptores" });
  assert.match(m.id, /^m-/);
  assert.equal(m.status, "active");
  const s = F.addFleet({ at: utc(6, 21, 0), title: "big op", source: "message", msgKey: "room|k1" });
  assert.equal(s.status, "pending", "las de mensaje son sugeridas");
  assert.deepEqual(F.upcoming({ now: utc(5, 0, 0), includePending: false }).map((f) => f.id), [m.id]);
  F.updateFleet(m.id, { title: "Roam", at: utc(7, 19, 0) });
  assert.equal(F.getFleet(m.id).at, utc(7, 19, 0));
  F.acceptFleet(s.id);
  assert.equal(F.getFleet(s.id).status, "active");
  F.dismissFleet(s.id);
  assert.equal(F.getFleet(s.id).status, "dismissed");
  assert.equal(F.isDismissed("room|k1"), true, "el mensaje no se vuelve a sugerir");
  assert.equal(F.allFleets().some((f) => f.id === s.id), false);
  assert.equal(F.removeFleet(m.id), true);
  assert.equal(F.getFleet(m.id), null);
  assert.throws(() => F.addFleet({ at: "mañana" }), /no válida/);
});

test("quitar una flota de ping la oculta sin tocar el ping; upcoming y fleetsBetween", () => {
  pingsConv().messages.push(ping("a", utc(3, 12, 0), "Capital fleet", ["Formup Time: 19:00"]), ping("b", utc(3, 12, 0), "Dread fleet", ["Formup Time: 21:00"]));
  F.removeFleet("p-a");
  assert.deepEqual(F.allFleets().map((f) => f.id), ["p-b"]);
  assert.equal(F.getFleet("p-a").status, "dismissed");
  assert.equal(pingsConv().messages.length, 2);
  assert.deepEqual(F.upcoming({ now: utc(3, 21, 10) }).map((f) => f.id), ["p-b"], "hasta 15 min después sigue");
  assert.deepEqual(F.upcoming({ now: utc(3, 21, 20) }), []);
  assert.deepEqual(F.fleetsBetween(utc(3, 0, 0), utc(4, 0, 0)).map((f) => f.id), ["p-b"]);
});

test("onChange avisa de los cambios y se puede quitar", () => {
  let n = 0;
  const off = F.onChange(() => n++);
  F.addFleet({ at: utc(7, 18, 30), title: "Roam" });
  assert.equal(n, 1);
  off();
  F.addFleet({ at: utc(8, 18, 30), title: "Roam 2" });
  assert.equal(n, 1);
});

test("lo guardado de hace más de 90 días se borra", () => {
  const now = utc(30, 12, 0);
  S.settings.fleets = {
    items: { old: { id: "old", at: now - 91 * 86400e3, title: "vieja" }, recent: { id: "recent", at: now - 5 * 86400e3, title: "reciente" } },
    overrides: { "p-x": { note: "n", _at: now - 100 * 86400e3 }, "p-y": { note: "n", _at: now } },
    dismissed: { k1: now - 200 * 86400e3, k2: now - 86400e3 },
  };
  assert.equal(F.pruneFleets(now), true);
  assert.deepEqual(Object.keys(S.settings.fleets.items), ["recent"]);
  assert.deepEqual(Object.keys(S.settings.fleets.overrides), ["p-y"]);
  assert.deepEqual(Object.keys(S.settings.fleets.dismissed), ["k2"]);
  assert.equal(F.pruneFleets(now), false);
});

test("similarTitle", () => {
  assert.equal(F.similarTitle("Capital fleet up now!!", "capital fleet"), true);
  assert.equal(F.similarTitle("Capital fleet reminder", "Capital fleet last call"), true);
  assert.equal(F.similarTitle("Roam with the corp", "Capital fleet"), false);
  assert.equal(F.similarTitle("", "x"), false);
});

test("fleetDetails: FC, formup y doctrina del ping más antiguo; vacío en las manuales", () => {
  pingsConv().messages.push(ping("a", utc(3, 12, 0), "Capital fleet", ["Formup Time: 19:00", "Formup Location: Jita", "Doctrine: Ferox"]));
  const f = F.getFleet("p-a");
  assert.deepEqual(F.fleetDetails(f), { fc: `${ZW} Bob`.trim(), formup: "Jita", doctrine: "Ferox" });
  assert.deepEqual(F.fleetDetails(F.addFleet({ at: utc(7, 18, 0), title: "x" })), { fc: "", formup: "", doctrine: "" });
});

test("no se juntan ops distintas a la misma hora: otro título u otro grupo", () => {
  const msgs = pingsConv().messages;
  msgs.push(ping("cap", utc(3, 12, 0), "Capital fleet", ["Formup Time: 19:00"], "all"));
  msgs.push(ping("dread", utc(3, 12, 1), "Dread fleet", ["Formup Time: 19:00"], "all"));
  msgs.push(ping("cap2", utc(3, 12, 2), "Capital fleet", ["Formup Time: 19:00"], "caps"));
  assert.deepEqual(F.allFleets().map((f) => f.id).sort(), ["p-cap", "p-cap2", "p-dread"]);
  assert.equal(F.similarTitle("Capital fleet", "Dread fleet"), false, "«fleet» no cuenta");
});

test("los avisos de formup valen para las flotas a mano, no para las sugeridas sin aceptar", () => {
  const cfg = countdownSettings({ pingCountdown: { befores: [10], atTime: true } });
  const at = utc(7, 18, 30);
  const m = F.addFleet({ at, title: "Roam con la corp" });
  const s = F.addFleet({ at: utc(7, 18, 40), title: "big op", source: "message", msgKey: "k" });
  const now = at - 10 * 60e3 + 5000;
  assert.deepEqual(fleetAlerts(F.allFleets(), cfg, now, {}).map((a) => [a.fleet.id, a.minutes]), [[m.id, 10]]);
  F.acceptFleet(s.id);
  assert.deepEqual(fleetAlerts(F.allFleets(), cfg, utc(7, 18, 30) + 5000, {}).map((a) => [a.fleet.id, a.minutes]).sort(), [[m.id, 0], [s.id, 10]].sort());
});

test("el aviso usa el título y la nota de la flota (con los cambios del usuario) y los campos del ping", () => {
  pingsConv().messages.push(ping("a", utc(3, 12, 0), "Capital fleet", ["Formup Time: 19:00", "Doctrine: Ferox"]));
  F.updateFleet("p-a", { title: "Caps al timer", note: "llevar cyno" });
  const c = alertContent(F.getFleet("p-a"));
  assert.equal(c.title, "Caps al timer");
  assert.deepEqual(c.fields.slice(0, 1), [{ key: "Nota", value: "llevar cyno" }]);
  assert.ok(c.fields.some((f) => f.key === "Doctrine"));
});
