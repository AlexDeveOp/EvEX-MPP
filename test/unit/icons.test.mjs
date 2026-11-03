import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { renderIcon, renderAlertIcon } from "../../src/main/icon.js";
import { luminance, contrast, shadeForWhite } from "../../src/renderer/js/contrast.js";

// Lee un PNG RGBA de 8 bits sin entrelazar (el formato que genera icon.js) y devuelve sus píxeles.
function decodePng(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "firma PNG");
  let pos = 8;
  let w = 0;
  let h = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      assert.equal(data[8], 8, "8 bits");
      assert.equal(data[9], 6, "RGBA");
    }
    if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  assert.equal(raw.length, (w * 4 + 1) * h);
  const px = (x, y) => [...raw.subarray(y * (w * 4 + 1) + 1 + x * 4, y * (w * 4 + 1) + 1 + x * 4 + 4)];
  return { w, h, px };
}

test("renderIcon y renderAlertIcon generan PNG válidos del tamaño pedido", () => {
  for (const size of [16, 32, 64, 128, 256]) {
    assert.equal(decodePng(renderIcon(size)).w, size);
    const a = decodePng(renderAlertIcon(size));
    assert.equal(a.w, size);
    assert.equal(a.h, size);
  }
});

test("el icono de aviso es una sirena blanca sobre un círculo ámbar, con las esquinas transparentes", () => {
  const { px } = decodePng(renderAlertIcon(64));
  assert.equal(px(0, 0)[3], 0, "esquina transparente");
  assert.deepEqual(px(32, 34), [255, 255, 255, 255], "cúpula de la sirena, blanca");
  assert.deepEqual(px(32, 49), [255, 255, 255, 255], "base de la sirena, blanca");
  assert.deepEqual(px(8, 44), [0xf5, 0x9e, 0x0b, 255], "fondo ámbar");
  assert.deepEqual(px(32, 9)[0], 255, "rayo de arriba");
});

test("la insignia de mensajes sin leer añade un punto rojo arriba a la derecha", () => {
  const plain = decodePng(renderIcon(256));
  const badge = decodePng(renderIcon(256, { badge: true }));
  assert.deepEqual(badge.px(206, 50).slice(0, 3), [239, 68, 68]);
  assert.notDeepEqual(plain.px(206, 50), badge.px(206, 50));
});

test("luminance y contrast siguen la fórmula de WCAG", () => {
  assert.equal(luminance("#000000"), 0);
  assert.equal(luminance("#ffffff"), 1);
  assert.equal(contrast("#000000", "#ffffff"), 21);
  assert.equal(contrast("#ffffff", "#000000"), 21);
  assert.equal(contrast("#777777", "#777777"), 1);
});

test("shadeForWhite oscurece el color de aviso lo justo para que la sirena blanca se lea (4,5:1)", () => {
  // Colores de aviso de los temas: Oscuro, Claro, Nord, Dracula, Solarized y el ámbar por defecto.
  for (const warn of ["#d29922", "#b45309", "#ebcb8b", "#f1fa8c", "#b58900", "#f59e0b"]) {
    const bg = shadeForWhite(warn);
    assert.match(bg, /^#[0-9a-f]{6}$/);
    assert.ok(contrast(bg, "#ffffff") >= 4.5, `${warn} → ${bg}: ${contrast(bg, "#ffffff").toFixed(2)}`);
    // Lo justo: un paso menos oscuro ya no llegaría (salvo que ya llegara sin oscurecer).
    if (bg !== warn) {
      const lighter = "#" + [1, 3, 5].map((i) => Math.min(255, Math.round(parseInt(bg.slice(i, i + 2), 16) / 0.97)).toString(16).padStart(2, "0")).join("");
      assert.ok(contrast(lighter, "#ffffff") < 4.6, `${warn}: ${bg} se oscurece de más`);
    }
  }
  // Un color que ya contrasta no cambia.
  assert.equal(shadeForWhite("#b45309"), "#b45309");
  // Algo que no es #rrggbb usa el ámbar de siempre.
  assert.equal(shadeForWhite(undefined), shadeForWhite("#f59e0b"));
  assert.equal(shadeForWhite("rgb(1,2,3)"), shadeForWhite("#f59e0b"));
});
