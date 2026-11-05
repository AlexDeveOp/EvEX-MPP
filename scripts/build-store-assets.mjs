// Genera los logos del paquete de la Microsoft Store (build/appx/*.png) con el mismo dibujo que el icono de la app
// (src/main/icon.js): el cyno solo en los pequeños (44 y 50 px) y con la flota en los grandes. El ancho (310×150) lleva
// el icono centrado sobre fondo transparente.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { renderIcon } from "../src/main/icon.js";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "build", "appx");
fs.mkdirSync(out, { recursive: true });

// PNG RGBA mínimo (el de icon.js no se exporta).
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function decode(buf) {
  let pos = 8;
  let w = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    if (type === "IHDR") w = buf.readUInt32BE(pos + 8);
    if (type === "IDAT") idat.push(buf.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(w * w * 4);
  for (let y = 0; y < w; y++) raw.copy(rgba, y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1));
  return { w, rgba };
}
function encode(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

fs.writeFileSync(path.join(out, "Square44x44Logo.png"), renderIcon(44));
fs.writeFileSync(path.join(out, "StoreLogo.png"), renderIcon(50));
fs.writeFileSync(path.join(out, "Square150x150Logo.png"), renderIcon(150));
// Ficha ancha: el icono de 132 px centrado en 310×150.
const icon = decode(renderIcon(132));
const W = 310;
const H = 150;
const wide = Buffer.alloc(W * H * 4);
const ox = (W - icon.w) >> 1;
const oy = (H - icon.w) >> 1;
for (let y = 0; y < icon.w; y++) icon.rgba.copy(wide, ((oy + y) * W + ox) * 4, y * icon.w * 4, (y + 1) * icon.w * 4);
fs.writeFileSync(path.join(out, "Wide310x150Logo.png"), encode(W, H, wide));
console.log(`Logos de la Store generados en ${out}`);
