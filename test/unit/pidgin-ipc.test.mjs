// Importación de Pidgin por IPC (pidgin-ipc.js): buscar, importar cuentas, salas, contraseñas e historial, y la
// reparación del historial importado con versiones anteriores. Usa un perfil de Pidgin de mentira (EVEX_PURPLE_DIR)
// y una carpeta de datos temporal; config.json se carga una sola vez por proceso, así que es la misma para todo el fichero.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, safeStorage } from "electron";
import { registerPidginIpc } from "../../src/main/pidgin-ipc.js";
import { Logs } from "../../src/main/logs.js";
import * as store from "../../src/main/store.js";

const JID = "piloto@example.com";
let root;
let data;
let purple;
let logs;
let handlers;
let sent;
const savedPurple = process.env.EVEX_PURPLE_DIR;

function onPlatform(t, platform) {
  const saved = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  t.after(() => Object.defineProperty(process, "platform", saved));
}

const ACCOUNTS_XML = `<?xml version='1.0' encoding='UTF-8' ?>
<account version='1.0'>
  <account>
    <protocol>prpl-jabber</protocol>
    <name>${JID}/casa</name>
    <password>secreta</password>
    <alias>Piloto</alias>
    <settings>
      <setting name='connect_server' type='string'>xmpp.example.com</setting>
      <setting name='port' type='int'>5223</setting>
      <setting name='connection_security' type='string'>old_ssl</setting>
      <setting name='auto-login' type='bool'>0</setting>
    </settings>
  </account>
  <account>
    <protocol>prpl-irc</protocol>
    <name>alguien@irc.example.org</name>
  </account>
</account>`;

const BLIST_XML = `<?xml version='1.0' encoding='UTF-8' ?>
<purple version='1.0'><blist><group name='Salas'>
  <chat proto='prpl-jabber' account='${JID}/casa'>
    <alias>Operaciones</alias>
    <component name='room'>ops</component>
    <component name='server'>conference.example.com</component>
    <component name='handle'>PilotoFC</component>
    <setting name='gtk-autojoin' type='bool'>1</setting>
  </chat>
</group></blist></purple>`;

const LOG = '<html><body><h3>Conversación</h3>\n<font size="2">(10:00:00)</font> <b>ana:</b> hola desde Pidgin\n<font size="2">(10:01:00)</font> <b>Piloto:</b> respuesta\n</body></html>\n';

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "evex-pidgin-ipc-"));
  data = path.join(root, "datos");
  purple = path.join(root, ".purple");
  fs.mkdirSync(data);
  fs.mkdirSync(path.join(purple, "logs", "jabber", JID, "ana@example.com"), { recursive: true });
  fs.writeFileSync(path.join(purple, "accounts.xml"), ACCOUNTS_XML);
  fs.writeFileSync(path.join(purple, "blist.xml"), BLIST_XML);
  fs.writeFileSync(path.join(purple, "logs", "jabber", JID, "ana@example.com", "2026-01-02.100000+0000UTC.html"), LOG);
  process.env.EVEX_PURPLE_DIR = purple;
  app.testUserData = data;
  logs = new Logs(path.join(data, "logs"));
  handlers = {};
  sent = [];
  registerPidginIpc((name, fn) => (handlers[name] = fn), { logs, send: (ch, payload) => sent.push([ch, payload]), publicAccount: (a) => ({ id: a.id, jid: a.jid, alias: a.alias, rooms: a.rooms }) });
});

after(() => {
  store.flush();
  delete app.testUserData;
  delete safeStorage.encryptStringAsync;
  if (savedPurple === undefined) delete process.env.EVEX_PURPLE_DIR;
  else process.env.EVEX_PURPLE_DIR = savedPurple;
  fs.rmSync(root, { recursive: true, force: true });
});

test("pidgin:scan encuentra la cuenta XMPP, sus salas y su historial, sin la contraseña", () => {
  const r = handlers["pidgin:scan"]();
  assert.equal(r.found, true);
  assert.equal(r.accounts.length, 1, "la cuenta de IRC no cuenta");
  const [a] = r.accounts;
  assert.equal(a.jid, JID);
  assert.equal(a.password, undefined);
  assert.equal(a.hasPassword, true);
  assert.deepEqual([a.host, a.port, a.security, a.autoLogin], ["xmpp.example.com", 5223, "direct", false]);
  assert.deepEqual(a.rooms, [{ jid: "ops@conference.example.com", name: "Operaciones", nick: "PilotoFC", password: "", autojoin: true, favorite: true }]);
  assert.equal(a.logConversations, 1);
  assert.equal(r.imported, 0);
});

test("pidgin:repairStatus no ofrece reparar si no hay nada importado con una versión anterior", () => {
  assert.deepEqual(handlers["pidgin:repairStatus"](), { offer: false });
});

test("pidgin:repairLogs sin cuentas importadas no hace nada", async () => {
  assert.deepEqual(await handlers["pidgin:repairLogs"](), { accounts: 0 });
});

test("pidgin:import crea la cuenta con sus salas, guarda la contraseña e importa el historial", async (t) => {
  onPlatform(t, "win32");
  safeStorage.encryptStringAsync = async (s) => Buffer.from(`v11${s}`);
  const r = await handlers["pidgin:import"]({ jids: [JID], importPasswords: true, importRooms: true, importLogs: true });
  assert.equal(r.results.length, 1);
  const res = r.results[0];
  assert.equal(res.jid, JID);
  assert.equal(res.rooms, 1);
  assert.equal(res.password, true);
  assert.equal(res.passwordNotSaved, undefined);
  assert.deepEqual(res.logs, { conversations: 1, messages: 2 });
  const acc = store.get().accounts.find((a) => a.jid === JID);
  assert.equal(acc.alias, "Piloto");
  assert.equal(acc.nick, "Piloto");
  assert.equal(acc.host, "xmpp.example.com");
  assert.deepEqual(
    acc.rooms.map((x) => x.jid),
    ["ops@conference.example.com"],
  );
  assert.deepEqual(r.accounts, [{ id: acc.id, jid: JID, alias: "Piloto", rooms: acc.rooms }]);
  // El historial queda en el formato de la app, y el fichero marcado como importado con las reglas actuales (2).
  const entries = logs.tail(acc.id, "ana@example.com", 10);
  assert.deepEqual(
    entries.map((e) => [e.nick, e.body, !!e.out]),
    [
      ["ana", "hola desde Pidgin", false],
      ["Piloto", "respuesta", true],
    ],
  );
  assert.ok(Object.values(store.get().imported).every((v) => v === 2));
  assert.deepEqual(sent.at(-1), ["import-progress", { done: 1, total: 1, conv: "ana@example.com" }]);
  assert.equal(handlers["pidgin:scan"]().imported, 1);
});

test("importar otra vez no duplica salas ni historial y respeta el alias y el nick que ya tenía", async () => {
  const acc = store.get().accounts.find((a) => a.jid === JID);
  store.upsertAccount({ ...acc, alias: "Mi alias", nick: "MiNick" });
  const r = await handlers["pidgin:import"]({ jids: [JID], importPasswords: false, importRooms: true, importLogs: true });
  const again = store.get().accounts.find((a) => a.jid === JID);
  assert.equal(again.id, acc.id);
  assert.equal(again.alias, "Mi alias");
  assert.equal(again.nick, "MiNick");
  assert.equal(again.rooms.length, 1);
  assert.deepEqual(r.results[0].logs, { conversations: 1, messages: 0 });
  assert.equal(r.results[0].password, false);
  assert.equal(store.get().accounts.filter((a) => a.jid === JID).length, 1);
  // Las cuentas no pedidas no se importan.
  assert.deepEqual((await handlers["pidgin:import"]({ jids: ["otro@example.com"], importPasswords: false, importRooms: false, importLogs: false })).results, []);
});

test("pidgin:repairStatus ofrece reparar lo importado con una versión anterior, y solo una vez", () => {
  const imported = store.get().imported;
  for (const k of Object.keys(imported)) imported[k] = 1;
  assert.deepEqual(handlers["pidgin:repairStatus"](), { offer: true });
  assert.equal(handlers["pidgin:repairOffered"](), true);
  assert.equal(store.get().imported.__repairOffered, 1);
  assert.deepEqual(handlers["pidgin:repairStatus"](), { offer: false });
});

test("pidgin:repairLogs copia antes el historial y repara las cuentas con registros de Pidgin", async () => {
  const r = await handlers["pidgin:repairLogs"]();
  assert.equal(r.accounts, 1);
  // Lo importó esta versión, así que no hay nada que corregir: solo cuenta las conversaciones que cambian.
  assert.deepEqual([r.conversations, r.fixed, r.removed], [0, 0, 0]);
  assert.match(r.backup, /^logs-copia-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/);
  const acc = store.get().accounts.find((a) => a.jid === JID);
  assert.ok(fs.existsSync(path.join(data, r.backup, acc.id)), "la copia lleva el historial de la cuenta");
  assert.equal(store.get().imported.__logsRepaired, 1);
});

// Último: en Linux sin llavero se recuerda en todo el proceso que no hay dónde guardar contraseñas.
test("en Linux sin llavero la cuenta se importa igual, sin la contraseña", async (t) => {
  onPlatform(t, "linux");
  safeStorage.encryptStringAsync = async (s) => Buffer.from(`v10${s}`);
  const r = await handlers["pidgin:import"]({ jids: [JID], importPasswords: true, importRooms: false, importLogs: false });
  assert.equal(r.results[0].password, false);
  assert.equal(r.results[0].passwordNotSaved, "no-keyring");
  assert.equal(r.results[0].logs, null);
});
