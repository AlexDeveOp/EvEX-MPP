import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import * as store from "../../src/main/store.js";
import { tempDir } from "./helpers.mjs";

let dir;
beforeEach((t) => {
  dir = tempDir(t);
  app.testUserData = dir;
  t.after(() => delete app.testUserData);
});
const writeConfig = (data) => fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(data));

test("el modo FC viene apagado, con confirmación y las tres pestañas", () => {
  const f = store.load().settings.fcMode;
  assert.equal(f.enabled, false);
  assert.equal(f.confirm, true);
  assert.deepEqual(f.tabs, ["quick", "template", "paste"]);
  assert.equal(f.defaultTab, "quick");
  assert.equal(f.groupMode, "address");
  assert.deepEqual(f.groups, []);
});

test("unos ajustes viejos sin fcMode arrancan con los de serie", () => {
  writeConfig({ settings: { theme: "gold" } });
  assert.deepEqual(store.load().settings.fcMode, store.DEFAULT_SETTINGS.fcMode);
});

test("normalizeFcMode arregla valores rotos o tocados a mano", () => {
  const f = store.normalizeFcMode({
    enabled: "sí",
    channel: { accountId: "a1", jid: " pings-bot@salas.ejemplo.com ", kind: "raro" },
    tabs: ["paste", "nada", "paste", "quick"],
    defaultTab: "otra",
    template: { fields: ["notes", "time", "inventado"], format: 5, signAs: "Bob FC" },
    groupMode: "tercero",
    lineFormat: null,
    groups: [{ name: " caps ", address: "caps@broadcast.ejemplo.com" }, { name: "CAPS" }, { name: "" }, null, { name: "all", button: false, manual: 1 }],
    defaultGroup: "caps",
    confirm: false,
  });
  assert.equal(f.enabled, false);
  assert.deepEqual(f.channel, { accountId: "a1", jid: "pings-bot@salas.ejemplo.com", kind: "" });
  assert.deepEqual(f.tabs, ["paste", "quick", "template"]);
  assert.equal(f.defaultTab, "quick");
  assert.deepEqual(f.template.fields, ["time", "notes"]);
  assert.equal(f.template.format, store.DEFAULT_SETTINGS.fcMode.template.format);
  assert.equal(f.template.signAs, "Bob FC");
  assert.equal(f.groupMode, "address");
  assert.equal(f.lineFormat, "!ping {grupo}");
  assert.deepEqual(f.groups, [
    { name: "caps", address: "caps@broadcast.ejemplo.com", button: true, manual: false },
    { name: "all", address: "", button: false, manual: true },
  ]);
  assert.equal(f.defaultGroup, "caps");
  assert.equal(f.confirm, false);
  assert.equal(f.confirmMulti, true);
});

test("normalizeFcMode con basura devuelve los de serie", () => {
  for (const v of [undefined, null, 3, "x", []]) assert.deepEqual(store.normalizeFcMode(v), store.DEFAULT_SETTINGS.fcMode);
});

test("setSettings guarda el modo FC normalizado", () => {
  store.load();
  const s = store.setSettings({ ...store.get().settings, fcMode: { enabled: true, groupMode: "line", tabs: ["template"] } });
  assert.equal(s.fcMode.enabled, true);
  assert.equal(s.fcMode.groupMode, "line");
  assert.deepEqual(s.fcMode.tabs, ["template", "quick", "paste"]);
  assert.equal(s.fcMode.confirm, true);
  // Se escribe ya, en la carpeta temporal: si no, el guardado con retraso caería en la del proceso al acabar el test.
  store.flush();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8")).settings.fcMode.groupMode, "line");
});

test("el formato de serie de la plantilla es el mismo en store.js y en Preferencias", async () => {
  const { DEFAULT_FORMAT, FC_FIELDS } = await import("../../src/renderer/js/settings/fc.js");
  assert.equal(DEFAULT_FORMAT, store.DEFAULT_SETTINGS.fcMode.template.format);
  assert.deepEqual(FC_FIELDS.map(([id]) => id), store.FC_FIELDS);
});

test("modo web: solo se guarda una URL http o https; el modo avanzado se limpia", () => {
  const ok = store.normalizeFcMode({ groupMode: "web", webUrl: " https://pings.ejemplo.com/enviar ", botNick: "  pingbot ", sentPattern: "/sent/i", rejectedPattern: 3 });
  assert.equal(ok.groupMode, "web");
  assert.equal(ok.webUrl, "https://pings.ejemplo.com/enviar");
  assert.equal(ok.botNick, "pingbot");
  assert.equal(ok.sentPattern, "/sent/i");
  assert.equal(ok.rejectedPattern, "");
  for (const bad of ["javascript:alert(1)", "file:///C:/x", "pings.ejemplo.com", "", null]) assert.equal(store.normalizeFcMode({ webUrl: bad }).webUrl, "", String(bad));
  assert.equal(store.normalizeFcMode({ webUrl: "http://pings.ejemplo.com" }).webUrl, "http://pings.ejemplo.com");
  assert.deepEqual(store.FC_GROUP_MODES, ["address", "line", "web"]);
});
