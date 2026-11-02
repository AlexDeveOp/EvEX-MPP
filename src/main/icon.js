// Icono de la aplicación dibujado por código (PNG), con variante de insignia para mensajes sin leer.
import zlib from "node:zlib";

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const clamp = (v) => Math.max(0, Math.min(1, v));
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Icono de aviso de ping: círculo ámbar con una exclamación blanca, pensado para verse a 16 px en la bandeja.
export function renderAlertIcon(size = 64, color = "#f59e0b") {
  const buf = Buffer.alloc(size * size * 4);
  const c = hex(color);
  const s = size / 64;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const aCircle = clamp(0.5 - (Math.hypot(px - 32 * s, py - 32 * s) - 31 * s));
      const aBar = clamp(0.5 - sdRoundRect(px, py, 32 * s, 25 * s, 5.5 * s, 15 * s, 5 * s));
      const aDot = clamp(0.5 - (Math.hypot(px - 32 * s, py - 50 * s) - 6 * s));
      const white = Math.max(aBar, aDot);
      const i = (y * size + x) * 4;
      buf[i] = c[0] + (255 - c[0]) * white;
      buf[i + 1] = c[1] + (255 - c[1]) * white;
      buf[i + 2] = c[2] + (255 - c[2]) * white;
      buf[i + 3] = aCircle * 255;
    }
  }
  return encodePng(size, size, buf);
}

export function renderIcon(size = 256,{ accent = "#3b9bff", accent2 = "#8b5cf6", badge = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const a1 = hex(accent);
  const a2 = hex(accent2);
  const s = size / 256;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      // Fondo: cuadrado redondeado con degradado diagonal
      const dBg = sdRoundRect(px, py, size / 2, size / 2, 120 * s, 120 * s, 56 * s);
      const aBg = clamp(0.5 - dBg);
      const t = clamp((px + py) / (2 * size));
      let r = a1[0] + (a2[0] - a1[0]) * t;
      let g = a1[1] + (a2[1] - a1[1]) * t;
      let b = a1[2] + (a2[2] - a1[2]) * t;
      // Burbuja de chat
      const dBubble = sdRoundRect(px, py, 128 * s, 116 * s, 76 * s, 56 * s, 34 * s);
      const tx = px - 84 * s;
      const ty = py - 160 * s;
      const inTail = tx > 0 && ty > 0 && ty < 44 * s && tx < 44 * s - ty * 0.9;
      const aBubble = Math.max(clamp(0.5 - dBubble), inTail ? 1 : 0);
      r += (255 - r) * aBubble;
      g += (255 - g) * aBubble;
      b += (255 - b) * aBubble;
      // Tres puntos
      for (const cx of [96, 128, 160]) {
        const d = Math.hypot(px - cx * s, py - 116 * s) - 11 * s;
        const ad = clamp(0.5 - d) * aBubble;
        r += (a1[0] * 0.7 - r) * ad;
        g += (a1[1] * 0.7 - g) * ad;
        b += (a1[2] * 0.7 - b) * ad;
      }
      let alpha = aBg;
      if (badge) {
        const dRing = Math.hypot(px - 206 * s, py - 50 * s) - 50 * s;
        const dDot = Math.hypot(px - 206 * s, py - 50 * s) - 38 * s;
        const aRing = clamp(0.5 - dRing);
        const aDot = clamp(0.5 - dDot);
        alpha = Math.max(alpha, aRing);
        r = r * (1 - aRing) + 255 * aRing;
        g = g * (1 - aRing) + 255 * aRing;
        b = b * (1 - aRing) + 255 * aRing;
        r += (239 - r) * aDot;
        g += (68 - g) * aDot;
        b += (68 - b) * aDot;
      }
      const i = (y * size + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = alpha * 255;
    }
  }
  return encodePng(size, size, buf);
}
