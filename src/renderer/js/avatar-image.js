// Avatar propio: recorte cuadrado, reducción y compresión para publicarlo en XMPP.
// XEP-0153/XEP-0084 recomiendan 32–96 px y menos de 8 KB: la imagen viaja en tu perfil y la descarga cada persona que te ve.
// - Imagen fija: 96×96 en PNG si cabe en 8 KB; si no, JPEG con la mejor calidad que quepa.
// - Animada (GIF, WebP o PNG animados): GIF propio de hasta 64 KB; se baja el tamaño, los colores o los fotogramas hasta que quepa.
// La parte de GIF (paleta y LZW) no usa el DOM y se prueba en Node; el resto usa canvas e ImageDecoder del navegador.

export const AVATAR_SIZE = 96;
export const STATIC_BUDGET = 8 * 1024;
export const STATIC_MAX = 32 * 1024;
export const ANIMATED_BUDGET = 64 * 1024;
const MAX_FRAMES = 150;

// ---------- paleta (corte por la mediana) ----------

// Reduce los colores opacos de una o varias imágenes RGBA a como mucho maxColors. Devuelve [[r,g,b], …].
export function buildPalette(images, maxColors) {
  const counts = new Map();
  for (const px of images) {
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      const key = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const colors = [...counts].map(([k, n]) => ({ c: [((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4], n }));
  if (!colors.length) return [[0, 0, 0]];
  let boxes = [colors];
  while (boxes.length < maxColors) {
    // Se parte la caja con más píxeles × rango; si ninguna se puede partir, se acaba.
    let best = -1;
    let bestScore = 0;
    let bestAxis = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      let axis = 0;
      let range = -1;
      for (let a = 0; a < 3; a++) {
        let lo = 255;
        let hi = 0;
        for (const { c } of box) {
          if (c[a] < lo) lo = c[a];
          if (c[a] > hi) hi = c[a];
        }
        if (hi - lo > range) {
          range = hi - lo;
          axis = a;
        }
      }
      const score = range * box.reduce((s, x) => s + x.n, 0);
      if (score > bestScore) {
        bestScore = score;
        best = i;
        bestAxis = axis;
      }
    });
    if (best < 0) break;
    const box = boxes[best].sort((a, b) => a.c[bestAxis] - b.c[bestAxis]);
    const total = box.reduce((s, x) => s + x.n, 0);
    let acc = 0;
    let cut = 1;
    for (; cut < box.length - 1; cut++) {
      acc += box[cut - 1].n;
      if (acc >= total / 2) break;
    }
    boxes = [...boxes.slice(0, best), box.slice(0, cut), box.slice(cut), ...boxes.slice(best + 1)];
  }
  return boxes.map((box) => {
    const n = box.reduce((s, x) => s + x.n, 0);
    return [0, 1, 2].map((a) => Math.round(box.reduce((s, x) => s + x.c[a] * x.n, 0) / n));
  });
}

// Índice de paleta de cada píxel (el más cercano). Con transparent ≥ 0, los píxeles transparentes van a ese índice.
export function mapToPalette(px, palette, transparent = -1, offset = 0) {
  const out = new Uint8Array(px.length / 4);
  const cache = new Map();
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    if (transparent >= 0 && px[i + 3] < 128) {
      out[j] = transparent;
      continue;
    }
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let idx = cache.get(key);
    if (idx === undefined) {
      let best = Infinity;
      for (let p = 0; p < palette.length; p++) {
        const dr = px[i] - palette[p][0];
        const dg = px[i + 1] - palette[p][1];
        const db = px[i + 2] - palette[p][2];
        const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
        if (d < best) {
          best = d;
          idx = p;
        }
      }
      idx += offset;
      cache.set(key, idx);
    }
    out[j] = idx;
  }
  return out;
}

// ---------- GIF89a ----------

// Compresión LZW de GIF (códigos de tamaño variable, borrado al llenar las 4096 entradas).
export function lzwEncode(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let dict = new Map();
  const out = [];
  let cur = 0;
  let bits = 0;
  const emit = (code) => {
    cur |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(cur & 255);
      cur >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  if (!indices.length) {
    emit(eoi);
    if (bits > 0) out.push(cur & 255);
    return out;
  }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict = new Map();
      codeSize = minCodeSize + 1;
      next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(cur & 255);
  return out;
}

// GIF animado en bucle infinito. frames: [{ rgba (Uint8ClampedArray w*h*4), delay (centésimas) }].
export function encodeGif(frames, width, height, maxColors = 256) {
  const hasAlpha = frames.some((f) => {
    for (let i = 3; i < f.rgba.length; i += 4) if (f.rgba[i] < 128) return true;
    return false;
  });
  const transparent = hasAlpha ? 0 : -1;
  const palette = buildPalette(
    frames.map((f) => f.rgba),
    Math.max(2, maxColors - (hasAlpha ? 1 : 0)),
  );
  const colors = hasAlpha ? [[0, 0, 0], ...palette] : palette;
  let bitsPerColor = 1;
  while (1 << bitsPerColor < colors.length) bitsPerColor++;
  const tableSize = 1 << bitsPerColor;
  const minCodeSize = Math.max(2, bitsPerColor);

  const out = [];
  const u16 = (v) => out.push(v & 255, (v >> 8) & 255);
  const ascii = (s) => out.push(...[...s].map((c) => c.charCodeAt(0)));
  ascii("GIF89a");
  u16(width);
  u16(height);
  out.push(0x80 | 0x70 | (bitsPerColor - 1), 0, 0);
  for (let i = 0; i < tableSize; i++) out.push(...(colors[i] || [0, 0, 0]));
  if (frames.length > 1) {
    out.push(0x21, 0xff, 0x0b);
    ascii("NETSCAPE2.0");
    out.push(0x03, 0x01, 0x00, 0x00, 0x00);
  }
  for (const f of frames) {
    // Cada fotograma es completo: se borra el anterior (disposición 2) para que no se vean restos en las zonas transparentes.
    out.push(0x21, 0xf9, 0x04, (2 << 2) | (hasAlpha ? 1 : 0));
    u16(Math.max(2, Math.round(f.delay || 10)));
    out.push(0x00, 0x00); // índice transparente (el 0 de la paleta) y fin del bloque
    out.push(0x2c);
    u16(0);
    u16(0);
    u16(width);
    u16(height);
    out.push(0x00, minCodeSize);
    const data = lzwEncode(mapToPalette(f.rgba, palette, transparent, hasAlpha ? 1 : 0), minCodeSize);
    for (let i = 0; i < data.length; i += 255) {
      const block = data.slice(i, i + 255);
      out.push(block.length, ...block);
    }
    out.push(0x00);
  }
  out.push(0x3b);
  return new Uint8Array(out);
}

// Junta fotogramas de dos en dos, de tres en tres…: menos fotogramas con la misma duración total.
export function decimate(frames, step) {
  if (step <= 1) return frames;
  const out = [];
  for (let i = 0; i < frames.length; i += step) {
    const group = frames.slice(i, i + step);
    out.push({ ...group[0], delay: group.reduce((s, f) => s + (f.delay || 10), 0) });
  }
  return out;
}

// Intentos para que un GIF quepa, de mejor a peor: [tamaño, colores, salto de fotogramas].
export const GIF_STEPS = [
  [96, 256, 1],
  [96, 128, 1],
  [80, 128, 1],
  [64, 128, 1],
  [64, 64, 1],
  [64, 64, 2],
  [56, 48, 2],
  [48, 32, 2],
  [48, 32, 3],
  [40, 16, 4],
];

// Tamaño legible: «7,4 KB».
export function formatBytes(n, lang = "es") {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toLocaleString(lang, { maximumFractionDigits: 1 })} KB`;
}

// ---------- navegador: cargar, recortar y codificar ----------

// Abre una imagen (fija o animada). Devuelve { width, height, animated, frameCount, first (ImageBitmap), frames() }.
export async function loadImage(bytes, type) {
  const blob = new Blob([bytes], { type });
  if (typeof ImageDecoder !== "undefined" && (await ImageDecoder.isTypeSupported(type).catch(() => false))) {
    const decoder = new ImageDecoder({ data: bytes, type });
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    const frameCount = track?.animated ? track.frameCount : 1;
    const { image } = await decoder.decode({ frameIndex: 0 });
    const first = await createImageBitmap(image);
    image.close();
    return {
      width: first.width,
      height: first.height,
      animated: frameCount > 1,
      frameCount,
      first,
      // Recorre los fotogramas ya compuestos (como se verían) con su duración en centésimas.
      async *frames() {
        for (let i = 0; i < Math.min(frameCount, MAX_FRAMES); i++) {
          const { image: frame } = await decoder.decode({ frameIndex: i });
          const bmp = await createImageBitmap(frame);
          const delay = frame.duration ? frame.duration / 10000 : 10;
          frame.close();
          yield { bmp, delay };
        }
      },
      close: () => decoder.close(),
    };
  }
  const first = await createImageBitmap(blob);
  return { width: first.width, height: first.height, animated: false, frameCount: 1, first, async *frames() {}, close() {} };
}

// Recorte cuadrado { x, y, side } (en píxeles de la imagen) a partir de zoom (1 = el lado corto llena el cuadrado) y centro.
export function cropFor(width, height, zoom, cx, cy) {
  const side = Math.min(width, height) / Math.max(1, zoom);
  const x = Math.min(Math.max(cx - side / 2, 0), width - side);
  const y = Math.min(Math.max(cy - side / 2, 0), height - side);
  return { x, y, side };
}

function drawCropped(src, crop, size, background) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.drawImage(src, crop.x, crop.y, crop.side, crop.side, 0, 0, size, size);
  return canvas;
}

const toBytes = async (canvas, type, quality) => new Uint8Array(await (await canvas.convertToBlob({ type, quality })).arrayBuffer());

// Imagen fija: PNG si cabe en 8 KB; si no, el JPEG de más calidad que quepa (el fondo transparente se rellena).
export async function encodeStatic(src, crop, { background = "#1e1f22" } = {}) {
  for (const size of [AVATAR_SIZE, 64]) {
    const png = await toBytes(drawCropped(src, crop, size), "image/png");
    if (png.length <= STATIC_BUDGET) return { data: png, type: "image/png", width: size, height: size };
    const canvas = drawCropped(src, crop, size, background);
    let last = null;
    for (const q of [0.92, 0.85, 0.78, 0.7, 0.6, 0.5]) {
      last = await toBytes(canvas, "image/jpeg", q);
      if (last.length <= STATIC_BUDGET) return { data: last, type: "image/jpeg", width: size, height: size };
    }
    if (last.length <= STATIC_MAX) return { data: last, type: "image/jpeg", width: size, height: size };
  }
  throw new Error("too-big");
}

// Imagen animada: GIF que quepa en 64 KB, probando GIF_STEPS. onProgress(texto) para la interfaz.
export async function encodeAnimated(img, crop) {
  const big = [];
  for await (const { bmp, delay } of img.frames()) {
    big.push({ canvas: drawCropped(bmp, crop, AVATAR_SIZE), delay });
    bmp.close();
  }
  for (const [size, colors, step] of GIF_STEPS) {
    const frames = decimate(big, step).map(({ canvas, delay }) => {
      const c = size === AVATAR_SIZE ? canvas : drawCropped(canvas, { x: 0, y: 0, side: AVATAR_SIZE }, size);
      return { rgba: c.getContext("2d").getImageData(0, 0, size, size).data, delay };
    });
    const data = encodeGif(frames, size, size, colors);
    if (data.length <= ANIMATED_BUDGET) return { data, type: "image/gif", width: size, height: size, frames: frames.length };
    await new Promise((r) => setTimeout(r));
  }
  throw new Error("too-big");
}
