import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import * as store from "../../src/main/store.js";
import { tempDir } from "./helpers.mjs";

let dir;
beforeEach((t) => {
  dir = tempDir(t);
  app.testUserData = dir;
  t.after(() => delete app.testUserData);
});
const writeConfig = (data) => fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(data));

test("sin config.json arranca con los valores por defecto", () => {
  const c = store.load();
  assert.deepEqual(c.accounts, []);
  assert.deepEqual(c.imported, {});
  assert.deepEqual(c.settings, store.DEFAULT_SETTINGS);
});

test("un config.json dañado no impide arrancar", () => {
  fs.writeFileSync(path.join(dir, "config.json"), "{ esto no es JSON");
  assert.deepEqual(store.load().settings, store.DEFAULT_SETTINGS);
});

test("los ajustes guardados se mezclan con los valores por defecto sin perder los nuevos", () => {
  writeConfig({ settings: { theme: "gold", background: { type: "image", value: "x.png" }, customEmoji: [{ name: "o7", url: "a" }], futuro: 1 }, imported: { "a.html": 1 } });
  const { settings, imported } = store.load();
  assert.equal(settings.theme, "gold");
  // Un objeto guardado a medias conserva los valores por defecto de lo que falta.
  assert.equal(settings.background.type, "image");
  assert.equal(settings.background.opacity, store.DEFAULT_SETTINGS.background.opacity);
  // Las listas se sustituyen enteras, no se mezclan.
  assert.deepEqual(settings.customEmoji, [{ name: "o7", url: "a" }]);
  // Lo que no conoce esta versión se conserva (no se pierde al volver a una versión más nueva).
  assert.equal(settings.futuro, 1);
  assert.equal(settings.fontFamily, store.DEFAULT_SETTINGS.fontFamily);
  assert.deepEqual(imported, { "a.html": 1 });
});

test("guardar escribe config.json de forma atómica y se vuelve a leer igual", () => {
  store.load();
  store.setSettings({ theme: "nord", layout: { sidebarWidth: 333 } });
  store.flush();
  assert.deepEqual(fs.readdirSync(dir), ["config.json"], "no deben quedar ficheros temporales");
  const again = store.load();
  assert.equal(again.settings.theme, "nord");
  assert.equal(again.settings.layout.sidebarWidth, 333);
  assert.equal(again.settings.layout.occupantsWidth, store.DEFAULT_SETTINGS.layout.occupantsWidth);
});

test("normalizeAccount completa la cuenta y limpia el JID, las salas y las quitadas", () => {
  const a = store.normalizeAccount({ jid: "  Ana@Ejemplo.COM ", port: "5223", priority: 0, rooms: [{ jid: "Sala@Conference.Ejemplo.com" }], dismissedRooms: ["X@c.ejemplo.com", "x@c.ejemplo.com"] });
  assert.equal(a.jid, "ana@ejemplo.com");
  assert.equal(a.port, 5223);
  assert.equal(a.priority, 0, "la prioridad 0 es válida");
  assert.equal(a.nick, "ana");
  assert.equal(a.conferenceServer, "conference.ejemplo.com");
  assert.equal(a.autoLogin, true);
  assert.equal(a.security, "starttls");
  assert.ok(a.id);
  assert.deepEqual(a.rooms, [{ jid: "sala@conference.ejemplo.com", name: "Sala", nick: "", password: "", autojoin: false, favorite: true, notify: "default", group: "" }]);
  assert.deepEqual(a.dismissedRooms, ["x@c.ejemplo.com"]);
  // Volver a normalizar no cambia nada.
  assert.deepEqual(store.normalizeAccount(a), a);
});

test("upsertAccount añade o sustituye por id, y removeAccount la quita", () => {
  store.load();
  const a = store.upsertAccount({ jid: "ana@ejemplo.com" });
  store.upsertAccount({ ...a, alias: "Ana" });
  assert.equal(store.get().accounts.length, 1);
  assert.equal(store.getAccount(a.id).alias, "Ana");
  store.removeAccount(a.id);
  assert.equal(store.get().accounts.length, 0);
  store.flush();
});

test("las contraseñas nunca se guardan sin cifrar", async () => {
  // Sin cifrado del sistema, guardar falla y no escribe nada.
  await assert.rejects(store.setPassword("acc", "secreta"));
  assert.ok(!fs.existsSync(path.join(dir, "secrets.json")));
  assert.equal(store.hasPassword("acc"), false);

  // Con cifrado, lo guardado no contiene la contraseña y se recupera.
  safeStorage.encryptStringAsync = async (s) => Buffer.from(`cifrado:${[...s].reverse().join("")}`);
  safeStorage.decryptStringAsync = async (b) => ({ result: [...b.toString().slice(8)].reverse().join(""), shouldReEncrypt: false });
  try {
    await store.setPassword("acc", "secreta");
    assert.ok(!fs.readFileSync(path.join(dir, "secrets.json"), "utf8").includes("secreta"));
    assert.equal(store.hasPassword("acc"), true);
    assert.equal(await store.getPassword("acc"), "secreta");
    await store.setPassword("acc", null);
    assert.equal(store.hasPassword("acc"), false);
  } finally {
    delete safeStorage.encryptStringAsync;
    delete safeStorage.decryptStringAsync;
  }
});
