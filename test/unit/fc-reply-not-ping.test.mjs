// Modo FC: la respuesta del bot a un envío (marcada fcReply por el proceso principal) va al chat privado con el bot
// como un mensaje normal: no entra en «Pings de flota» ni avisa como ping. Un ping de verdad del mismo bot sí.
import { test } from "node:test";
import assert from "node:assert/strict";
import { S, convKey, PINGS_KEY } from "../../src/renderer/js/state.js";
import { ingestMessage, pingsConv, getConv } from "../../src/renderer/js/convs.js";
import { TEST_SETTINGS } from "./helpers.mjs";

const notes = [];
globalThis.window.evex = { call: async (ch, data) => (ch === "notify" ? notes.push(data) : null), on: () => {} };
S.settings = structuredClone({
  ...TEST_SETTINGS,
  notifications: { enabled: true, pings: true, sound: false, volume: 0, sounds: {}, keywords: [], keywordRules: [], roomModes: {} },
  pingSenders: ["pingbot"],
  pingVoice: { enabled: false },
});
S.accounts = [{ id: "a1", jid: "yo@ejemplo.com", nick: "yo", alias: "yo", rooms: [] }];
S.tabs = [PINGS_KEY, convKey("a1", "pingbot@ejemplo.com")];
S.focused = false;

const BOT = "pingbot@ejemplo.com";
const msg = (body, extra = {}) => ({ type: "message", accountId: "a1", conv: BOT, convType: "chat", nick: "pingbot", fromJid: BOT, body, id: `m${Math.random()}`, ts: Date.now(), ...extra });

test("la respuesta marcada va al chat del bot, no a los pings ni con aviso de ping", () => {
  const before = { pings: pingsConv().messages.length, notes: notes.length };
  ingestMessage(msg("Broadcast sent to 3 users", { fcReply: true }));
  assert.equal(pingsConv().messages.length, before.pings, "no entra en «Pings de flota»");
  assert.ok(!notes.slice(before.notes).some((n) => n.kind === "ping"), "no avisa como ping");
  const chat = getConv("a1", BOT, "chat").messages.at(-1);
  assert.equal(chat.body, "Broadcast sent to 3 users");
  assert.equal(chat.fc, true);
});

test("un ping de verdad del mismo bot sigue yendo a «Pings de flota»", () => {
  const before = pingsConv().messages.length;
  const n = notes.length;
  ingestMessage(msg("Caps fleet up\n\n~~~ This was a coord broadcast from bob to caps at 2026-11-07 12:00:00.000000 EVE ~~~"));
  assert.equal(pingsConv().messages.length, before + 1);
  assert.ok(notes.slice(n).some((x) => x.kind === "ping"), "y avisa como ping");
});

test("la respuesta marcada no abre la pestaña del bot; un mensaje privado normal sí, como siempre", () => {
  const key = convKey("a1", BOT);
  S.tabs = S.tabs.filter((k) => k !== key);
  ingestMessage(msg("Broadcast sent to 3 users", { fcReply: true }));
  assert.ok(!S.tabs.includes(key), "sin pestaña: se ve en la ventana de envío");
  assert.equal(getConv("a1", BOT, "chat").messages.at(-1).body, "Broadcast sent to 3 users", "pero se queda en el chat del bot");
  // (Lo demás que diga pingbot es un ping y va a «Pings de flota»; la pestaña se prueba con otro contacto.)
  const other = "alice@ejemplo.com";
  ingestMessage({ ...msg("hola"), conv: other, nick: "alice", fromJid: other });
  assert.ok(S.tabs.includes(convKey("a1", other)), "un mensaje privado normal abre su pestaña");
});

test("una respuesta marcada de un contacto que NO es remitente de pings tampoco abre pestaña, y una sin marcar sí", () => {
  const bot2 = "relay@ejemplo.com";
  ingestMessage({ ...msg("Broadcast sent to 2 users", { fcReply: true }), conv: bot2, nick: "relay", fromJid: bot2 });
  assert.ok(!S.tabs.includes(convKey("a1", bot2)));
  ingestMessage({ ...msg("otra cosa"), conv: bot2, nick: "relay", fromJid: bot2 });
  assert.ok(S.tabs.includes(convKey("a1", bot2)), "lo que no es respuesta FC la abre como siempre");
});
