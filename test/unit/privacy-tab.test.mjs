import { test } from "node:test";
import assert from "node:assert/strict";

// DOM mínimo para h() (el entorno de pruebas no trae uno).
class FakeNode {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.className = "";
    this.attrs = {};
    this.style = { setProperty() {} };
    this.dataset = {};
  }
  append(...c) {
    this.children.push(...c);
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener() {}
}
globalThis.Node ??= FakeNode;
const realCreate = globalThis.document.createElement;
globalThis.document.createElement = (tag) => new FakeNode(tag);
globalThis.document.createTextNode ??= (text) => Object.assign(new FakeNode("#text"), { text });
const { h } = await import("../../src/renderer/js/dom.js");
const { addPrivacyGroup, privacyTabs } = await import("../../src/renderer/js/settings/privacy.js");

test("Privacidad: los grupos registrados con addPrivacyGroup salen en orden; uno que falla no rompe la pestaña", () => {
  addPrivacyGroup(() => h("section", { class: "g1" }));
  addPrivacyGroup(() => {
    throw new Error("roto");
  });
  addPrivacyGroup(() => null);
  addPrivacyGroup(() => h("section", { class: "g2" }));
  const errors = console.error;
  console.error = () => {};
  try {
    const tab = privacyTabs.privacy();
    const classes = [...tab.children].map((c) => c.className);
    assert.deepEqual(classes.slice(1), ["g1", "g2"], "tras el texto de la pestaña, los dos grupos que sí dan elemento");
  } finally {
    console.error = errors;
    globalThis.document.createElement = realCreate;
  }
});
