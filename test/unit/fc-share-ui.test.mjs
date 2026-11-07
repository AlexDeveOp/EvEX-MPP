// Preferencias → Modo FC → «Compartir configuración»: textos de error y vista previa antes de importar.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// DOM mínimo para h() (el entorno de pruebas no trae uno), con textContent y búsqueda por etiqueta.
class FakeNode {
  constructor(tag, text = "") {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.text = text;
    this.className = "";
    this.attrs = {};
    this.style = { setProperty() {} };
    this.dataset = {};
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }
  append(...c) {
    this.children.push(...c);
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener() {}
  closest() {
    return null;
  }
  get textContent() {
    return this.tagName === "#TEXT" ? this.text : this.children.map((c) => c.textContent).join("");
  }
  querySelectorAll(tag) {
    const out = [];
    const walk = (n) => n.children.forEach((c) => (c.tagName === tag.toUpperCase() && out.push(c), walk(c)));
    walk(this);
    return out;
  }
  querySelector(tag) {
    return this.querySelectorAll(tag)[0] || null;
  }
}
globalThis.Node = FakeNode;
globalThis.document.createElement = (tag) => new FakeNode(tag);
globalThis.document.createTextNode = (text) => new FakeNode("#text", text);
const { shareErrorText, previewBody, buildFcShareControls } = await import("../../src/renderer/js/settings/fc-share-ui.js");
import { importFcConfig, exportFcConfigText, FC_SHARE_ERRORS } from "../../src/main/fc-share.js";
import { normalizeFcMode } from "../../src/main/store.js";

const ZW = String.fromCharCode(0x200b);
const NL = String.fromCharCode(10);

test("cada código de error tiene su texto, también envuelto por Electron", () => {
  const seen = new Set();
  for (const code of FC_SHARE_ERRORS) {
    const txt = shareErrorText(new Error(`Error invoking remote method 'fc:importFile': Error: fc-share:${code}`));
    assert.ok(txt && !txt.includes("fc-share:"), code);
    seen.add(txt);
  }
  assert.equal(seen.size, FC_SHARE_ERRORS.length, "textos distintos");
  assert.match(shareErrorText(new Error("EACCES: permission denied")), /EACCES/, "otro error se enseña tal cual");
});

test("vista previa: modo, canal, grupos, plantilla tal cual, cambios y avisos; nada se aplica", () => {
  const bob = normalizeFcMode({ groupMode: "line", channel: { accountId: "x", jid: "pingbot@ejemplo.com", kind: "chat" }, groups: [{ name: "caps", address: "" }], template: { format: `Fleet${ZW} up${NL}FC: {fc}` } });
  const text = exportFcConfigText(bob).replace('"webUrl": ""', '"webUrl": "javascript:alert(1)"');
  const { preview } = importFcConfig(text, normalizeFcMode({}));
  const el = previewBody("de-bob.json", preview);
  const all = el.textContent;
  assert.ok(all.includes("de-bob.json"));
  assert.ok(all.includes("pingbot@ejemplo.com"));
  assert.ok(all.includes("caps"));
  assert.equal(el.querySelector("pre").textContent, `Fleet${ZW} up${NL}FC: {fc}`, "la plantilla tal cual, con su invisible");
  assert.ok(preview.warnings.includes("web-url-dropped"));
  assert.ok(!all.includes("javascript:"), "la URL descartada no se enseña");
  // Lo mismo que ya se tiene: lo dice.
  const same = previewBody("x.json", importFcConfig(exportFcConfigText(bob), bob).preview).textContent;
  assert.ok(/no cambia nada|nothing changes/i.test(same));
});

test("los controles: dos botones", () => {
  const el = buildFcShareControls();
  assert.equal(el.querySelectorAll("button").length, 2);
});

test("se registra solo al cargarse y, con el Modo FC apagado, sus botones quedan FUERA de la zona en gris", async () => {
  const src = fs.readFileSync(new URL("../../src/renderer/js/app.js", import.meta.url), "utf8");
  assert.ok(src.includes(`import "./settings/fc-share-ui.js";`), "app.js lo carga");
  const { S } = await import("../../src/renderer/js/state.js");
  const { TEST_SETTINGS } = await import("./helpers.mjs");
  S.settings = structuredClone({ ...TEST_SETTINGS, fcMode: normalizeFcMode({ enabled: false }) });
  S.accounts = [];
  const { fcTabs } = await import("../../src/renderer/js/settings/fc.js");
  const root = { children: [fcTabs.fc()].flat(Infinity).filter(Boolean) };
  // Camino desde la pestaña hasta los controles.
  const pathTo = (n, cls) => {
    if (n.className === cls) return [n];
    for (const c of n.children || []) {
      const p = pathTo(c, cls);
      if (p) return [n, ...p];
    }
    return null;
  };
  const path = pathTo(root, "fc-share-controls");
  assert.ok(path, "la sección sale");
  assert.ok(path.every((n) => !n.inert), "ni ella ni nada por encima está en gris");
  assert.equal(path.at(-1).querySelectorAll("button").length, 2, "los dos botones");
  const grey = (n) => !!n.inert || (n.children || []).some(grey);
  assert.ok(grey(root), "el resto sí, con el modo apagado");
});
