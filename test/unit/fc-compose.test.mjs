import { test } from "node:test";
import assert from "node:assert/strict";
import { S } from "../../src/renderer/js/state.js";
import * as c from "../../src/renderer/js/fc-compose.js";
import { TEST_SETTINGS } from "./helpers.mjs";

S.settings = structuredClone(TEST_SETTINGS);

const ZW = String.fromCharCode(0x200b);
const ZWJ = String.fromCharCode(0x200d);
const NOW = Date.UTC(2026, 10, 7, 18, 30, 20); // 18:30:20 EVE

const FC = (over = {}) => ({
  groupMode: "address",
  lineFormat: "!ping {grupo}",
  webUrl: "",
  botNick: "",
  sentPattern: "",
  rejectedPattern: "",
  channel: { accountId: "a1", jid: "pings-bot@salas.ejemplo.com", kind: "groupchat" },
  groups: [],
  defaultGroup: "",
  ...over,
});

test("parseHM entiende las formas habituales de escribir la hora", () => {
  assert.deepEqual(c.parseHM("19:00"), { h: 19, m: 0 });
  assert.deepEqual(c.parseHM(" 1930 "), { h: 19, m: 30 });
  assert.deepEqual(c.parseHM("7.05"), { h: 7, m: 5 });
  assert.deepEqual(c.parseHM("9:5"), { h: 9, m: 5 });
  assert.deepEqual(c.parseHM("21"), { h: 21, m: 0 });
  for (const bad of ["", "25:00", "19:60", "mañana", "19:00:00"]) assert.equal(c.parseHM(bad), null, bad);
});

test("formupAt: hoy si aún no ha pasado (o hace menos de 15 min), mañana si ya pasó", () => {
  assert.equal(c.formupAt("19:00", NOW), Date.UTC(2026, 10, 7, 19, 0));
  assert.equal(c.formupAt("18:20", NOW), Date.UTC(2026, 10, 7, 18, 20));
  assert.equal(c.formupAt("18:00", NOW), Date.UTC(2026, 10, 8, 18, 0));
  assert.equal(c.formupAt("00:10", Date.UTC(2026, 10, 7, 23, 50)), Date.UTC(2026, 10, 8, 0, 10));
  assert.equal(c.formupAt("nada", NOW), null);
});

test("hmIn redondea al minuto de arriba, en hora EVE", () => {
  assert.equal(c.hmIn(0, NOW), "18:31");
  assert.equal(c.hmIn(30, NOW), "19:01");
  assert.equal(c.hmIn(60, Date.UTC(2026, 10, 7, 23, 30)), "00:30");
});

test("templateText rellena el formato y quita lo de los campos vacíos o quitados", () => {
  const format = "{tipo} · FC: {fc}\nFormup: {hora} EVE · {lugar}\nDoctrine: {doctrina} · Comms: {comms}\n{notas}";
  const values = { type: "Strat op", fc: "Bob FC", time: "19:00", place: "Home staging", doctrine: "Ferox fleet", comms: " Mumble · Op 1 ", notes: "Bring cap boosters" };
  assert.equal(c.templateText(format, values, Object.keys(c.FIELD_KEYS)), "Strat op · FC: Bob FC\nFormup: 19:00 EVE · Home staging\nDoctrine: Ferox fleet · Comms: Mumble · Op 1\nBring cap boosters");
  // «notes» quitado en Preferencias: su línea desaparece aunque tenga texto.
  assert.equal(c.templateText(format, values, ["type", "fc", "time", "place", "doctrine", "comms"]), "Strat op · FC: Bob FC\nFormup: 19:00 EVE · Home staging\nDoctrine: Ferox fleet · Comms: Mumble · Op 1");
});

test("templateValues deja los invisibles de lo que se escribe", () => {
  assert.equal(c.templateValues({ type: `${ZW}CTA${ZW}` }).tipo, `${ZW}CTA${ZW}`);
});

test("barGroups: solo los que pueden ser botón según el modo; initialGroups marca el de serie", () => {
  const groups = [
    { name: "all", address: "all@broadcast.ejemplo.com", button: true, manual: false },
    { name: "caps", address: "", button: true, manual: true },
    { name: "supers", address: "s@broadcast.ejemplo.com", button: false, manual: true },
  ];
  assert.deepEqual(c.barGroups(FC({ groups })).map((g) => g.name), ["all"]);
  assert.deepEqual(c.barGroups(FC({ groups, groupMode: "line" })).map((g) => g.name), ["all", "caps"]);
  assert.deepEqual(c.barGroups(FC({ groups, groupMode: "web" })).map((g) => g.name), ["all", "caps"]);
  const bar = c.barGroups(FC({ groups, groupMode: "line" }));
  assert.deepEqual(c.initialGroups(bar, "CAPS"), ["caps"]);
  assert.deepEqual(c.initialGroups(bar, "supers"), []);
  assert.deepEqual(c.initialGroups(bar, ""), []);
});

test("sendAccount y sendBlocker", () => {
  const accounts = [{ id: "a1" }, { id: "a2" }];
  assert.equal(c.sendAccount(FC(), accounts).id, "a1");
  assert.equal(c.sendAccount(FC({ channel: { accountId: "x" } }), accounts), null);
  assert.equal(c.sendAccount(FC({ channel: { accountId: "x" } }), [{ id: "a2" }]).id, "a2");
  const g = [{ name: "all" }];
  assert.equal(c.sendBlocker(FC(), { text: ` ${ZW}\n `, groups: g, accounts }), "empty");
  assert.equal(c.sendBlocker(FC(), { text: "Ping", groups: [], accounts }), "no-groups");
  assert.equal(c.sendBlocker(FC({ channel: { accountId: "x" } }), { text: "Ping", groups: g, accounts }), "no-account");
  assert.equal(c.sendBlocker(FC({ groupMode: "line", channel: { accountId: "a1", jid: "" } }), { text: "Ping", groups: g, accounts }), "no-channel");
  assert.equal(c.sendBlocker(FC({ groupMode: "address", channel: { accountId: "a1", jid: "" } }), { text: "Ping", groups: g, accounts }), null);
  assert.equal(c.sendBlocker(FC({ groupMode: "web" }), { text: "Ping", groups: g, accounts: [] }), "no-url");
  assert.equal(c.sendBlocker(FC({ groupMode: "web", webUrl: "https://pings.ejemplo.com" }), { text: "Ping", groups: g, accounts: [] }), null);
  assert.equal(c.sendBlocker(FC({ groupMode: "web", webUrl: "javascript:alert(1)" }), { text: "Ping", groups: g, accounts: [] }), "no-url");
  assert.equal(c.sendBlocker(FC(), { text: "Ping", groups: g, accounts, isOnline: () => false }), "offline");
  assert.equal(c.sendBlocker(FC({ groupMode: "web", webUrl: "https://pings.ejemplo.com" }), { text: "Ping", groups: g, accounts, isOnline: () => false }), null);
  assert.equal(c.webUrlOk("http://pings.ejemplo.com/x?a=1"), true);
  assert.equal(c.webUrlOk("file:///C:/x"), false);
  assert.equal(c.webUrlOk("pings.ejemplo.com"), false);
});

test("buildRequest lleva el texto tal cual y los ajustes avanzados solo si están puestos", () => {
  const text = `${ZW} CAPS NEEDED ${ZWJ}\nFC: Bob FC\n`;
  const groups = [{ name: "caps", address: "caps@broadcast.ejemplo.com", button: true }];
  const req = c.buildRequest(FC({ groupMode: "line", botNick: "pingbot" }), groups, text);
  assert.equal(req.text, text);
  assert.deepEqual(req, {
    mode: "line",
    groups: [{ name: "caps", address: "caps@broadcast.ejemplo.com" }],
    linePrefix: "!ping {grupo}",
    botJid: "pings-bot@salas.ejemplo.com",
    botNick: "pingbot",
    channelType: "groupchat",
    text,
  });
  const r2 = c.buildRequest(FC({ sentPattern: "Broadcast sent", rejectedPattern: "/not allowed/i", channel: { accountId: "a1", jid: "bot@ejemplo.com", kind: "chat" } }), groups, "x");
  assert.equal(r2.sentPattern, "Broadcast sent");
  assert.equal(r2.rejectedPattern, "/not allowed/i");
  assert.equal(r2.channelType, "chat");
});

test("resultados: el modo web es «copiado», nunca enviado; lo desconocido no cuenta como enviado", () => {
  const web = c.webResults([{ name: "all" }, { name: "caps" }]);
  assert.deepEqual(web.map((r) => r.status), ["copied", "copied"]);
  assert.deepEqual(c.summarize(web), { total: 2, sent: 0, rejected: 0, copied: 2, allSent: false });
  const mixed = [{ status: "sent" }, { status: "delivered" }, { status: "rejected" }, { status: "accepted" }, { status: "loquesea" }];
  assert.deepEqual(c.summarize(mixed), { total: 5, sent: 2, rejected: 1, copied: 0, allSent: false });
  assert.equal(c.statusTone("loquesea"), "warn");
  assert.equal(c.statusTone("unconfirmed"), "warn");
  assert.equal(c.statusTone("delivered"), "ok-soft");
  assert.equal(c.summarize([{ status: "sent" }]).allSent, true);
  assert.equal(c.summarize([]).allSent, false);
});

test("invisibleRuns marca cada invisible y al unirlos sale el texto exacto", () => {
  const text = `~~~ ${ZW}STRAT OP${ZWJ} ~~~\nDoctrine: Fer${String.fromCharCode(0x200c)}ox`;
  const runs = c.invisibleRuns(text);
  assert.equal(runs.map((r) => r.text).join(""), text);
  assert.deepEqual(runs.filter((r) => r.inv).map((r) => r.inv), ["ZWSP", "ZWJ", "ZWNJ"]);
  assert.equal(c.countInvisible(text), 3);
  assert.equal(c.countInvisible("nada raro"), 0);
  assert.deepEqual(c.invisibleRuns(""), []);
});

test("aviso de varios grupos: cuál toca y si va en la confirmación o en el resultado", () => {
  assert.equal(c.multiGroupWarning("line", 1), null);
  assert.equal(c.multiGroupWarning("address", 0), null);
  assert.equal(c.multiGroupWarning("line", 2), "multi");
  assert.equal(c.multiGroupWarning("address", 3), "multi");
  assert.equal(c.multiGroupWarning("web", 2), "multi-web");
  assert.equal(c.multiGroupWarning("web", 1), null);
  assert.equal(c.needsConfirm({ confirm: true, confirmMulti: false }, 1), true);
  assert.equal(c.needsConfirm({ confirm: false, confirmMulti: true }, 2), true);
  assert.equal(c.needsConfirm({ confirm: false, confirmMulti: true }, 1), false);
  // Las dos apagadas: no hay confirmación y el aviso sale en el resultado.
  assert.equal(c.needsConfirm({ confirm: false, confirmMulti: false }, 3), false);
});
