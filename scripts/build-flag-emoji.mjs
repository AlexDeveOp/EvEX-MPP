// Genera las banderas que vienen con la app. Las banderas no tienen versión animada y Windows no las dibuja
// (muestra las dos letras del país), así que se incluyen las estáticas de Noto Emoji reducidas a 72 px.
// Uso: npm run assets:flags (tarda ~1 min; solo hace falta al cambiar de versión de Unicode).
// Imágenes: Noto Emoji © Google, licencia Apache 2.0; las banderas vienen de region-flags (dominio público).
// Ver THIRD_PARTY_NOTICES.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "src/renderer/assets/emoji-flags");
const dataFile = path.join(root, "src/renderer/js/data/emoji-flags.js");
const SRC = (key) => `https://fonts.gstatic.com/s/e/notoemoji/latest/${key}/512.png`;
const SIZE = 72;

// Banderas de la lista de emojis: pares de indicadores regionales y las de subdivisión (🏴 + etiquetas).
const { EMOJI } = await import(pathToFileURL(path.join(root, "src/renderer/js/data/emoji.js")).href);
const FLAG = /^(?:\p{RI}\p{RI}|\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F})$/u;
// Mismo nombre que usa emoji.js para buscar el fichero: códigos en hexadecimal unidos por "_".
const key = (e) => [...e].map((c) => c.codePointAt(0).toString(16)).join("_");
const flags = EMOJI.map((e) => e[0]).filter((e) => FLAG.test(e));

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, f));
const done = [];
let bytes = 0;
for (const [n, e] of flags.entries()) {
  const k = key(e);
  const res = await fetch(SRC(k));
  if (!res.ok) {
    console.warn(`  ${k}: HTTP ${res.status}, se omite`);
    continue;
  }
  const out = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 80, effort: 6 })
    .toBuffer();
  const file = path.join(outDir, `${k}.webp`);
  if (path.dirname(file) !== outDir) throw new Error(`nombre no válido: ${k}`);
  fs.writeFileSync(file, out);
  bytes += out.length;
  done.push(k);
  console.log(`${n + 1}/${flags.length} ${e} ${k} ${(out.length / 1024).toFixed(1)} KB`);
}

fs.writeFileSync(
  dataFile,
  `// Generado por scripts/build-flag-emoji.mjs. Banderas incluidas en src/renderer/assets/emoji-flags/.\n` +
    `// Noto Emoji © Google, Apache 2.0 (banderas de region-flags, dominio público), reducidas a ${SIZE} px.\n` +
    `export const BUNDLED_FLAGS = new Set(${JSON.stringify(done.sort())});\n`,
);
console.log(`${done.length} banderas, ${(bytes / 1024).toFixed(0)} KB en total`);
