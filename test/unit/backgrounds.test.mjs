import { test } from "node:test";
import assert from "node:assert/strict";
import { imageAdjust, backgroundCss, applyBackgroundLayer } from "../../src/renderer/js/themes.js";

const img = (extra = {}) => ({ type: "image", value: "media://evex/files/abc.png", opacity: 0.4, blur: 0, ...extra });

test("imageAdjust: sin ajustes se ve como antes (llenar, centrada) y los valores fuera de rango se acotan", () => {
  assert.deepEqual(imageAdjust(img()), { fit: "cover", zoom: 1, posX: 50, posY: 50, brightness: 1, saturate: 1 });
  assert.deepEqual(imageAdjust(img({ fit: "raro", zoom: 9, posX: -5, posY: 130, brightness: 0, saturate: 5 })), { fit: "cover", zoom: 4, posX: 0, posY: 100, brightness: 0.3, saturate: 2 });
  assert.equal(imageAdjust(img({ zoom: null })).zoom, 1);
});

test("backgroundCss traduce el encaje y la posición", () => {
  assert.equal(backgroundCss(img()), 'url("media://evex/files/abc.png") 50% 50% / cover no-repeat');
  assert.equal(backgroundCss(img({ fit: "contain", posX: 10, posY: 90 })), 'url("media://evex/files/abc.png") 10% 90% / contain no-repeat');
  assert.match(backgroundCss(img({ fit: "stretch" })), /\/ 100% 100% no-repeat$/);
  assert.match(backgroundCss(img({ fit: "tile" })), /\/ auto repeat$/);
  assert.equal(backgroundCss({ type: "none", value: "x" }), "");
});

test("backgroundCss escapa la URL de la imagen", () => {
  assert.ok(!backgroundCss(img({ value: 'media://evex/a").png' })).includes('a")'));
});

test("applyBackgroundLayer aplica zoom, punto de origen, filtros e intensidad", () => {
  const el = { style: {} };
  applyBackgroundLayer(el, img({ zoom: 2, posX: 20, posY: 70, brightness: 1.2, saturate: 0.5, blur: 3, opacity: 0.6 }));
  assert.equal(el.style.transform, "scale(2)");
  assert.equal(el.style.transformOrigin, "20% 70%");
  assert.equal(el.style.filter, "blur(3px) brightness(1.2) saturate(0.5)");
  assert.equal(el.style.opacity, 0.6);
  // Sin fondo, la capa queda vacía y transparente.
  applyBackgroundLayer(el, { type: "none", value: "" });
  assert.equal(el.style.background, "");
  assert.equal(el.style.opacity, 0);
  assert.equal(el.style.transform, "");
});
