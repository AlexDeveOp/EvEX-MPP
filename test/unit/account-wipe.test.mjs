// Borrar la cuenta con sus datos (main/account-wipe.js) y rechazos del servidor que pueden ser una revocación
// (xmpp-account.js: account-disabled y credentials-expired paran los reintentos y avisan; los errores de red no).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { XmppAccount, RECONNECT, authRejection, isNetworkError } from "../../src/main/xmpp-account.js";
import { wipeAccount, nextAuthFailures, wipeAccountSettings, wipeImportMarks, wipeConnLogLines, wipeOwnAvatar, accountDirs, isInside, ownMessageKeys } from "../../src/main/account-wipe.js";
import { Logs } from "../../src/main/logs.js";
import { tempDir } from "./helpers.mjs";

const HASH_A = "a".repeat(40);
const HASH_B = "b".repeat(40);
const HASH_C = "c".repeat(40);
const msg = (nick, body, ts) => ({ ts, nick, body });
const jsonl = (list) => list.map((e) => JSON.stringify({ ...e, key: Logs.key(e) })).join("\n") + "\n";

// Perfil de prueba con dos cuentas (A, que se borra, y B, que se queda) y un fichero fuera de userData.
function profile(t) {
  const root = tempDir(t);
  const ud = path.join(root, "userData");
  const outside = path.join(root, "pidgin-logs", "a@test.local", "sala.txt");
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, "registro de Pidgin");
  const shared = msg("bot", "Fleet up 19:00", 1_700_000_000_000);
  const onlyA = msg("bot", "Ping solo de A", 1_700_000_100_000);
  const onlyB = msg("bot", "Ping solo de B", 1_700_000_200_000);
  fs.mkdirSync(path.join(ud, "logs", "A"), { recursive: true });
  fs.mkdirSync(path.join(ud, "logs", "B"), { recursive: true });
  fs.writeFileSync(path.join(ud, "logs", "A", "bot%40test.local.jsonl"), jsonl([shared, onlyA]));
  fs.writeFileSync(path.join(ud, "logs", "B", "bot%40test.local.jsonl"), jsonl([shared, onlyB]));
  fs.mkdirSync(path.join(ud, "logs-copia-2026-11-01-10-00-00", "A"), { recursive: true });
  fs.mkdirSync(path.join(ud, "logs-copia-2026-11-01-10-00-00", "B"), { recursive: true });
  fs.writeFileSync(path.join(ud, "logs-copia-2026-11-01-10-00-00", "A", "x.jsonl"), jsonl([onlyA]));
  fs.writeFileSync(path.join(ud, "logs-copia-2026-11-01-10-00-00", "B", "x.jsonl"), jsonl([onlyB]));
  fs.writeFileSync(path.join(ud, "connection.log"), "2026-11-06T10:00:00.000Z [A] online\n2026-11-06T10:00:01.000Z [B] online\n2026-11-06T10:00:02.000Z [A] stop\n");
  fs.writeFileSync(path.join(ud, "connection.old.log"), "2026-11-05T10:00:00.000Z [A] online\n");
  const av = path.join(ud, "media", "avatars");
  fs.mkdirSync(av, { recursive: true });
  for (const h of [HASH_A, HASH_B, HASH_C]) fs.writeFileSync(path.join(av, `${h}.png`), "png");
  const [kShared, kA, kB] = [shared, onlyA, onlyB].map(Logs.key);
  const settings = {
    notifications: { roomModes: { "A|sala@conference.test.local": "none", "B|sala@conference.test.local": "all", "AB|x": "all" } },
    conversationBackgrounds: { "A|bot@test.local": { type: "color" }, "B|bot@test.local": { type: "color" } },
    openTabs: [{ accountId: "A", conv: "bot@test.local" }, { accountId: "B", conv: "bot@test.local" }],
    srp: { marks: { [kShared]: { status: "pending" }, [kA]: { status: "pending" }, [kB]: { status: "pending" } } },
    fleets: {
      items: {
        "m-1": { origin: { accountId: "A", conv: "sala" } },
        "m-2": { origin: { accountId: "B", conv: "sala" } },
        "m-3": { source: "manual" },
        "m-4": { pingKeys: [kA] },
        "m-5": { pingKeys: [kShared] },
      },
      overrides: { [`p-${kShared}`]: { title: "x" }, [`p-${kA}`]: { title: "y" }, [`p-${kB}`]: { title: "z" } },
      dismissed: { [kA]: 1, [kB]: 1 },
    },
  };
  const imported = { [outside]: 2, [path.join(root, "pidgin-logs", "b@test.local", "sala.txt")]: 2, __logsRepaired: 1 };
  return { root, ud, av, outside, settings, imported, keys: { kShared, kA, kB } };
}

test("isInside no deja salir de la carpeta ni acepta la propia carpeta", () => {
  assert.equal(isInside("/d/ud", "/d/ud/logs/A"), true);
  assert.equal(isInside("/d/ud", "/d/ud"), false);
  assert.equal(isInside("/d/ud", "/d/ud/../otra/A"), false);
  assert.equal(isInside("/d/ud", "/d/udx/A"), false);
});

test("accountDirs: logs/<id> y las copias, nunca rutas raras", (t) => {
  const p = profile(t);
  const dirs = accountDirs(p.ud, "A").map((d) => path.relative(p.ud, d).replaceAll("\\", "/"));
  assert.deepEqual(dirs.sort(), ["logs-copia-2026-11-01-10-00-00/A", "logs/A"]);
  // Un id con .. no puede salirse.
  assert.equal(accountDirs(p.ud, "../userData").length, 0);
});

test("las claves de un ping que también tiene otra cuenta no cuentan como de la cuenta", (t) => {
  const p = profile(t);
  const keys = ownMessageKeys(path.join(p.ud, "logs"), "A", ["B"]);
  assert.deepEqual([...keys], [p.keys.kA]);
});

test("wipeAccountSettings quita solo lo de la cuenta", (t) => {
  const p = profile(t);
  const s = p.settings;
  wipeAccountSettings(s, "A", new Set([p.keys.kA]));
  assert.deepEqual(Object.keys(s.notifications.roomModes).sort(), ["AB|x", "B|sala@conference.test.local"]);
  assert.deepEqual(Object.keys(s.conversationBackgrounds), ["B|bot@test.local"]);
  assert.deepEqual(s.openTabs, [{ accountId: "B", conv: "bot@test.local" }]);
  assert.deepEqual(Object.keys(s.srp.marks).sort(), [p.keys.kShared, p.keys.kB].sort());
  assert.deepEqual(Object.keys(s.fleets.items).sort(), ["m-2", "m-3", "m-5"]);
  assert.deepEqual(Object.keys(s.fleets.overrides).sort(), [`p-${p.keys.kShared}`, `p-${p.keys.kB}`].sort());
  assert.deepEqual(Object.keys(s.fleets.dismissed), [p.keys.kB]);
});

test("wipeImportMarks quita las marcas de los registros de Pidgin de la cuenta, no los registros", (t) => {
  const p = profile(t);
  assert.equal(wipeImportMarks(p.imported, "A@test.local"), 1);
  assert.deepEqual(Object.keys(p.imported).map((k) => (k.startsWith("__") ? k : path.basename(path.dirname(k)))).sort(), ["__logsRepaired", "b@test.local"]);
  assert.ok(fs.existsSync(p.outside));
});

test("wipeConnLogLines quita solo las líneas de la cuenta", (t) => {
  const p = profile(t);
  const files = ["connection.log", "connection.old.log", "no-existe.log"].map((f) => path.join(p.ud, f));
  assert.equal(wipeConnLogLines(files, "A"), 3);
  assert.equal(fs.readFileSync(files[0], "utf8"), "2026-11-06T10:00:01.000Z [B] online\n");
  assert.equal(fs.readFileSync(files[1], "utf8"), "");
});

test("wipeOwnAvatar borra el avatar propio, salvo que otra cuenta use el mismo, y nada más", (t) => {
  const p = profile(t);
  assert.equal(wipeOwnAvatar(p.av, HASH_A, [HASH_A]), 0);
  assert.equal(wipeOwnAvatar(p.av, "../../config", []), 0);
  assert.equal(wipeOwnAvatar(p.av, HASH_A, [HASH_B]), 1);
  assert.deepEqual(fs.readdirSync(p.av).sort(), [`${HASH_B}.png`, `${HASH_C}.png`]);
});

test("wipeAccount: borra todo lo de la cuenta, deja lo de las demás y lo de fuera", async (t) => {
  const p = profile(t);
  const logs = new Logs(path.join(p.ud, "logs"));
  logs.recentIndex(logs.file("A", "bot@test.local"));
  logs.recentIndex(logs.file("B", "bot@test.local"));
  const calls = [];
  const r = await wipeAccount({
    userData: p.ud,
    logs,
    settings: p.settings,
    imported: p.imported,
    accountId: "A",
    jid: "a@test.local",
    otherIds: ["B"],
    ownAvatarHash: HASH_A,
    otherAvatarHashes: [HASH_B],
    avatarDir: p.av,
    connLogFiles: [path.join(p.ud, "connection.log"), path.join(p.ud, "connection.old.log")],
    removeSecrets: async () => calls.push("secrets"),
    removeAccount: () => calls.push("account"),
  });
  assert.deepEqual(r.failed, []);
  assert.deepEqual(calls, ["secrets", "account"]);
  assert.equal(fs.existsSync(path.join(p.ud, "logs", "A")), false);
  assert.equal(fs.existsSync(path.join(p.ud, "logs-copia-2026-11-01-10-00-00", "A")), false);
  assert.ok(fs.existsSync(path.join(p.ud, "logs", "B", "bot%40test.local.jsonl")));
  assert.ok(fs.existsSync(path.join(p.ud, "logs-copia-2026-11-01-10-00-00", "B", "x.jsonl")));
  assert.ok(fs.existsSync(p.outside), "los registros de Pidgin no se tocan");
  assert.equal(fs.existsSync(path.join(p.av, `${HASH_A}.png`)), false);
  assert.ok(fs.existsSync(path.join(p.av, `${HASH_C}.png`)), "los avatares de los contactos se quedan");
  assert.equal([...logs.recent.keys()].length, 1);
  assert.doesNotMatch(fs.readFileSync(path.join(p.ud, "connection.log"), "utf8"), /\[A\]/);
});

test("wipeAccount: si un paso falla, lo dice y la cuenta se queda en la lista", async (t) => {
  const p = profile(t);
  const calls = [];
  const r = await wipeAccount({
    userData: p.ud,
    logs: new Logs(path.join(p.ud, "logs")),
    settings: p.settings,
    imported: p.imported,
    accountId: "A",
    jid: "a@test.local",
    otherIds: ["B"],
    avatarDir: p.av,
    removeSecrets: async () => {
      throw new Error("llavero bloqueado");
    },
    removeAccount: () => calls.push("account"),
  });
  assert.deepEqual(r.failed, [{ step: "secrets", message: "llavero bloqueado" }]);
  assert.deepEqual(calls, [], "no se quita la cuenta de la lista");
  assert.equal(fs.existsSync(path.join(p.ud, "logs", "A")), false, "lo demás sí se ha hecho");
});

test("authRejection: solo los rechazos SASL, nunca los errores de red", () => {
  const sasl = (condition) => Object.assign(new Error(condition), { name: "SASLError", condition });
  assert.equal(authRejection(sasl("account-disabled")), "account-disabled");
  assert.equal(authRejection(sasl("credentials-expired")), "credentials-expired");
  assert.equal(authRejection(sasl("not-authorized")), "not-authorized");
  assert.equal(authRejection(Object.assign(new Error("x"), { cause: sasl("account-disabled") })), "account-disabled");
  assert.equal(authRejection(sasl("temporary-auth-failure")), null);
  assert.equal(authRejection(Object.assign(new Error("reset"), { code: "ECONNRESET" })), null);
  // Una condición con el mismo nombre que no viene de SASL tampoco cuenta.
  assert.equal(authRejection({ condition: "account-disabled" }), null);
  assert.equal(isNetworkError(sasl("account-disabled")), false);
  assert.equal(isNetworkError(Object.assign(new Error("reset"), { code: "ECONNRESET" })), true);
});

test("nextAuthFailures: avisa desde el segundo rechazo de la contraseña o desde el primero si está desactivada", () => {
  const rej = (condition) => ({ type: "auth-rejected", condition });
  assert.deepEqual(nextAuthFailures(0, rej("not-authorized")), { count: 1, notify: false });
  assert.deepEqual(nextAuthFailures(1, rej("not-authorized")), { count: 2, notify: true });
  assert.deepEqual(nextAuthFailures(0, rej("account-disabled")), { count: 1, notify: true });
  assert.deepEqual(nextAuthFailures(0, rej("credentials-expired")), { count: 1, notify: true });
  // Los errores de red y los cortes no lo tocan; solo conectar bien lo pone a 0.
  for (const state of ["error", "reconnecting", "connecting", "offline"]) assert.deepEqual(nextAuthFailures(1, { type: "status", state }), { count: 1, notify: false });
  assert.deepEqual(nextAuthFailures(3, { type: "status", state: "online" }), { count: 0, notify: false });
  assert.deepEqual(nextAuthFailures("x", { type: "message" }), { count: 0, notify: false });
});

// ---- contra el servidor simulado ----

const MOCK = 18850 + Math.floor(Math.random() * 400);
let mock;
const authLines = [];
const saved = { ...RECONNECT };
before(async () => {
  Object.assign(RECONNECT, { PING_EVERY: 400, PING_TIMEOUT: 400, STALL: 1200, SUPERVISE_EVERY: 200, MAX_DELAY: 800 });
  mock = spawn(process.execPath, [fileURLToPath(new URL("../mock-xmpp.mjs", import.meta.url))], { env: { ...process.env, MOCK_PORT: String(MOCK) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    mock.once("exit", (code) => reject(new Error(`el servidor simulado terminó (${code})`)));
    mock.stdout.on("data", (d) => {
      authLines.push(...String(d).split("\n").filter((l) => l.includes("auth rechazada")));
      if (String(d).includes("mock XMPP en")) resolve();
    });
  });
});
after(() => {
  Object.assign(RECONNECT, saved);
  mock?.kill();
});

function account(t, user, port = MOCK) {
  const acc = new XmppAccount({ id: user, jid: `${user}@test.local`, host: "127.0.0.1", port, security: "opportunistic" }, { avatarDir: tempDir(t), version: "1" });
  acc.states = [];
  acc.rejections = [];
  acc.on("event", (e) => {
    if (e.type === "status") acc.states.push(e.state);
    if (e.type === "auth-rejected") acc.rejections.push(e.condition);
  });
  t.after(() => acc.disconnect(true).catch(() => {}));
  return acc;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rejectedFor = (user) => authLines.filter((l) => l.includes(` ${user} `) || l.endsWith(` ${user}`) || l.includes(` ${user}\t`)).length;

for (const [user, condition] of [["desactivado", "account-disabled"], ["caducado", "credentials-expired"]]) {
  test(`${condition} al entrar: un intento, estado de error y aviso`, async (t) => {
    const acc = account(t, user);
    await acc.connect("test").catch(() => {});
    await wait(2500);
    assert.deepEqual(acc.rejections, [condition]);
    assert.equal(acc.states.at(-1), "error");
    assert.equal(acc.wantOnline, false);
    assert.equal(rejectedFor(user), 1, "no reintenta");
  });
}

test("revocada estando conectada: deja de reintentar al primer rechazo", async (t) => {
  const acc = account(t, "revocable");
  await acc.connect("test");
  // El simulado corta a los 1,5 s y desde entonces rechaza la cuenta.
  for (let i = 0; i < 60 && !acc.rejections.length; i++) await wait(100);
  await wait(2500);
  assert.deepEqual(acc.rejections, ["account-disabled"]);
  assert.ok(acc.states.includes("online"));
  assert.equal(acc.states.at(-1), "error");
  assert.equal(rejectedFor("revocable"), 1, "un solo intento rechazado");
});

test("contraseña mala: avisa del rechazo (not-authorized)", async (t) => {
  const acc = account(t, "piloto");
  await acc.connect("mala").catch(() => {});
  await wait(1500);
  assert.deepEqual(acc.rejections, ["not-authorized"]);
  assert.equal(acc.states.at(-1), "error");
});

test("sin servidor (error de red): sigue reintentando y no cuenta como rechazo", async (t) => {
  const free = net.createServer();
  await new Promise((r) => free.listen(0, "127.0.0.1", r));
  const port = free.address().port;
  await new Promise((r) => free.close(r));
  const acc = account(t, "piloto", port);
  acc.connect("test").catch(() => {});
  await wait(2500);
  assert.deepEqual(acc.rejections, []);
  assert.notEqual(acc.states.at(-1), "error");
  assert.equal(acc.wantOnline, true);
});
