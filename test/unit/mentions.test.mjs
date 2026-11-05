import { test } from "node:test";
import assert from "node:assert/strict";
import { S } from "../../src/renderer/js/state.js";
import { mentionMatch, mentionsConv, addMention, loadMentions, markMentionsSeen, markRoomMentionsSeen, isRoomLog, visibleMentions, mentionRooms, showMentionsEntry, HISTORY_DAYS } from "../../src/renderer/js/mentions.js";
import { TEST_SETTINGS } from "./helpers.mjs";

const ROOM = "ops@conference.example.com";
const OTHER = "chat@conference.example.com";

S.settings = structuredClone({
  ...TEST_SETTINGS,
  notifications: {
    keywords: ["capitals"],
    keywordRules: [{ id: "r1", name: "Titan", words: ["titan"], match: "word", where: { rooms: true, private: false, pings: false }, color: "#ff0000" }],
  },
});
S.accounts = [{ id: "a1", jid: "bobby@example.com", nick: "Bob", alias: "Bob", rooms: [{ jid: ROOM, nick: "BobFC" }] }];
// Todo lo de estos tests es posterior a la última vez que se vio la bandeja.
localStorage.setItem("evex.mentionsSeenAt", "1");

const msg = (over) => ({ key: `k${Math.random()}`, ts: Date.now(), nick: "alice", body: "", ...over });

test("mentionMatch reconoce el nick, el alias, el usuario, el nick de la sala y las palabras de aviso", () => {
  for (const body of ["hola Bob", "bobby mira esto", "BobFC al ancla", "¿quién tiene capitals?"]) {
    assert.ok(mentionMatch("a1", ROOM, msg({ body }))?.mention, body);
  }
  assert.equal(mentionMatch("a1", ROOM, msg({ body: "bobsled y Bobcat no cuentan" })), null);
});

test("mentionMatch cuenta las reglas por palabra clave de salas", () => {
  const m = mentionMatch("a1", ROOM, msg({ body: "titan en local" }));
  assert.equal(m.mention, false);
  assert.equal(m.rule?.id, "r1");
});

test("mentionMatch ignora tus mensajes, los del sistema y las correcciones", () => {
  assert.equal(mentionMatch("a1", ROOM, msg({ body: "Bob", out: true })), null);
  assert.equal(mentionMatch("a1", ROOM, msg({ body: "Bob", nick: "BobFC" })), null);
  assert.equal(mentionMatch("a1", ROOM, msg({ body: "Bob entra", sys: true })), null);
  assert.equal(mentionMatch("a1", ROOM, msg({ body: "Bob", rep: "id1" })), null);
});

test("isRoomLog distingue salas de chats privados", () => {
  assert.ok(isRoomLog("a1", ROOM));
  assert.ok(isRoomLog("a1", "fleet@muc.example.org"));
  assert.equal(isRoomLog("a1", "carol@example.com"), false);
  assert.equal(isRoomLog("a1", `${ROOM}/alice`), false);
});

test("loadMentions lee las salas recientes del historial y salta lo antiguo y los privados", async () => {
  const now = Date.now();
  const calls = [];
  globalThis.window.evex.call = async (channel, accountId, conv) => {
    calls.push([channel, conv]);
    if (channel === "logs:list")
      return [
        { conv: ROOM, mtime: now },
        { conv: OTHER, mtime: now - 1000 },
        { conv: "old@conference.example.com", mtime: now - (HISTORY_DAYS + 1) * 86400e3 },
        { conv: "carol@example.com", mtime: now },
      ];
    if (channel === "logs:tail" && conv === ROOM)
      return [
        { key: "h1", ts: now - 5000, nick: "alice", body: "Bob, ¿vienes?" },
        { key: "h2", ts: now - 4000, nick: "alice", body: "nada que ver" },
        { key: "h3", ts: now - 3000, nick: "BobFC", body: "Bob soy yo", out: 1 },
      ];
    if (channel === "logs:tail" && conv === OTHER) return [{ key: "h4", ts: now - 2000, nick: "dave", body: "titan!" }];
    return [];
  };
  const c = mentionsConv();
  assert.equal(await loadMentions(c), 2);
  assert.deepEqual(
    c.messages.map((m) => m.key),
    ["h1", "h4"],
  );
  assert.equal(c.pending, 2);
  const tailed = calls.filter(([ch]) => ch === "logs:tail").map(([, conv]) => conv);
  assert.deepEqual(tailed.sort(), [OTHER, ROOM].sort());
  // Una segunda llamada no vuelve a leer el historial.
  assert.equal(await loadMentions(c), 0);
});

test("addMention añade en directo, sin duplicados, y lo visto en la sala no queda pendiente", () => {
  const c = mentionsConv();
  const before = c.pending;
  const m = msg({ key: "live1", body: "Bob al ancla" });
  assert.ok(addMention("a1", ROOM, m));
  assert.equal(addMention("a1", ROOM, m), null);
  assert.equal(c.pending, before + 1);
  assert.ok(addMention("a1", ROOM, msg({ key: "live2", body: "Bob otra vez" }), { visible: true }));
  assert.equal(c.pending, before + 1);
  assert.equal(addMention("a1", ROOM, msg({ key: "live3", body: "sin mención" })), null);
  // Abrir la sala marca sus menciones como vistas; las de otras salas siguen pendientes.
  markRoomMentionsSeen("a1", ROOM);
  assert.equal(c.pending, 1);
  assert.equal(c.messages.find((x) => x.room === OTHER).key, "h4");
});

test("markMentionsSeen deja el contador a cero y lo nuevo vuelve a contar", () => {
  const c = mentionsConv();
  markMentionsSeen(Date.now() + 10);
  assert.equal(c.pending, 0);
  addMention("a1", OTHER, msg({ key: "live4", ts: Date.now() + 1000, body: "Bob?" }));
  assert.equal(c.pending, 1);
});

test("visibleMentions filtra por sala y texto, de la más reciente a la más antigua", () => {
  const c = mentionsConv();
  const all = visibleMentions(c.messages, {});
  assert.equal(all[0].key, "live4");
  assert.ok(all.every((x, i) => i === 0 || all[i - 1].ts >= x.ts));
  assert.deepEqual(
    visibleMentions(c.messages, { room: `a1|${OTHER}` }).map((x) => x.key),
    ["live4", "h4"],
  );
  assert.deepEqual(
    visibleMentions(c.messages, { query: "ancla" }).map((x) => x.key),
    ["live1"],
  );
  assert.equal(mentionRooms(c.messages).length, 2);
});

test("tus propios mensajes no entran aunque lleven tu nick o una palabra clave", () => {
  const c = mentionsConv();
  const n = c.messages.length;
  // Reflejo de la sala (outgoing) y mensaje con tu nick de sala sin la marca (p. ej. de otra conexión).
  assert.equal(addMention("a1", ROOM, msg({ key: "own1", nick: "BobFC", body: "Bob, titan y capitals", out: true })), null);
  assert.equal(addMention("a1", ROOM, msg({ key: "own2", nick: "bobfc", body: "Bob, titan y capitals" })), null);
  assert.equal(c.messages.length, n);
});

test("la entrada guarda el texto tal cual, con sus caracteres invisibles", () => {
  const ZW = String.fromCharCode(0x200b, 0x2060);
  const body = `Bob${ZW}, ti${ZW}tan en local`;
  const it = addMention("a1", OTHER, msg({ key: "zw1", body }));
  assert.ok(it);
  assert.equal(it.body, body);
  assert.equal(mentionsConv().messages.find((x) => x.key === "zw1").body, body);
});

test("la entrada «Menciones» está oculta salvo con menciones sin ver, con su pestaña abierta o con «Mostrar siempre»", () => {
  assert.equal(showMentionsEntry({ always: false, pending: 0, open: false, active: false }), false);
  assert.equal(showMentionsEntry({ always: false, pending: 2, open: false, active: false }), true);
  assert.equal(showMentionsEntry({ always: false, pending: 0, open: true, active: false }), true);
  assert.equal(showMentionsEntry({ always: false, pending: 0, open: false, active: true }), true);
  assert.equal(showMentionsEntry({ always: true, pending: 0, open: false, active: false }), true);
  // Con los valores de la app: al ver las menciones y cerrar la pestaña, se vuelve a ocultar.
  S.settings.notifications.alwaysShowMentions = false;
  const c = mentionsConv();
  addMention("a1", OTHER, msg({ key: "hide1", ts: Date.now() + 5000, body: "Bob, mira" }));
  S.tabs = [];
  S.active = null;
  assert.ok(c.pending > 0);
  assert.equal(showMentionsEntry(), true);
  markMentionsSeen(Date.now() + 10000);
  assert.equal(c.pending, 0);
  assert.equal(showMentionsEntry(), false, "la recogida sigue, pero la entrada no se ve");
  S.tabs = ["mentions|*"];
  assert.equal(showMentionsEntry(), true);
  S.settings.notifications.alwaysShowMentions = true;
  S.tabs = [];
  assert.equal(showMentionsEntry(), true);
});
