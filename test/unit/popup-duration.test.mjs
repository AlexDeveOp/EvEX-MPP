// Cuánto se queda un aviso en pantalla (popup-duration.js): pings y aviso del formup con el mismo selector, y la
// migración desde los interruptores de antes sin cambiar lo que tenga guardado cada uno.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normDuration, popupTimeout, DURATION_CHOICES } from "../../src/renderer/js/popup-duration.js";
import { countdownSettings } from "../../src/renderer/js/formup.js";
import { timeoutOf, isSticky, configurePopups } from "../../src/main/popups.js";

test("las opciones del selector: hasta cerrarlo, como los mensajes, 10 s, 30 s, 1 min y 5 min", () => {
  assert.deepEqual(DURATION_CHOICES, ["sticky", "message", 10, 30, 60, 300]);
});

test("normDuration acepta los valores del selector (también como texto) y si no, usa el interruptor viejo", () => {
  assert.equal(normDuration("sticky"), "sticky");
  assert.equal(normDuration("message"), "message");
  assert.equal(normDuration(30), 30);
  assert.equal(normDuration("300"), 300);
  // Sin valor nuevo: el interruptor de antes (true = fijo, false = como los mensajes); sin nada, fijo, como siempre.
  assert.equal(normDuration(undefined, true), "sticky");
  assert.equal(normDuration(null, false), "message");
  assert.equal(normDuration(undefined), "sticky");
  // Valores raros o de otra versión: el interruptor, o fijo.
  for (const v of [7, "", "forever", -10, {}]) assert.equal(normDuration(v, false), "message", String(v));
});

test("popupTimeout: los pings y el formup con su duración; las reglas que piden «se queda», fijas; lo demás, como los mensajes", () => {
  const o = { pingDuration: 30, messageSeconds: 8 };
  assert.equal(popupTimeout({ kind: "ping" }, o), 30e3);
  assert.equal(popupTimeout({ kind: "ping" }, { ...o, pingDuration: "sticky" }), null);
  assert.equal(popupTimeout({ kind: "ping" }, { ...o, pingDuration: "message" }), 8e3);
  assert.equal(popupTimeout({ kind: "msg" }, o), 8e3);
  assert.equal(popupTimeout({ kind: "msg", sticky: true }, o), null, "regla por palabra clave con «se queda»");
  // El aviso del formup obedece solo a lo suyo, aunque los pings sean fijos.
  assert.equal(popupTimeout({ kind: "ping", reminder: true, duration: 60 }, { pingDuration: "sticky", messageSeconds: 8 }), 60e3);
  assert.equal(popupTimeout({ kind: "ping", reminder: true, duration: "message" }, o), 8e3);
  assert.equal(popupTimeout({ kind: "ping", reminder: true, duration: "sticky" }, o), null);
  // Un aviso de formup de una versión anterior (solo sticky).
  assert.equal(popupTimeout({ kind: "ping", reminder: true, sticky: false }, o), 8e3);
  assert.equal(popupTimeout({ kind: "ping", reminder: true, sticky: true }, o), null);
  // Los mensajes nunca duran menos de 3 s.
  assert.equal(popupTimeout({ kind: "msg" }, { messageSeconds: 1 }), 3e3);
});

test("el aviso del formup: lo guardado de antes no cambia y el valor nuevo manda", () => {
  assert.equal(countdownSettings({ pingCountdown: {} }).duration, "sticky", "de serie, como ahora");
  assert.equal(countdownSettings({ pingCountdown: { sticky: false } }).duration, "message", "quien lo tenía apagado");
  assert.equal(countdownSettings({ pingCountdown: { sticky: true } }).duration, "sticky");
  const c = countdownSettings({ pingCountdown: { sticky: true, duration: 30 } });
  assert.equal(c.duration, 30);
  assert.equal(c.sticky, false, "el interruptor viejo sigue de acuerdo con la duración");
  assert.equal(countdownSettings({ pingCountdown: { duration: "sticky" } }).sticky, true);
});

test("las burbujas: la duración de los pings llega con configurePopups, y el interruptor viejo también vale", () => {
  configurePopups({ duration: 8, pingDuration: 10 });
  assert.equal(timeoutOf({ kind: "ping" }), 10e3);
  configurePopups({ pingDuration: null, pingSticky: false });
  assert.equal(timeoutOf({ kind: "ping" }), 8e3, "sin valor nuevo: el interruptor apagado = como los mensajes");
  configurePopups({ pingSticky: true });
  assert.equal(timeoutOf({ kind: "ping" }), null);
  configurePopups({ pingDuration: 300, pingSticky: true });
  assert.equal(timeoutOf({ kind: "ping" }), 300e3, "el valor nuevo manda");
  // isSticky conserva su forma (también con true/false como antes).
  assert.equal(isSticky({ kind: "ping" }, true), true);
  assert.equal(isSticky({ kind: "ping" }, false), false);
  assert.equal(isSticky({ kind: "ping" }, "sticky"), true);
  configurePopups({ pingDuration: "sticky", duration: 8 });
});
