// Vistas previas «al hacer clic» (0.11): migración de linkPreviews y recuadro que no pide nada a la red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateLinkPreviews, DEFAULT_SETTINGS } from "../../src/main/store.js";
import { S } from "../../src/renderer/js/state.js";
import { formatBody, previewHtml, previewMode, loadPendingPreview } from "../../src/renderer/js/format.js";
import { TEST_SETTINGS } from "./helpers.mjs";

test("valor de serie: «al hacer clic», sin avisos pendientes", () => {
  assert.equal(DEFAULT_SETTINGS.behavior.linkPreviewMode, "click");
  assert.equal("linkPreviews" in DEFAULT_SETTINGS.behavior, false);
  assert.deepEqual(DEFAULT_SETTINGS.notices, {});
});

test("migración: apagadas → «off» sin aviso; encendidas → «click» con aviso; instalación nueva o ya migrada, sin cambios", () => {
  assert.deepEqual(migrateLinkPreviews({ behavior: { linkPreviews: false, mucHistory: 50 } }), { behavior: { mucHistory: 50, linkPreviewMode: "off" }, notices: {} });
  assert.deepEqual(migrateLinkPreviews({ behavior: { linkPreviews: true } }), { behavior: { linkPreviewMode: "click" }, notices: { linkPreviewClick: true } });
  const fresh = {};
  assert.equal(migrateLinkPreviews(fresh), fresh, "sin ajustes guardados: nada que migrar");
  const done = { behavior: { linkPreviewMode: "auto", linkPreviews: true } };
  assert.equal(migrateLinkPreviews(done), done, "ya migrado (eligió «Siempre»): no se toca");
  assert.deepEqual(migrateLinkPreviews({ behavior: { linkPreviews: true }, notices: { otro: true } }).notices, { otro: true, linkPreviewClick: true }, "conserva otros avisos");
});

test("previewMode: valores raros cuentan como «al hacer clic»", () => {
  S.settings = structuredClone(TEST_SETTINGS);
  for (const [v, want] of [["click", "click"], ["auto", "auto"], ["off", "off"], [undefined, "click"], ["raro", "click"]]) {
    S.settings.behavior.linkPreviewMode = v;
    assert.equal(previewMode(), want);
  }
});

test("«al hacer clic»: el recuadro no lleva <img> ni la dirección de la imagen como recurso, solo el dominio", () => {
  S.settings = structuredClone(TEST_SETTINGS);
  S.settings.behavior.linkPreviewMode = "click";
  const { previews } = formatBody("mira https://imagenes.ejemplo.com/rastreo.png y https://youtu.be/dQw4w9WgXcQ");
  assert.equal(previews.length, 2, "se reconocen igual");
  // Texto visible del recuadro y dirección de su título (el enlace original), comparados exactamente.
  const label = (html) => /<\/span>([^<]*)<\/button>$/.exec(html)?.[1];
  const titleUrl = (html) => new URL(/ title="([^"]*)"/.exec(html)[1].replace(/&amp;/g, "&"));
  const img = previewHtml(previews[0], { pending: true });
  assert.ok(img.startsWith('<button type="button" class="link-preview preview-pending image"'));
  assert.equal(label(img), "Imagen de imagenes.ejemplo.com · clic para cargar", "solo el dominio, a la vista");
  assert.equal(titleUrl(img).hostname, "imagenes.ejemplo.com");
  assert.ok(!/<img\b/.test(img) && !/\bsrc=/.test(img), "sin <img> ni src: no se pide nada");
  const yt = previewHtml(previews[1], { pending: true });
  assert.equal(label(yt), "Vídeo de YouTube · clic para cargar");
  assert.ok(!/<img\b/.test(yt) && !/\bsrc=/.test(yt), "ni la miniatura de YouTube");
  // La vista previa de verdad también lleva la clase estable.
  assert.ok(previewHtml(previews[0]).startsWith('<a class="link-preview preview image"'));
});

test("«nunca»: no hay vistas previas", () => {
  S.settings = structuredClone(TEST_SETTINGS);
  S.settings.behavior.linkPreviewMode = "off";
  assert.equal(formatBody("https://imagenes.ejemplo.com/a.png").previews.length, 0);
});

test("loadPendingPreview cambia el recuadro por la vista previa, y solo con direcciones http(s)", () => {
  const p = { type: "image", url: "https://imagenes.ejemplo.com/a.png" };
  const btn = { dataset: { preview: JSON.stringify(p) }, outerHTML: "", closest: () => btn };
  assert.equal(loadPendingPreview({ closest: () => btn }), true);
  assert.equal(btn.outerHTML, previewHtml(p));
  const bad = { dataset: { preview: JSON.stringify({ type: "image", url: "javascript:alert(1)" }) }, outerHTML: "sin tocar", closest: () => bad };
  assert.equal(loadPendingPreview({ closest: () => bad }), true);
  assert.equal(bad.outerHTML, "sin tocar", "una dirección que no es http(s) no se carga");
  assert.equal(loadPendingPreview({ closest: () => null }), false, "clic fuera de un recuadro");
});
