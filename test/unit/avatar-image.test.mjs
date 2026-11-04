// Avatar propio: paleta, LZW y GIF animado (se decodifica aquí mismo para comprobar los píxeles).
import test from "node:test";
import assert from "node:assert/strict";
import { buildPalette, mapToPalette, lzwEncode, encodeGif, decimate, cropFor, formatBytes, GIF_STEPS, ANIMATED_BUDGET } from "../../src/renderer/js/avatar-image.js";

// Decodificador LZW de GIF (el estándar), para comprobar que lo codificado se lee igual.
function lzwDecode(bytes, minCodeSize, count) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let dict = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict.push([i]);
    dict.push(null, null);
    codeSize = minCodeSize + 1;
  };
  reset();
  const out = [];
  let pos = 0;
  let prev = null;
  const read = () => {
    let code = 0;
    for (let i = 0; i < codeSize; i++, pos++) code |= ((bytes[pos >> 3] >> (pos & 7)) & 1) << i;
    return code;
  };
  while (out.length < count + 1) {
    const code = read();
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry;
    if (code < dict.length) entry = dict[code];
    else if (code === dict.length && prev) entry = [...prev, prev[0]];
    else throw new Error(`código LZW inválido ${code}`);
    out.push(...entry);
    if (prev && dict.length < 4096) {
      dict.push([...prev, entry[0]]);
      if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  return out;
}

function parseGif(buf) {
  assert.equal(String.fromCharCode(...buf.slice(0, 6)), "GIF89a");
  const width = buf[6] | (buf[7] << 8);
  const height = buf[8] | (buf[9] << 8);
  const packed = buf[10];
  const tableSize = 1 << ((packed & 7) + 1);
  const palette = [];
  let p = 13;
  for (let i = 0; i < tableSize; i++, p += 3) palette.push([buf[p], buf[p + 1], buf[p + 2]]);
  const frames = [];
  let loop = false;
  let gce = null;
  while (buf[p] !== 0x3b) {
    if (buf[p] === 0x21) {
      const label = buf[p + 1];
      p += 2;
      const blocks = [];
      while (buf[p]) {
        blocks.push(buf.slice(p + 1, p + 1 + buf[p]));
        p += buf[p] + 1;
      }
      p++;
      if (label === 0xff && String.fromCharCode(...blocks[0]) === "NETSCAPE2.0") loop = true;
      if (label === 0xf9) gce = { transparent: blocks[0][0] & 1, delay: blocks[0][1] | (blocks[0][2] << 8), index: blocks[0][3] };
    } else if (buf[p] === 0x2c) {
      const w = buf[p + 5] | (buf[p + 6] << 8);
      const h = buf[p + 7] | (buf[p + 8] << 8);
      const minCodeSize = buf[p + 10];
      p += 11;
      const data = [];
      while (buf[p]) {
        data.push(...buf.slice(p + 1, p + 1 + buf[p]));
        p += buf[p] + 1;
      }
      p++;
      frames.push({ w, h, gce, indices: lzwDecode(data, minCodeSize, w * h).slice(0, w * h) });
      gce = null;
    } else throw new Error(`bloque desconocido en ${p}`);
  }
  return { width, height, palette, frames, loop };
}

const solid = (w, h, [r, g, b, a = 255]) => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) px.set([r, g, b, a], i);
  return px;
};

test("buildPalette: no pasa del máximo y separa colores distintos", () => {
  const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 250, 5, 5, 255]);
  const pal = buildPalette([px], 3);
  assert.equal(pal.length, 3);
  assert.ok(pal.some(([r, g, b]) => r > 200 && g < 50 && b < 50), "queda un rojo");
  assert.ok(pal.some(([r, g, b]) => g > 200 && r < 50 && b < 50), "queda un verde");
  assert.equal(buildPalette([px], 256).length, 3, "dos rojos casi iguales cuentan como uno");
  assert.deepEqual(buildPalette([solid(2, 2, [0, 0, 0, 0])], 16), [[0, 0, 0]], "solo transparente");
});

test("mapToPalette: el más cercano y los transparentes al índice reservado", () => {
  const px = new Uint8ClampedArray([250, 10, 10, 255, 10, 10, 240, 255, 0, 0, 0, 0]);
  assert.deepEqual([...mapToPalette(px, [[255, 0, 0], [0, 0, 255]], 0, 1)], [1, 2, 0]);
});

test("lzwEncode: se decodifica igual, también con más de 4096 códigos (borrado del diccionario)", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 200;
  const data = Array.from({ length: 60000 }, rnd);
  assert.deepEqual(lzwDecode(lzwEncode(data, 8), 8, data.length).slice(0, data.length), data);
  const small = [0, 1, 1, 1, 2, 3, 3, 0, 0, 0, 0, 1];
  assert.deepEqual(lzwDecode(lzwEncode(small, 2), 2, small.length).slice(0, small.length), small);
  const runs = new Array(9000).fill(3);
  assert.deepEqual(lzwDecode(lzwEncode(runs, 2), 2, runs.length).slice(0, runs.length), runs);
});

test("encodeGif: GIF animado en bucle con sus fotogramas, duraciones y colores", () => {
  const w = 12;
  const h = 10;
  const red = solid(w, h, [255, 0, 0]);
  const blue = solid(w, h, [0, 0, 255]);
  const mixed = solid(w, h, [255, 0, 0]);
  for (let i = 0; i < mixed.length / 2; i += 4) mixed.set([0, 0, 255, 255], i);
  const gif = parseGif(encodeGif([{ rgba: red, delay: 5 }, { rgba: blue, delay: 20 }, { rgba: mixed, delay: 1 }], w, h, 16));
  assert.equal(gif.width, w);
  assert.equal(gif.height, h);
  assert.ok(gif.loop);
  assert.equal(gif.frames.length, 3);
  assert.deepEqual(gif.frames.map((f) => f.gce.delay), [5, 20, 2], "duración mínima de 2 centésimas");
  const color = (f, i) => gif.palette[gif.frames[f].indices[i]];
  assert.ok(color(0, 0)[0] > 200 && color(0, 0)[2] < 50, "primer fotograma rojo");
  assert.ok(color(1, 5)[2] > 200 && color(1, 5)[0] < 50, "segundo azul");
  assert.ok(color(2, 0)[2] > 200, "tercero: azul arriba");
  assert.ok(color(2, w * h - 1)[0] > 200, "y rojo abajo");
});

test("encodeGif: con transparencia reserva el índice 0", () => {
  const px = solid(4, 4, [0, 255, 0]);
  px.set([0, 0, 0, 0], 0);
  const gif = parseGif(encodeGif([{ rgba: px, delay: 10 }], 4, 4));
  assert.equal(gif.frames[0].gce.transparent, 1);
  assert.equal(gif.frames[0].indices[0], 0);
  assert.ok(gif.palette[gif.frames[0].indices[1]][1] > 200);
  assert.equal(gif.loop, false, "una sola imagen: sin bucle");
});

test("un GIF de 96×96 con 40 fotogramas de ruido cabe en 64 KB con alguno de los intentos", () => {
  let seed = 3;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 255;
  const frames = Array.from({ length: 40 }, () => {
    const px = new Uint8ClampedArray(96 * 96 * 4);
    for (let i = 0; i < px.length; i += 4) px.set([rnd(), rnd(), rnd(), 255], i);
    return { rgba: px, delay: 4 };
  });
  // Escala de forma sencilla (vecino más próximo) para simular los tamaños menores.
  const scale = (px, s) => {
    const out = new Uint8ClampedArray(s * s * 4);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) out.set(px.slice(((Math.floor((y * 96) / s) * 96 + Math.floor((x * 96) / s)) * 4), ((Math.floor((y * 96) / s) * 96 + Math.floor((x * 96) / s)) * 4) + 4), (y * s + x) * 4);
    return out;
  };
  let fit = null;
  for (const [size, colors, step] of GIF_STEPS) {
    const data = encodeGif(decimate(frames, step).map((f) => ({ ...f, rgba: scale(f.rgba, size) })), size, size, colors);
    if (data.length <= ANIMATED_BUDGET) {
      fit = { size, colors, step, bytes: data.length };
      break;
    }
  }
  assert.ok(fit, "alguno de los intentos debe caber");
});

test("decimate y cropFor", () => {
  const f = [1, 2, 3, 4, 5].map((n) => ({ n, delay: 10 }));
  assert.deepEqual(decimate(f, 2).map((x) => [x.n, x.delay]), [[1, 20], [3, 20], [5, 10]]);
  assert.equal(decimate(f, 1), f);
  assert.deepEqual(cropFor(200, 100, 1, 100, 50), { x: 50, y: 0, side: 100 }, "zoom 1: el lado corto entero, centrado");
  assert.deepEqual(cropFor(200, 100, 2, 0, 0), { x: 0, y: 0, side: 50 }, "no se sale por arriba a la izquierda");
  assert.deepEqual(cropFor(200, 100, 2, 999, 999), { x: 150, y: 50, side: 50 }, "ni por abajo a la derecha");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(7578, "es"), "7,4 KB");
});
