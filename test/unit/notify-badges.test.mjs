// Contadores por nivel de aviso con mensajes de verdad (ingestMessage → convBadge → markRead).
// Regresión de la revisión del #55: «solo menciones» en chats privados contaba por posición (slice(-unread)).
import { test } from "node:test";
import assert from "node:assert/strict";
import { S, convKey } from "../../src/renderer/js/state.js";
import { ingestMessage, convBadge, markRead, totalUnread, getConv } from "../../src/renderer/js/convs.js";
import { shouldAlert } from "../../src/renderer/js/notify-rules.js";
import { TEST_SETTINGS } from "./helpers.mjs";

const ALICE = "alice@example.com";
S.settings = structuredClone({
  ...TEST_SETTINGS,
  notifications: {
    enabled: false, // sin burbujas ni sonidos: aquí solo se miran los contadores
    privateMessages: true,
    mentions: true,
    allRoomMessages: false,
    keywords: [],
    keywordRules: [{ id: "r1", name: "Titan", words: ["titan"], match: "word", where: { rooms: false, private: true, pings: false }, notify: "always", color: "#ff0000" }],
    roomModes: {},
  },
  pingSenders: ["pingbot"],
});
S.accounts = [{ id: "a1", jid: "bob@example.com", nick: "Bob", alias: "Bob", rooms: [] }];
// La pestaña ya está abierta: así ingestMessage no la abre (openConv pediría el historial al proceso principal).
S.tabs = [convKey("a1", "alice@example.com")];
S.active = null;
S.focused = false;

let n = 0;
// La conversación nunca está delante (el primer mensaje de un chat abre su pestaña y podría activarla).
const say = (body, over = {}) => ((S.active = "otra"), ingestMessage({ accountId: "a1", conv: ALICE, convType: "chat", nick: "Alice", body, id: `m${++n}`, ts: Date.now(), ...over }));
const key = convKey("a1", ALICE);
const level = (v) => (S.settings.notifications.roomModes[key] = v);

test("«Solo menciones» en un chat: cuenta las menciones sin leer y se limpia al leer", () => {
  level("mentions");
  say("hola");
  say("Bob, ¿vienes?");
  say("otra cosa");
  const c = getConv("a1", ALICE, "chat");
  assert.equal(convBadge(c).count, 1, "solo la mención");
  assert.equal(convBadge(c).mention, true);
  markRead(key);
  assert.equal(convBadge(c).count, 0, "leído: a 0 (antes slice(-0) contaba todo el historial)");
  assert.equal(totalUnread(), 0);
});

test("«Solo menciones»: los mensajes tuyos y del sistema después de la mención no la sacan de la cuenta", () => {
  level("mentions");
  say("Bob mira esto");
  say("respuesta mía (carbon)", { outgoing: true });
  say("Alice te está llamando la atención.", { system: true });
  const c = getConv("a1", ALICE, "chat");
  assert.equal(convBadge(c).count, 1);
  markRead(key);
});

test("«Solo menciones»: una regla por palabra clave de privados cuenta (y avisa)", () => {
  level("mentions");
  say("hay un titan en local");
  const c = getConv("a1", ALICE, "chat");
  assert.equal(convBadge(c).count, 1, "la regla cuenta como mención");
  const rule = S.settings.notifications.keywordRules[0];
  assert.equal(shouldAlert({ type: "chat", level: "mentions", mention: false, rule, n: { enabled: true, privateMessages: true } }), true);
  markRead(key);
});

test("«Nada» en un chat: no cuenta ni se pinta en rojo; «Todo»: cada privado cuenta y en rojo", () => {
  level("none");
  say("hola");
  say("Bob!");
  const c = getConv("a1", ALICE, "chat");
  assert.deepEqual(convBadge(c), { count: 0, mention: false, level: "none" });
  level("all");
  assert.equal(convBadge(c).count, 2);
  assert.equal(convBadge(c).mention, true, "un privado sin leer se pinta como mención, como antes");
  markRead(key);
  delete S.settings.notifications.roomModes[key];
});

test("shouldAlert: el estado XMPP «No molestar» calla aunque se dejen pasar las menciones de la app", () => {
  const n2 = { enabled: true, mentions: true, privateMessages: true, dndAllowMentions: true };
  assert.equal(shouldAlert({ type: "groupchat", level: "mentions", mention: true, n: n2, presenceDnd: true }), false);
  assert.equal(shouldAlert({ type: "groupchat", level: "mentions", mention: true, n: n2, dnd: { active: true } }), true, "el de la app sí las deja pasar");
  assert.equal(shouldAlert({ type: "groupchat", level: "all", rule: { notify: "always", dnd: true }, n: n2, presenceDnd: true }), true, "las reglas «aunque esté en No molestar» pasan");
});
