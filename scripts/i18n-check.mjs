// Comprueba las traducciones: textos de t("…") sin traducir, traducciones que ya no se usan
// y posibles textos en español que se hayan quedado sin envolver en t().
// Uso: npm run i18n            (falla con código 1 si falta alguna traducción)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dirs = ["src/renderer/js", "src/renderer/js/settings", "src/main"];
const files = dirs.flatMap((d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".js") && f !== "i18n.js").map((f) => path.join(d, f)));

// t("…") traduce; tk("…") marca textos guardados en constantes que se traducen más tarde.
const CALL = /\btk?\(\s*("(?:[^"\\]|\\.)*")/g;
const used = new Map();
const suspects = [];
// Palabras muy frecuentes en español: un literal que las contenga fuera de t() merece revisión.
const SPANISH = /[áéíóúñ¿¡]|\b(de|del|la|las|los|el|en|para|con|sin|por|una|uno|hace|ahora|está|añadir|quitar|abrir|cerrar)\b/i;
const LITERAL = /"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

for (const rel of files) {
  if (rel.includes(`${path.sep}data${path.sep}`)) continue;
  const lines = fs.readFileSync(path.join(root, rel), "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(CALL)) {
      const key = JSON.parse(m[1]);
      used.set(key, used.get(key) || `${rel}:${i + 1}`);
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || /console\.|import |RegExp|\.test\(|\.match\(|querySelector/.test(line)) return;
    for (const m of line.matchAll(LITERAL)) {
      const text = m[1] ?? m[2];
      if (!text || !/\p{L}{3,}/u.test(text) || !SPANISH.test(text)) continue;
      const before = line.slice(Math.max(0, m.index - 4), m.index);
      if (/tk?\(\s*$/.test(before)) continue;
      suspects.push(`${rel}:${i + 1}  ${m[0].slice(0, 110)}`);
    }
  });
}

// HTML estático: elementos con data-i18n="text title placeholder aria-label" (la clave es el texto español del elemento).
for (const rel of ["src/renderer/index.html", "src/renderer/popup.html"]) {
  const html = fs.readFileSync(path.join(root, rel), "utf8");
  for (const m of html.matchAll(/<[^>]*\bdata-i18n="([^"]+)"[^>]*>([^<]*)/g)) {
    const [tag, kinds, text] = m;
    for (const kind of kinds.split(/\s+/)) {
      const value = kind === "text" ? text.trim() : tag.match(new RegExp(`\\s${kind}="([^"]*)"`))?.[1];
      if (value) used.set(value, used.get(value) || rel);
    }
  }
}

// --keys: lista todos los textos (uno por línea, en JSON) para preparar un fichero de idioma nuevo.
if (process.argv.includes("--keys")) {
  console.log([...used.keys()].map((k) => JSON.stringify(k)).join("\n"));
  process.exit(0);
}

const localesDir = path.join(root, "src/renderer/locales");
let failed = false;
for (const file of fs.readdirSync(localesDir).filter((f) => f.endsWith(".js"))) {
  const dict = (await import(pathToFileURL(path.join(localesDir, file)).href)).default;
  const missing = [...used.keys()].filter((k) => !(k in dict));
  const unused = Object.keys(dict).filter((k) => !used.has(k));
  const badVars = Object.entries(dict).filter(([k, v]) => {
    const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(",");
    return used.has(k) && vars(k) !== vars(v);
  });
  console.log(`\n${file}: ${used.size} textos en el código, ${missing.length} sin traducir, ${unused.length} sin usar, ${badVars.length} con variables distintas`);
  for (const k of missing) console.log(`  FALTA   ${JSON.stringify(k)}   (${used.get(k)})`);
  for (const k of unused) console.log(`  SOBRA   ${JSON.stringify(k)}`);
  for (const [k, v] of badVars) console.log(`  VARIABLES ${JSON.stringify(k)} → ${JSON.stringify(v)}`);
  if (missing.length || badVars.length) failed = true;
}

if (suspects.length) {
  console.log(`\nPosibles textos sin envolver en t() (${suspects.length}); revisa si son visibles:`);
  for (const s of suspects) console.log(`  ${s}`);
}
process.exit(failed ? 1 : 0);
