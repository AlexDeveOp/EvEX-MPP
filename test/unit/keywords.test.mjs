import { test } from "node:test";
import assert from "node:assert/strict";
import { S } from "../../src/renderer/js/state.js";
import { compileRule, matchRule, highlightRules, normalizeRule, newRule } from "../../src/renderer/js/keywords.js";
import { formatBody } from "../../src/renderer/js/format.js";
import { TEST_SETTINGS } from "./helpers.mjs";

S.settings = structuredClone(TEST_SETTINGS);

const rule = (o) => normalizeRule({ id: o.id || "r", ...o });

test("normalizeRule completa los valores y rechaza colores que no son #rrggbb", () => {
  const r = normalizeRule({ id: "a", words: [" titan ", "", "cyno"], color: "red;background:url(x)", where: { pings: false } });
  assert.deepEqual(r.words, ["titan", "cyno"]);
  assert.equal(r.color, "#f59e0b");
  assert.deepEqual(r.where, { rooms: true, private: true, pings: false });
  assert.equal(r.sound.preset, "default");
  assert.match(newRule().id, /^r\w+/);
});

test("palabra completa no coincide dentro de otra palabra; «contiene» sí", () => {
  const words = ["cyno"];
  assert.equal(matchRule("need a cyno now", "rooms", [rule({ words })])?.id, "r");
  assert.equal(matchRule("cynosural field", "rooms", [rule({ words })]), null);
  assert.equal(matchRule("cynosural field", "rooms", [rule({ words, match: "contains" })])?.id, "r");
  assert.equal(matchRule("CYNO UP", "rooms", [rule({ words })])?.id, "r", "no distingue mayúsculas");
});

test("expresiones regulares: válidas coinciden y las inválidas dan error sin romper", () => {
  assert.ok(compileRule(rule({ words: ["tit(a|o)n"], match: "regex" })).re.test("titon"));
  const bad = compileRule(rule({ words: ["(sin cerrar"], match: "regex" }));
  assert.equal(bad.re, null);
  assert.ok(bad.error);
  assert.equal(matchRule("(sin cerrar", "rooms", [rule({ words: ["(sin cerrar"], match: "regex" })]), null);
});

test("respeta dónde se aplica, si está activa y el orden (manda la primera)", () => {
  const rules = [rule({ id: "off", words: ["titan"], enabled: false }), rule({ id: "solo-pings", words: ["titan"], where: { rooms: false, private: false } }), rule({ id: "todo", words: ["titan"] })];
  assert.equal(matchRule("titan on grid", "pings", rules)?.id, "solo-pings");
  assert.equal(matchRule("titan on grid", "rooms", rules)?.id, "todo");
  assert.equal(matchRule("nada", "rooms", rules), null);
});

test("los caracteres invisibles de los pings no impiden coincidir", () => {
  const zw = String.fromCharCode(0x200b);
  assert.equal(matchRule(`Doctrine: Fer${zw}ox`, "pings", [rule({ words: ["Ferox"] })])?.id, "r");
});

test("formatBody resalta con el color de la regla sin tocar etiquetas, enlaces ni entidades", () => {
  const rules = highlightRules("rooms", [rule({ words: ["strong", "amp", "example"], color: "#ff0000" })]);
  const { html } = formatBody("*strong* & https://example.com y strong", { rules });
  assert.match(html, /<strong><mark class="kw" style="--kw:#ff0000">strong<\/mark><\/strong>/);
  assert.match(html, /&amp;/, "la entidad &amp; queda intacta");
  assert.match(html, /href="https:\/\/example\.com"/, "el enlace no se marca");
  assert.equal((html.match(/class="kw"/g) || []).length, 2);
});
