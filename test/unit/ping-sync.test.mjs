// Revisión de pings perdidos (ping-sync.js): de los registros de Pidgin y del archivo del servidor (XEP-0313), en
// cola, sin duplicar y avisando solo cuando hace falta. El módulo guarda estado (última revisión de Pidgin, la lista
// de cuentas de Pidgin), así que los tests van en orden y comparten la misma carpeta de datos.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { configurePingSync, syncPings } from "../../src/main/ping-sync.js";
import { Logs } from "../../src/main/logs.js";
import * as store from "../../src/main/store.js";

const JID = "piloto@example.com";
const BOT = "pingbot@example.com";
const PING = "Capital fleet up now!!\nFC Name: Bob FC\n\n~~~ This was a coord broadcast from bob to all at 2026-11-05 10:15:00 EVE ~~~";
const ARCHIVED = "Subcaps form up in Jita\n\n~~~ This was a coord broadcast from ana to all at 2026-11-05 11:00:00 EVE ~~~";

let root;
let logs;
let recovered;
let conn;
const savedPurple = process.env.EVEX_PURPLE_DIR;
const settings = () => store.get().settings;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "evex-ping-sync-"));
  const data = path.join(root, "datos");
  const purple = path.join(root, ".purple");
  fs.mkdirSync(data);
  const botDir = path.join(purple, "logs", "jabber", JID, BOT);
  fs.mkdirSync(botDir, { recursive: true });
  fs.writeFileSync(
    path.join(purple, "accounts.xml"),
    `<?xml version='1.0' encoding='UTF-8' ?><account version='1.0'><account><protocol>prpl-jabber</protocol><name>${JID}/casa</name><alias>Piloto</alias></account></account>`,
  );
  // Pidgin estaba conectado y recibió un ping (y escribió una respuesta tuya, que no es un ping).
  fs.writeFileSync(
    path.join(botDir, "2026-11-05.101500+0000UTC.html"),
    `<html><body><h3>Conversación con ${BOT}</h3>\n<font size="2">(10:15:00)</font> <b>${BOT}/bot:</b> ${PING.replace(/\n/g, "<br/>")}<br/>\n<font size="2">(10:16:00)</font> <b>Piloto:</b> recibido<br/>\n</body></html>\n`,
  );
  process.env.EVEX_PURPLE_DIR = purple;
  app.testUserData = data;
  const cfg = store.get();
  cfg.accounts.push({ id: "acc1", jid: JID, alias: "Piloto" }, { id: "acc2", jid: "otra@example.org", alias: "" });
  cfg.settings.pingSenders = ["pingbot"];
  logs = new Logs(path.join(data, "logs"));
  recovered = [];
  conn = { online: false, mam: false, roster: new Map(), archive: [], starts: [], fetchArchive: async (jid, start) => (conn.starts.push([jid, start]), conn.archive) };
  configurePingSync({ accounts: new Map([["acc1", conn]]), logs, onRecovered: (n) => recovered.push(n) });
});

after(() => {
  delete app.testUserData;
  if (savedPurple === undefined) delete process.env.EVEX_PURPLE_DIR;
  else process.env.EVEX_PURPLE_DIR = savedPurple;
  fs.rmSync(root, { recursive: true, force: true });
});

test("sin remitentes de pings no se revisa nada", async () => {
  settings().pingSenders = [];
  try {
    assert.deepEqual(await syncPings(), { added: 0, pidgin: false, accounts: [] });
  } finally {
    settings().pingSenders = ["pingbot"];
  }
  assert.deepEqual(recovered, []);
});

test("con la recuperación de Pidgin apagada no se leen sus registros", async () => {
  settings().pingRecovery = { ...(settings().pingRecovery || {}), pidgin: false };
  try {
    const r = await syncPings({ server: false });
    assert.equal(r.pidgin, false);
    assert.equal(r.added, 0);
  } finally {
    settings().pingRecovery.pidgin = true;
  }
});

test("recupera de Pidgin el ping de la cuenta, con el nombre del contacto, y avisa", async () => {
  conn.roster.set(BOT, { name: "Ping Bot" });
  const r = await syncPings({ server: false });
  assert.equal(r.pidgin, true);
  assert.equal(r.added, 1);
  assert.deepEqual(
    r.accounts.map((a) => [a.account, a.online, a.mam, a.pidgin, a.server, a.error]),
    [
      ["Piloto", false, false, 1, 0, ""],
      ["otra@example.org", false, false, 0, 0, ""],
    ],
  );
  const saved = logs.tail("acc1", BOT, 10);
  assert.equal(saved.length, 1, "tu respuesta en Pidgin no es un ping");
  assert.equal(saved[0].nick, "Ping Bot");
  assert.ok(saved[0].body.startsWith("Capital fleet up now!!"));
  assert.deepEqual(recovered, [1]);
});

test("una segunda revisión no duplica lo ya recuperado ni vuelve a avisar", async () => {
  const r = await syncPings({ server: false });
  assert.equal(r.added, 0);
  assert.equal(logs.tail("acc1", BOT, 10).length, 1);
  assert.deepEqual(recovered, [1]);
});

test("sin conexión o sin archivo en el servidor, no se le pide nada", async () => {
  conn.online = true;
  conn.mam = false;
  await syncPings();
  conn.online = false;
  conn.mam = true;
  await syncPings();
  assert.deepEqual(conn.starts, []);
});

test("pide al archivo del servidor desde un minuto antes del último ping guardado y añade solo lo que falta", async () => {
  conn.online = true;
  conn.mam = true;
  const last = logs.lastTimestamp("acc1", BOT);
  conn.archive = [
    // La misma copia que ya trajo Pidgin (un segundo de diferencia): no se duplica.
    { ts: last + 1000, body: PING, jid: BOT },
    { ts: Date.now() - 60e3, body: ARCHIVED, jid: BOT },
  ];
  const r = await syncPings({ notify: false });
  assert.equal(r.accounts[0].server, 1);
  assert.equal(r.added, 1);
  const [jid, start] = conn.starts.at(-1);
  assert.equal(jid, BOT);
  assert.equal(start, last - 60e3);
  assert.deepEqual(
    logs.tail("acc1", BOT, 10).map((e) => e.body.split("\n")[0]).sort(),
    ["Capital fleet up now!!", "Subcaps form up in Jita"],
  );
  // notify: false (el botón ya enseña el resultado): no hay aviso.
  assert.deepEqual(recovered, [1]);
});

test("un error del servidor se apunta en la cuenta y no para la revisión", async () => {
  conn.fetchArchive = async () => {
    throw new Error("item-not-found");
  };
  const r = await syncPings();
  assert.equal(r.accounts[0].error, "item-not-found");
  assert.equal(r.accounts[1].error, "");
  assert.equal(r.added, 0);
});

test("con la recuperación del servidor apagada no se le pide nada", async () => {
  let asked = 0;
  conn.fetchArchive = async () => (asked++, []);
  settings().pingRecovery = { ...(settings().pingRecovery || {}), server: false };
  try {
    await syncPings();
  } finally {
    settings().pingRecovery.server = true;
  }
  assert.equal(asked, 0);
});

test("las revisiones van en cola: dos a la vez no guardan el mismo ping dos veces", async () => {
  const LATE = "Late ping\n\n~~~ This was a coord broadcast from bob to all at 2026-11-05 12:00:00 EVE ~~~";
  let running = 0;
  let overlap = false;
  conn.fetchArchive = async () => {
    running++;
    if (running > 1) overlap = true;
    await new Promise((r) => setTimeout(r, 20));
    running--;
    return [{ ts: Date.now() - 1000, body: LATE, jid: BOT }];
  };
  const [a, b] = await Promise.all([syncPings(), syncPings()]);
  assert.equal(overlap, false);
  assert.equal(a.added + b.added, 1);
  assert.equal(logs.tail("acc1", BOT, 10).filter((e) => e.body === LATE).length, 1);
  assert.deepEqual(recovered, [1, 1]);
});

test("si una revisión falla, la siguiente de la cola sigue funcionando", async () => {
  configurePingSync({ logs: null });
  await assert.rejects(syncPings({ server: false }));
  configurePingSync({ logs });
  const r = await syncPings({ server: false });
  assert.equal(r.pidgin, true);
});

test("con EVEX_DEBUG escribe el resumen de la revisión", async (t) => {
  const lines = [];
  t.mock.method(console, "log", (...a) => lines.push(a.join(" ")));
  process.env.EVEX_DEBUG = "1";
  try {
    await syncPings({ server: false });
  } finally {
    delete process.env.EVEX_DEBUG;
  }
  assert.ok(lines.some((l) => l.startsWith("[pings]") && l.includes('"server":false')), lines.join("\n"));
});

test("al servidor no se le piden más de 7 días aunque el último ping guardado sea más antiguo", async () => {
  const OLD = "pingbot2@example.com";
  settings().pingSenders = ["pingbot", OLD];
  logs.append("acc1", OLD, { ts: Date.now() - 30 * 86400e3, nick: "viejo", body: "ping de hace un mes" });
  conn.starts = [];
  conn.fetchArchive = async (jid, start) => (conn.starts.push([jid, start]), []);
  const before = Date.now();
  try {
    await syncPings({ notify: false });
  } finally {
    settings().pingSenders = ["pingbot"];
  }
  const [, start] = conn.starts.find(([jid]) => jid === OLD);
  assert.ok(start >= before - 7 * 86400e3 && start <= Date.now() - 7 * 86400e3, String(start));
});
