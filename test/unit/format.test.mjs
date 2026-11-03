import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { S } from "../../src/renderer/js/state.js";
import { formatBody, mentionRegex, previewHtml, fmtEve, fmtTime } from "../../src/renderer/js/format.js";
import { esc } from "../../src/renderer/js/dom.js";
import { TEST_SETTINGS } from "./helpers.mjs";

beforeEach(() => {
  S.settings = structuredClone(TEST_SETTINGS);
});

test("esc escapa los caracteres especiales de HTML", () => {
  assert.equal(esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.equal(esc(null), "");
});

test("formatBody nunca deja pasar HTML del mensaje", () => {
  const { html } = formatBody(`<img src=x onerror="alert(1)"> <script>alert(1)</script>`);
  assert.ok(!/<img|<script/i.test(html), html);
  assert.ok(html.includes("&lt;script&gt;"));
});

test("formatBody escapa también dentro de enlaces y código", () => {
  const { html } = formatBody('https://example.com/a"onmouseover="x `<b>` ```<i>```');
  assert.ok(!html.includes('"onmouseover'), html);
  assert.ok(html.includes('<code class="code-inline">&lt;b&gt;</code>'));
  assert.ok(html.includes("<pre class=\"code-block\"><code>&lt;i&gt;</code></pre>"));
});

test("formatBody da formato a *negrita*, _cursiva_ y ~tachado~", () => {
  const { html } = formatBody("esto es *importante*, _suave_ y ~viejo~");
  assert.ok(html.includes("<strong>importante</strong>"));
  assert.ok(html.includes("<em>suave</em>"));
  assert.ok(html.includes("<del>viejo</del>"));
});

test("formatBody convierte enlaces y genera vistas previas de imágenes y YouTube", () => {
  const { html, previews } = formatBody("mira https://example.com/foto.png y https://youtu.be/dQw4w9WgXcQ y www.example.com");
  assert.equal((html.match(/<a class="link"/g) || []).length, 3);
  assert.ok(html.includes('href="https://www.example.com"'));
  assert.deepEqual(
    previews.map((p) => p.type),
    ["image", "youtube"],
  );
  assert.equal(previews[1].id, "dQw4w9WgXcQ");
  assert.ok(previewHtml(previews[0]).includes('referrerpolicy="no-referrer"'));
});

test("formatBody sin vistas previas si están desactivadas", () => {
  S.settings.behavior.linkPreviews = false;
  assert.equal(formatBody("https://example.com/foto.png").previews.length, 0);
});

test("formatBody marca las menciones como palabra completa", () => {
  const r = formatBody("hola Piloto, ¿vienes?", { mentionWords: ["piloto"] });
  assert.ok(r.mention);
  assert.ok(r.html.includes('<mark class="mention">Piloto</mark>'));
  assert.equal(formatBody("copiloto aquí", { mentionWords: ["piloto"] }).mention, false);
});

test("mentionRegex ignora palabras vacías o de una letra y escapa caracteres de regex", () => {
  assert.equal(mentionRegex(["", " ", "a"]), null);
  assert.ok(mentionRegex(["c++"]).test("uso c++ a diario"));
});

test("formatBody convierte emoticonos y :códigos: y detecta mensajes solo de emojis", () => {
  const r = formatBody("hola :) :thumbsup:");
  assert.ok(!r.html.includes(":)"), r.html);
  assert.ok(!r.html.includes(":thumbsup:"), r.html);
  assert.ok(formatBody(":thumbsup: 🚀").jumbo);
  assert.equal(formatBody("hola :)").jumbo, false);
  S.settings.emoticonToEmoji = false;
  assert.ok(formatBody("hola :)").html.includes(":)"));
});

test("formatBody usa los emojis personalizados escapando su URL", () => {
  S.settings.customEmoji = [{ name: "o7", url: 'media://evex/emoji/o7.png"x' }];
  const { html } = formatBody("saludos :o7:");
  assert.ok(html.includes('<img class="emoji custom" src="media://evex/emoji/o7.png&quot;x"'), html);
});

test("fmtEve da la hora EVE (UTC) en 24 h", () => {
  const ts = Date.UTC(2026, 10, 2, 21, 5, 9);
  assert.equal(fmtEve(ts, false), "21:05");
  assert.equal(fmtEve(ts, true), "21:05:09");
});

test("fmtTime sigue los ajustes de 12/24 h y segundos aunque los formateadores se guarden", () => {
  const ts = new Date(2026, 10, 2, 21, 5, 9).getTime();
  Object.assign(S.settings, { timeFormat: "24", showSeconds: false });
  assert.equal(fmtTime(ts), "21:05");
  S.settings.showSeconds = true;
  assert.equal(fmtTime(ts), "21:05:09");
  Object.assign(S.settings, { timeFormat: "12", showSeconds: false });
  assert.match(fmtTime(ts), /^0?9:05\s?p\.?\s?m\.?$/i);
  Object.assign(S.settings, { timeFormat: "24", showSeconds: false });
  assert.equal(fmtTime(ts), "21:05", "volver a 24 h no reutiliza el formateador de 12 h");
});

test("formatBody detecta la mención en mensajes seguidos aunque la expresión se reutilice", () => {
  assert.equal(mentionRegex(["bob", "alice"]), mentionRegex(["bob", "alice"]), "misma lista, misma expresión");
  for (let i = 0; i < 3; i++) assert.equal(formatBody("hola bob", { mentionWords: ["bob", "alice"] }).mention, true);
  assert.equal(formatBody("nada", { mentionWords: ["bob", "alice"] }).mention, false);
});
