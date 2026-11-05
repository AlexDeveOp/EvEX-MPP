import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { placeBounds, rememberBounds, fitBounds, clampOpacity, validRect, MINI_DEFAULT, MINI_MIN, MINI_MAX } from "../../src/main/mini-bounds.js";
import { S } from "../../src/renderer/js/state.js";
import { pingsConv } from "../../src/renderer/js/convs.js";
import { miniState } from "../../src/renderer/js/mini-feed.js";
import { nextFormup } from "../../src/renderer/js/formup.js";
import { countdownText, timeAgo } from "../../src/renderer/js/countdown.js";
import { TEST_SETTINGS } from "./helpers.mjs";

const primary = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const above = { id: 2, workArea: { x: 0, y: -1440, width: 2560, height: 1400 } };

test("placeBounds: sin nada guardado, abajo a la derecha del monitor principal", () => {
  const b = placeBounds(null, [primary, above], 1);
  assert.deepEqual(b, { x: 1920 - MINI_DEFAULT.width - 16, y: 1040 - MINI_DEFAULT.height - 16, ...MINI_DEFAULT });
});

test("placeBounds: vuelve al último monitor y a su posición; si ese monitor ya no está, al principal", () => {
  let saved = rememberBounds(null, 1, { x: 100, y: 100, width: 320, height: 160 });
  saved = rememberBounds(saved, 2, { x: 50, y: -1300, width: 360, height: 170 });
  assert.equal(saved.last, "2");
  assert.deepEqual(placeBounds(saved, [primary, above], 1), { x: 50, y: -1300, width: 360, height: 170 });
  assert.deepEqual(placeBounds(saved, [primary], 1), { x: 100, y: 100, width: 320, height: 160 }, "el de arriba desconectado");
});

test("placeBounds: un mini-window.json roto vuelve a la posición por defecto, sin NaN", () => {
  const def = placeBounds(null, [primary], 1);
  for (const bad of [{ x: "a", y: 0, width: 300, height: 150 }, { x: 0, y: 0 }, { x: 0, y: 0, width: null, height: 150 }, { x: 0, y: 0, width: -5, height: 150 }, "texto", 42]) {
    const b = placeBounds({ last: "1", byDisplay: { 1: bad } }, [primary], 1);
    assert.deepEqual(b, def, JSON.stringify(bad));
  }
  assert.deepEqual(placeBounds({ last: "1", byDisplay: null }, [primary], 1), def);
  assert.deepEqual(placeBounds("roto", [primary], 1), def);
});

test("fitBounds: dentro del área útil y entre el tamaño mínimo y el máximo", () => {
  const wa = primary.workArea;
  assert.deepEqual(fitBounds({ x: 1900, y: 1030, width: 300, height: 150 }, wa), { x: 1620, y: 890, width: 300, height: 150 });
  assert.deepEqual(fitBounds({ x: -50, y: -50, width: 10, height: 10 }, wa), { x: 0, y: 0, ...MINI_MIN });
  assert.deepEqual(fitBounds({ x: 0, y: 0, width: 5000, height: 5000 }, wa), { x: 0, y: 0, ...MINI_MAX });
  assert.equal(clampOpacity(0.1), 0.3);
  assert.equal(clampOpacity("x"), 0.85);
  assert.equal(clampOpacity(1), 1);
});

const ZW = String.fromCharCode(0x200b, 0x200c);
const ping = (title, formup, to, ts) => ({ key: title + ts, ts, nick: "pingbot", body: `${title}\nFC Name:${ZW} Bob\nDoctrine: Ferox\n${formup ? `Formup Time: ${formup}\n` : ""}Comms: secret-channel\n\n~~~ This was a coord broadcast from bob to ${to} at 2026-11-06 18:00:00 EVE ~~~` });

beforeEach(() => {
  S.settings = structuredClone(TEST_SETTINGS);
  delete S.settings.fleets;
  // Los no leídos (totalUnread) miran el nivel de aviso de cada conversación.
  S.settings.notifications = { ...(S.settings.notifications || {}), roomModes: S.settings.notifications?.roomModes || {} };
  const pc = pingsConv();
  pc.messages.length = 0;
  pc.unread = 0;
});

test("miniState: último ping (solo título y grupo), próximo formup y contadores", () => {
  const now = Date.UTC(2026, 10, 6, 18, 30);
  const pc = pingsConv();
  pc.messages.push(ping("Dread fleet", "19:00", "caps", now - 20 * 60e3), ping(`Roam${ZW} now`, null, "all", now - 60e3));
  pc.unread = 2;
  const s = miniState(now);
  assert.deepEqual(s.ping, { title: `Roam${ZW} now`, group: "all", ts: now - 60e3 }, "el título va tal cual, con sus invisibles");
  assert.equal(JSON.stringify(s).includes("secret-channel"), false, "nunca el texto entero del ping");
  // Próximas flotas del calendario: hora (con el día si no es hoy), título y grupo; nada más del ping.
  assert.deepEqual(s.fleets, [{ at: Date.UTC(2026, 10, 6, 19, 0), when: "19:00", title: "Dread fleet", group: "caps", manual: false }]);
  assert.equal(typeof s.countdown, "boolean");
  assert.equal(s.pings, 2);
  assert.equal(typeof s.unread, "number");
  assert.equal(s.mentions, 0);
});

test("nextFormup: el más cercano que no sea viejo; nada si todos pasaron", () => {
  const now = Date.UTC(2026, 10, 6, 18, 30);
  const msgs = [ping("A", "20:00", "all", now - 3600e3), ping("B", "19:00", "all", now - 1800e3), ping("C", "18:00", "all", now - 7200e3)];
  assert.equal(nextFormup(msgs, now).m.key, msgs[1].key);
  assert.equal(nextFormup([msgs[2]], now), null, "a las 18:00 y son las 18:30: ya pasó");
  assert.equal(nextFormup([msgs[2]], Date.UTC(2026, 10, 6, 18, 10)).m.key, msgs[2].key, "10 min después aún es «¡Formup ahora!»");
});

test("nextFormup: el que empieza pronto gana al que empezó hace 10 min; cuándo cambia la elección", () => {
  const now = Date.UTC(2026, 10, 6, 18, 30);
  const started = ping("Started", "18:20", "all", now - 3600e3);
  const soon = ping("Soon", "18:35", "all", now - 1800e3);
  const later = ping("Later", "19:30", "all", now - 1800e3);
  const r = nextFormup([started, later, soon], now);
  assert.equal(r.m.key, soon.key);
  assert.equal(r.until, Date.UTC(2026, 10, 6, 18, 35), "cambia cuando empieza");
  const onlyStarted = nextFormup([started], now);
  assert.equal(onlyStarted.m.key, started.key, "sin ninguno futuro, el que empezó");
  assert.equal(onlyStarted.until, Date.UTC(2026, 10, 6, 18, 35), "y deja de valer 15 min después de su hora");
  assert.equal(nextFormup([started], Date.UTC(2026, 10, 6, 18, 36)), null);
  assert.equal(validRect({ x: 0, y: 0, width: 1, height: 1 }), true);
});

test("countdown.js: textos sin la ventana principal", () => {
  const at = Date.UTC(2026, 10, 6, 19, 0);
  assert.equal(countdownText(at, at - 125e3).text, "Formup en 02:05");
  assert.equal(countdownText(at, at - 30 * 3600e3, { eveDateTime: () => "07/11 19:00" }).text, "Formup el 07/11 19:00 EVE");
  assert.equal(timeAgo(at - 5 * 60e3, at), "hace 5 min");
  assert.equal(timeAgo(at - 10e3, at), "ahora");
});

// ---------- ventana (mini-window.js) con el stub de electron ----------

import { BrowserWindow, screen, app } from "electron";
import { applyMini, isMiniOpen, miniIpc, configureMini } from "../../src/main/mini-window.js";
import { tempDir } from "./helpers.mjs";

function stubScreen(t) {
  const saved = { ...screen };
  const d = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  Object.assign(screen, { getAllDisplays: () => [d], getPrimaryDisplay: () => d, getDisplayMatching: () => d, on: () => {} });
  const proto = BrowserWindow.prototype;
  const extra = { setOpacity(o) { this.opacity = o; }, setIgnoreMouseEvents(v) { this.ignore = v; }, getBounds() { return this.bounds || this.options; } };
  for (const [k, fn] of Object.entries(extra)) proto[k] = fn;
  t.after(() => {
    for (const k of Object.keys(extra)) delete proto[k];
    for (const k of ["getAllDisplays", "getPrimaryDisplay", "getDisplayMatching", "on"]) delete screen[k];
    Object.assign(screen, saved);
    applyMini({ mini: { enabled: false } });
    delete app.testUserData;
  });
  app.testUserData = tempDir(t);
}

test("cerrar y abrir seguido: el «closed» tardío de la ventana vieja no deja huérfana a la nueva", (t) => {
  stubScreen(t);
  const changes = [];
  configureMini({ preload: "", onClick: () => {}, onShow: () => {}, onChange: (v) => changes.push(v) });
  const handlers = new Map();
  miniIpc((ch, fn) => handlers.set(ch, fn));
  applyMini({ mini: { enabled: true, opacity: 0.6 } });
  const a = BrowserWindow.created.at(-1);
  assert.equal(a.options.focusable, false, "nunca coge el foco");
  assert.equal(isMiniOpen(), true);
  // En Electron el «closed» llega después: la ventana vieja no avisa al destruirse.
  a.destroy = function () { this.destroyed = true; };
  applyMini({ mini: { enabled: false } });
  applyMini({ mini: { enabled: true, opacity: 0.6 } });
  const b = BrowserWindow.created.at(-1);
  assert.notEqual(a, b);
  a.handlers.closed();
  a.handlers["ready-to-show"]();
  assert.equal(isMiniOpen(), true, "la nueva sigue siendo la actual");
  assert.equal(b.shown, undefined, "el ready-to-show de la vieja no enseña la nueva");
  b.handlers["ready-to-show"]();
  assert.equal(b.shown, true);
  assert.equal(b.opacity, 0.6);
  let sent = null;
  b.webContents.send = (ch, s) => (sent = [ch, s]);
  handlers.get("mini:update")({ pings: 1 });
  assert.deepEqual(sent, ["mini-state", { pings: 1 }], "la nueva recibe los datos");
  applyMini({ mini: { enabled: false } });
  assert.equal(isMiniOpen(), false, "y se puede cerrar");
  assert.equal(b.destroyed, true);
  assert.deepEqual(changes, [true, false, true, false]);
});
