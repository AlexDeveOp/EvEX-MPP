// Genera build/icon.png y build/icon.ico (varios tamaños) con el mismo dibujo que usa la aplicación.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderIcon } from "../src/main/icon.js";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "build");
fs.mkdirSync(out, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((s) => renderIcon(s));

// ICO con imágenes PNG embebidas (admitido desde Windows Vista).
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
const entries = [];
let offset = 6 + 16 * sizes.length;
sizes.forEach((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s >= 256 ? 0 : s;
  e[1] = s >= 256 ? 0 : s;
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(images[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  entries.push(e);
});
fs.writeFileSync(path.join(out, "icon.ico"), Buffer.concat([header, ...entries, ...images]));
fs.writeFileSync(path.join(out, "icon.png"), renderIcon(512));
console.log("Iconos generados en", out);
