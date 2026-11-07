// Modo FC: exportar e importar la configuración entre FCs (src/main/fc-share.js y fc-share-ipc.js).
// Los invisibles se construyen con String.fromCharCode para que el fichero no lleve ninguno suelto.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { exportFcConfig, exportFcConfigText, importFcConfig, FC_SHARE_MAX_BYTES, FC_SHARE_ERRORS } from "../../src/main/fc-share.js";
import { registerFcShareIpc, FC_SHARE_DEFAULT_NAME } from "../../src/main/fc-share-ipc.js";
import { normalizeFcMode } from "../../src/main/store.js";
import { tempDir } from "./helpers.mjs";

const ZW = String.fromCharCode(0x200b);
const BOM = String.fromCharCode(0xfeff);
const NL = String.fromCharCode(10);

// Configuración de un FC con todo relleno, incluido lo personal que nunca debe salir.
const bobFc = () =>
  normalizeFcMode({
    enabled: true,
    channel: { accountId: "cuenta-de-bob-123", jid: "pingbot@ejemplo.com", kind: "chat" },
    tabs: ["paste", "quick", "template"],
    defaultTab: "template",
    template: { fields: ["fc", "time", "doctrine"], format: `${BOM}Fleet up${ZW}${NL}FC: {fc} · Doctrine: {doctrine}`, signAs: "Bob FC" },
    groupMode: "line",
    lineFormat: "!ping {grupo}",
    webUrl: "https://pings.ejemplo.com/send",
    botNick: "pingbot",
    sentPattern: "/sent to \\d+/i",
    rejectedPattern: "denied",
    groups: [
      { name: "all", address: "all@broadcast.ejemplo.com", button: true },
      { name: "caps", address: "caps@broadcast.ejemplo.com", button: false, manual: true },
    ],
    defaultGroup: "caps",
    confirm: false,
    confirmMulti: true,
  });
// La de quien importa: su cuenta, su firma y el modo apagado.
const anaFc = () => normalizeFcMode({ enabled: false, channel: { accountId: "cuenta-de-ana-9", jid: "", kind: "" }, template: { signAs: "Ana" } });
const errCode = (code) => (e) => e.code === code && e.message === `fc-share:${code}`;

test("exportar: fichero versionado y SOLO lo compartible; nada de cuenta, firma, enabled ni otros ajustes", () => {
  const out = exportFcConfig({ ...bobFc(), passwords: "x", savedPings: [{ body: "secreto" }], history: ["x"] });
  assert.deepEqual([out.app, out.kind, out.v], ["EvEX-MPP", "fc-config", 1]);
  assert.deepEqual(Object.keys(out), ["app", "kind", "v", "config"]);
  const text = exportFcConfigText(bobFc());
  for (const forbidden of ["cuenta-de-bob-123", "accountId", "signAs", "Bob FC", "enabled", "secreto", "passwords", "savedPings", "history"]) assert.ok(!text.includes(forbidden), `no sale ${forbidden}`);
  assert.deepEqual(out.config.channel, { jid: "pingbot@ejemplo.com", kind: "chat" }, "el canal del bot sí, sin la cuenta");
  assert.deepEqual(Object.keys(out.config).sort(), ["botNick", "channel", "confirm", "confirmMulti", "defaultGroup", "defaultTab", "groupMode", "groups", "lineFormat", "rejectedPattern", "sentPattern", "tabs", "template", "webUrl"]);
  assert.deepEqual(Object.keys(out.config.template).sort(), ["fields", "format"]);
});

test("ida y vuelta: lo de Bob llega a Ana tal cual (con los invisibles de la plantilla) y lo personal de Ana se queda", () => {
  const { merged, preview } = importFcConfig(exportFcConfigText(bobFc()), anaFc());
  const b = bobFc();
  for (const k of ["groupMode", "lineFormat", "webUrl", "groups", "defaultGroup", "tabs", "defaultTab", "confirm", "confirmMulti", "botNick", "sentPattern", "rejectedPattern"]) assert.deepEqual(merged[k], b[k], k);
  assert.equal(merged.template.format, b.template.format, "la plantilla tal cual");
  assert.ok(merged.template.format.startsWith(BOM) && merged.template.format.includes(ZW));
  assert.deepEqual(merged.template.fields, b.template.fields);
  assert.equal(merged.template.signAs, "Ana", "su firma");
  assert.equal(merged.enabled, false, "no se enciende solo");
  assert.deepEqual(merged.channel, { accountId: "cuenta-de-ana-9", jid: "pingbot@ejemplo.com", kind: "chat" }, "el bot de Bob con la cuenta de Ana");
  assert.deepEqual(merged, normalizeFcMode(merged), "ya normalizada");
  assert.ok(preview.changes.includes("groups") && preview.changes.includes("groupMode") && preview.changes.includes("channel"));
  assert.deepEqual(preview.groups.map((g) => g.name), ["all", "caps"]);
  assert.deepEqual(preview.warnings, []);
});

test("importar lo mismo que ya se tiene: sin cambios", () => {
  const { preview } = importFcConfig(exportFcConfigText(bobFc()), bobFc());
  assert.deepEqual(preview.changes, []);
});

test("un fichero sin canal deja el canal de quien importa; lo que falta se queda como estaba", () => {
  const cur = normalizeFcMode({ ...anaFc(), channel: { accountId: "cuenta-de-ana-9", jid: "otrobot@ejemplo.com", kind: "groupchat" }, lineFormat: "!bc {grupo}" });
  const text = JSON.stringify({ app: "EvEX-MPP", kind: "fc-config", v: 1, config: { groupMode: "address", groups: [{ name: "all", address: "all@broadcast.ejemplo.com" }] } });
  const { merged } = importFcConfig(text, cur);
  assert.deepEqual(merged.channel, cur.channel);
  assert.equal(merged.lineFormat, "!bc {grupo}");
  assert.equal(merged.groupMode, "address");
});

test("ficheros que no valen: error claro con su código", () => {
  const ok = (config, extra = {}) => JSON.stringify({ app: "EvEX-MPP", kind: "fc-config", v: 1, config, ...extra });
  assert.throws(() => importFcConfig("{no es json"), errCode("bad-json"));
  assert.throws(() => importFcConfig(null), errCode("bad-json"));
  assert.throws(() => importFcConfig("[]"), errCode("not-fc-config"));
  assert.throws(() => importFcConfig(JSON.stringify({ app: "EvEX-MPP", kind: "theme", v: 1, config: {} })), errCode("not-fc-config"), "un tema no es una configuración FC");
  assert.throws(() => importFcConfig(JSON.stringify({ app: "Otra", kind: "fc-config", v: 1, config: {} })), errCode("not-fc-config"));
  assert.throws(() => importFcConfig(ok({}, { v: 2 })), (e) => e.code === "newer-version" && e.version === 2, "de una versión futura");
  for (const v of [0, -1, 1.5, "1", null]) assert.throws(() => importFcConfig(ok({}, { v })), errCode("bad-version"), `v=${v}`);
  for (const config of [null, [], "x", 3]) assert.throws(() => importFcConfig(ok(config)), errCode("bad-config"));
  assert.throws(() => importFcConfig(ok({ groups: "all" })), errCode("bad-config"));
  assert.throws(() => importFcConfig(ok({ groups: Array.from({ length: 201 }, (_, i) => ({ name: `g${i}` })) })), errCode("too-many-groups"));
  assert.throws(() => importFcConfig(`${" ".repeat(FC_SHARE_MAX_BYTES)}{}`), errCode("too-big"));
  for (const code of ["bad-json", "not-fc-config", "newer-version", "bad-version", "bad-config", "too-many-groups", "too-big"]) assert.ok(FC_SHARE_ERRORS.includes(code));
  // Con BOM al principio (Bloc de notas) sí vale.
  assert.doesNotThrow(() => importFcConfig(BOM + ok({})));
});

test("ficheros maliciosos: URL no web, tipos cambiados, textos enormes, __proto__ y campos personales colados", () => {
  const evil = {
    webUrl: "javascript:alert(1)",
    groupMode: "rm -rf",
    lineFormat: "x".repeat(10000),
    botNick: { toString: "x" },
    tabs: ["../../etc", "quick"],
    defaultTab: "constructor",
    confirm: "no",
    groups: [{ name: "../../Windows/System32", address: "file:///C:/x" }, { name: "" }, "texto", null, { name: "caps", address: 7 }, { name: "CAPS" }],
    template: { fields: ["__proto__", "fc"], format: 12, signAs: "Mallory" },
    channel: { accountId: "cuenta-ajena", jid: "pingbot@ejemplo.com", kind: "admin" },
    enabled: true,
    __proto__: { polluted: true },
  };
  const text = `{"app":"EvEX-MPP","kind":"fc-config","v":1,"config":${JSON.stringify(evil).replace("{", '{"__proto__":{"polluted":true},')}}`;
  const { merged, preview } = importFcConfig(text, anaFc());
  assert.equal({}.polluted, undefined, "sin contaminar Object.prototype");
  assert.equal(merged.polluted, undefined);
  assert.equal(merged.webUrl, "", "javascript: no se guarda");
  assert.ok(preview.warnings.includes("web-url-dropped"));
  assert.equal(merged.groupMode, anaFc().groupMode);
  assert.equal(merged.lineFormat.length, 200, "recortado al máximo");
  assert.equal(merged.botNick, "");
  assert.deepEqual(merged.tabs, ["quick", "template", "paste"]);
  assert.equal(merged.defaultTab, anaFc().defaultTab);
  assert.equal(merged.confirm, true, "solo false lo apaga");
  assert.deepEqual(merged.groups.map((g) => g.name), ["../../Windows/System32", "caps"], "los nombres son solo texto (no rutas); vacíos, repetidos y basura fuera");
  assert.equal(merged.groups[1].address, "");
  assert.ok(preview.warnings.includes("groups-dropped"));
  assert.deepEqual(merged.template.fields, ["fc"]);
  assert.equal(merged.template.format, anaFc().template.format, "una plantilla que no es texto no se toma");
  assert.equal(merged.template.signAs, "Ana", "la firma ajena no entra");
  assert.equal(merged.channel.accountId, "cuenta-de-ana-9", "la cuenta ajena no entra");
  assert.equal(merged.channel.kind, "");
  assert.equal(merged.enabled, false, "no lo enciende");
});

// ---- IPC con un diálogo falso ----

function ipc(t, { save, open, fcMode = bobFc() } = {}) {
  const handlers = {};
  const calls = [];
  const dialog = {
    showSaveDialog: async (_w, opts) => (calls.push(["save", opts]), save),
    showOpenDialog: async (_w, opts) => (calls.push(["open", opts]), open),
  };
  registerFcShareIpc((ch, fn) => (handlers[ch] = fn), { getFcMode: () => fcMode, dialog });
  return { handlers, calls };
}

test("fc:exportFile guarda donde elige el usuario y no acepta rutas de la interfaz", async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, "para-ana.json");
  const { handlers, calls } = ipc(t, { save: { canceled: false, filePath: file } });
  // Lo que mande la interfaz se ignora: ni ruta ni configuración.
  assert.deepEqual(await handlers["fc:exportFile"](path.join(dir, "otra.json"), { channel: { accountId: "x" } }), { saved: "para-ana.json" });
  assert.equal(calls[0][1].defaultPath, FC_SHARE_DEFAULT_NAME);
  assert.ok(!fs.existsSync(path.join(dir, "otra.json")));
  const text = fs.readFileSync(file, "utf8");
  assert.equal(text, exportFcConfigText(bobFc()));
  assert.ok(!text.includes("cuenta-de-bob-123"));
  const again = ipc(t, { save: { canceled: true } });
  assert.deepEqual(await again.handlers["fc:exportFile"](), { canceled: true });
});

test("fc:importFile: vista previa sin aplicar nada; cancelar, carpetas y ficheros enormes", async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, "de-bob.json");
  fs.writeFileSync(file, exportFcConfigText(bobFc()));
  const ana = anaFc();
  const snapshot = JSON.stringify(ana);
  const { handlers } = ipc(t, { open: { canceled: false, filePaths: [file] }, fcMode: ana });
  const r = await handlers["fc:importFile"]();
  assert.equal(r.file, "de-bob.json");
  assert.equal(r.merged.channel.jid, "pingbot@ejemplo.com");
  assert.equal(JSON.stringify(ana), snapshot, "no toca la configuración actual");
  assert.deepEqual(await ipc(t, { open: { canceled: true, filePaths: [] } }).handlers["fc:importFile"](), { canceled: true });
  await assert.rejects(ipc(t, { open: { canceled: false, filePaths: [dir] } }).handlers["fc:importFile"](), errCode("bad-json"), "una carpeta no");
  const big = path.join(dir, "enorme.json");
  fs.writeFileSync(big, Buffer.alloc(FC_SHARE_MAX_BYTES + 1, 32));
  await assert.rejects(ipc(t, { open: { canceled: false, filePaths: [big] } }).handlers["fc:importFile"](), errCode("too-big"));
  const theme = path.join(dir, "tema.json");
  fs.writeFileSync(theme, JSON.stringify({ name: "Oscuro", colors: {} }));
  await assert.rejects(ipc(t, { open: { canceled: false, filePaths: [theme] } }).handlers["fc:importFile"](), errCode("not-fc-config"));
});
