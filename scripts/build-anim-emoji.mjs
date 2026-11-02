// Genera los emojis animados que vienen con la app (sin conexión y sin pedir nada a Google al usarlos).
// Toma los más populares de la lista oficial de Noto Emoji Animation, más los que salen de los emoticonos,
// y los reduce a 72 px. Uso: npm run assets:emoji (tarda ~15 min; solo hace falta al cambiar la selección).
// Animaciones: Animated Noto Emoji © Google, licencia CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/),
// redimensionadas. Ver THIRD_PARTY_NOTICES.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "src/renderer/assets/emoji-anim");
const dataFile = path.join(root, "src/renderer/js/data/emoji-anim.js");
const API = "https://googlefonts.github.io/noto-emoji-animation/data/api.json";
const SRC = (cp) => `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/512.webp`;
const TOP = Number(process.env.TOP) || 150;
const SIZE = 72;
// Emoticonos que la app convierte (emoji.js → EMOTICONS) y algunos habituales en flotas.
const FORCED = ["1f642", "1f603", "1f606", "1f609", "1f641", "1f61b", "1f62e", "1f622", "1f610", "1f615", "2764_fe0f", "1f494", "1f60e", "1f618", "1f620", "1f44b", "1f64c", "1f63a", "1f60a", "1f611", "1f616", "1f44d", "1f44e", "1f525", "1f680", "1f4a5", "2705", "274c", "26a0_fe0f", "1f389", "1f4af", "1f440"];

// Mismo nombre que usa emoji.js para buscar el fichero: códigos en hexadecimal unidos por "_" y sin fe0f.
const key = (cp) => cp.replace(/_fe0f/g, "");
const SKIN = /_?1f3f[b-f]/;

const api = await (await fetch(API)).json();
const byCp = new Map(api.icons.map((i) => [i.codepoint, i]));
const chosen = [];
for (const i of [...api.icons].sort((a, b) => b.popularity - a.popularity)) {
  if (chosen.length >= TOP) break;
  if (!SKIN.test(i.codepoint)) chosen.push(i.codepoint);
}
for (const cp of FORCED) if (byCp.has(cp) && !chosen.includes(cp)) chosen.push(cp);

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, f));
const done = [];
let bytes = 0;
for (const [n, cp] of chosen.entries()) {
  const res = await fetch(SRC(cp));
  if (!res.ok) {
    console.warn(`  ${cp}: HTTP ${res.status}, se omite`);
    continue;
  }
  const out = await sharp(Buffer.from(await res.arrayBuffer()), { animated: true })
    .resize(SIZE, SIZE)
    .webp({ quality: 60, effort: 6, minSize: true, mixed: true })
    .toBuffer();
  fs.writeFileSync(path.join(outDir, `${key(cp)}.webp`), out);
  bytes += out.length;
  done.push(key(cp));
  console.log(`${n + 1}/${chosen.length} ${cp} ${Math.round(out.length / 1024)} KB`);
}

fs.writeFileSync(
  dataFile,
  `// Generado por scripts/build-anim-emoji.mjs. Emojis animados incluidos en src/renderer/assets/emoji-anim/.\n` +
    `// Animated Noto Emoji © Google, CC BY 4.0, redimensionados a ${SIZE} px.\n` +
    `export const BUNDLED_ANIMATED = new Set(${JSON.stringify(done.sort())});\n`,
);
console.log(`${done.length} emojis, ${(bytes / 1024 / 1024).toFixed(1)} MB en total`);
