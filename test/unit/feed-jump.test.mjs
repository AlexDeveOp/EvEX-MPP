// «Pings de flota» y «Menciones» van del más nuevo (arriba) al más viejo: su botón flotante sube al principio
// (no baja al más antiguo), cuenta solo lo que entra en directo y Inicio/Fin funcionan fuera de los campos de texto.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isNewestFirst, jumpButtons, jumpTopLabel, countsAsNew, feedKeyAction, JUMP_TOP_AFTER } from "../../src/renderer/js/feed-jump.js";

const pings = { type: "pings" };
const mentions = { type: "mentions" };
const room = { type: "groupchat" };
const chat = { type: "chat" };
const box = (scrollTop) => ({ scrollTop, scrollHeight: 5000, clientHeight: 600 });

test("solo Pings y Menciones van del más nuevo arriba", () => {
  assert.equal(isNewestFirst(pings), true);
  assert.equal(isNewestFirst(mentions), true);
  assert.equal(isNewestFirst(room), false);
  assert.equal(isNewestFirst(chat), false);
  assert.equal(isNewestFirst(null), false);
});

test("en Pings, al abrir (arriba del todo) no se ve ningún botón; la flecha abajo ya no existe", () => {
  // Antes la flecha abajo salía nada más abrir la vista y llevaba al ping más viejo.
  assert.deepEqual(jumpButtons(pings, box(0)), { up: false, down: false });
  assert.deepEqual(jumpButtons(pings, box(JUMP_TOP_AFTER)), { up: false, down: false });
  assert.deepEqual(jumpButtons(pings, box(JUMP_TOP_AFTER + 1)), { up: true, down: false });
  // Ni siquiera abajo del todo vuelve la flecha abajo.
  assert.deepEqual(jumpButtons(pings, box(4400)), { up: true, down: false });
  assert.deepEqual(jumpButtons(mentions, box(1200)), { up: true, down: false });
});

test("los chats y salas siguen con la flecha abajo de siempre", () => {
  assert.deepEqual(jumpButtons(room, box(4400)), { up: false, down: false });
  assert.deepEqual(jumpButtons(room, box(4321)), { up: false, down: false });
  assert.deepEqual(jumpButtons(room, box(1000)), { up: false, down: true });
  assert.deepEqual(jumpButtons(chat, box(0)), { up: false, down: true });
});

test("el texto del botón dice adónde lleva", () => {
  assert.equal(jumpTopLabel(pings), "Ir al último ping");
  assert.equal(jumpTopLabel(pings, "list"), "Ir al último ping");
  assert.equal(jumpTopLabel(pings, "upcoming"), "Ir arriba");
  assert.equal(jumpTopLabel(pings, "month"), "Ir arriba");
  assert.equal(jumpTopLabel(mentions), "Ir a la última mención");
});

test("«N nuevos» cuenta solo lo que llega en directo", () => {
  assert.equal(countsAsNew({ body: "Fleet up" }), true);
  assert.equal(countsAsNew({ body: "Fleet up", delayed: true }), false, "recuperado del servidor (con retraso)");
  assert.equal(countsAsNew({ body: "Fleet up", history: true }), false, "del historial local");
  assert.equal(countsAsNew({ body: "Sent to caps", fc: true }), false, "respuesta del bot a un envío del Modo FC");
  assert.equal(countsAsNew({ body: "Sent to caps", fcReply: true }), false);
  assert.equal(countsAsNew({ body: "…", sys: true }), false);
  assert.equal(countsAsNew(null), false);
});

test("Inicio sube al más nuevo y Fin baja al más antiguo, salvo escribiendo en un campo", () => {
  const on = (tagName, extra = {}) => ({ target: { tagName, ...extra } });
  assert.equal(feedKeyAction({ key: "Home", ...on("div") }), "top");
  assert.equal(feedKeyAction({ key: "End", ...on("BUTTON") }), "bottom");
  assert.equal(feedKeyAction({ key: "Home", ...on("input") }), null, "el buscador de la cabecera");
  assert.equal(feedKeyAction({ key: "End", ...on("TEXTAREA") }), null);
  assert.equal(feedKeyAction({ key: "Home", ...on("SELECT") }), null);
  assert.equal(feedKeyAction({ key: "Home", ...on("DIV", { isContentEditable: true }) }), null);
  assert.equal(feedKeyAction({ key: "Home", ctrlKey: true, ...on("DIV") }), null);
  assert.equal(feedKeyAction({ key: "End", shiftKey: true, ...on("DIV") }), null);
  assert.equal(feedKeyAction({ key: "PageDown", ...on("DIV") }), null);
  assert.equal(feedKeyAction({ key: "Home", target: null }), "top");
});

test("los textos del botón tienen traducción al inglés", () => {
  const en = fs.readFileSync(new URL("../../src/renderer/locales/en.js", import.meta.url), "utf8");
  for (const key of ["Ir al último ping", "Ir a la última mención", "Ir arriba"]) assert.ok(en.includes(`"${key}":`), key);
});

test("chat.js usa el botón de subir en las vistas del más nuevo arriba", () => {
  const src = fs.readFileSync(new URL("../../src/renderer/js/chat.js", import.meta.url), "utf8");
  assert.ok(src.includes('icon("arrow-up")'));
  assert.ok(src.includes("isNewestFirst(c)"));
  assert.ok(src.includes("countNewAtTop(p, m)"));
});

test("la flecha arriba existe en los iconos (si no, icon() pinta un círculo)", async () => {
  const { ICONS } = await import("../../src/renderer/js/data/icons.js");
  assert.ok(ICONS["arrow-up"], "falta arrow-up en scripts/build-assets.mjs");
  assert.ok(ICONS["arrow-down"]);
});
