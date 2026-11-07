// Genera los datos estáticos que usa la interfaz: iconos (Lucide) y emojis (emojibase, en español).
// Ejecutar con `npm run assets` después de actualizar dependencias.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nm = (...p) => path.join(root, "node_modules", ...p);
const outDir = path.join(root, "src", "renderer", "js", "data");
fs.mkdirSync(outDir, { recursive: true });

const ICONS = [
  "image-plus", "zoom-in", "zoom-out", "circle-user-round", "message-square", "messages-square", "users", "user", "user-plus", "user-x", "user-cog", "hash", "search",
  "settings", "x", "plus", "minus", "star", "star-off", "log-in", "log-out", "door-open", "bell", "bell-off",
  "bell-ring", "smile", "smile-plus", "send", "paperclip", "image", "palette", "type", "sun", "moon", "monitor",
  "list", "compass", "refresh-cw", "trash-2", "pencil", "check", "check-check", "chevron-down", "chevron-right",
  "chevron-up", "circle", "eye", "eye-off", "lock", "key-round", "server", "globe", "download", "upload",
  "folder-open", "volume-2", "volume-x", "zap", "radio", "siren", "megaphone", "history", "sliders-horizontal",
  "info", "triangle-alert", "copy", "at-sign", "pin", "shield", "crown", "mic-off", "ellipsis-vertical",
  "panel-right", "panel-left", "sparkles", "wifi", "wifi-off", "power", "funnel", "arrow-down", "arrow-up", "rocket",
  "crosshair", "layout-dashboard", "reply", "quote", "link", "external-link", "file-text", "book-marked", "ban",
  "keyboard", "wand-sparkles", "brush", "sticker", "import", "database", "clock", "calendar", "map-pin",
  "swords", "flag", "moon-star", "circle-dot", "circle-minus", "circle-slash", "message-circle", "inbox",
  "bookmark", "bookmark-plus", "list-filter", "cloud-download", "cloud-upload", "square-pen", "shield-check",
  "hourglass", "sticky-note", "clipboard-copy", "calendar-check", "calendar-plus", "picture-in-picture-2",
];

const icons = {};
for (const name of ICONS) {
  const file = nm("lucide-static", "icons", `${name}.svg`);
  if (!fs.existsSync(file)) {
    console.warn("Icono no encontrado:", name);
    continue;
  }
  const svg = fs.readFileSync(file, "utf8");
  const inner = svg.slice(svg.indexOf(">", svg.indexOf("<svg")) + 1, svg.lastIndexOf("</svg>"));
  icons[name] = inner.replace(/\s*\n\s*/g, "").trim();
}
fs.writeFileSync(
  path.join(outDir, "icons.js"),
  `// Generado por scripts/build-assets.mjs a partir de lucide-static (ISC). No editar a mano.\nexport const ICONS = ${JSON.stringify(icons, null, 0)};\n`,
);

const es = JSON.parse(fs.readFileSync(nm("emojibase-data", "es", "compact.json"), "utf8"));
const github = JSON.parse(fs.readFileSync(nm("emojibase-data", "en", "shortcodes", "github.json"), "utf8"));
const messages = JSON.parse(fs.readFileSync(nm("emojibase-data", "es", "messages.json"), "utf8"));

// Nombres en español e inglés: la interfaz muestra los del idioma activo y el buscador acepta ambos.
const enList = JSON.parse(fs.readFileSync(nm("emojibase-data", "en", "compact.json"), "utf8"));
const enByHex = new Map(enList.map((e) => [e.hexcode, e]));
const enMessages = JSON.parse(fs.readFileSync(nm("emojibase-data", "en", "messages.json"), "utf8"));
const enGroup = new Map(enMessages.groups.map((g) => [g.key, g.message]));

const groups = messages.groups.filter((g) => g.key !== "component").map((g) => ({ id: g.order, key: g.key, name: g.message, nameEn: enGroup.get(g.key) || g.message }));
const list = es
  .filter((e) => e.group !== undefined && e.group !== 2)
  .sort((a, b) => a.order - b.order)
  .map((e) => {
    const sc = github[e.hexcode];
    const shortcodes = sc ? (Array.isArray(sc) ? sc : [sc]) : [];
    const skins = e.skins ? e.skins.map((s) => s.unicode) : undefined;
    const en = enByHex.get(e.hexcode);
    return [e.unicode, e.label, shortcodes, e.group, (e.tags || []).join(" "), e.hexcode, skins || 0, en?.label || e.label, (en?.tags || []).join(" ")];
  });

fs.writeFileSync(
  path.join(outDir, "emoji.js"),
  `// Generado por scripts/build-assets.mjs a partir de emojibase-data (MIT). No editar a mano.\n` +
    `// Formato: [emoji, nombre_es, shortcodes, grupo, etiquetas_es, hexcode, tonos o 0, nombre_en, etiquetas_en]\n` +
    `export const EMOJI_GROUPS = ${JSON.stringify(groups)};\n` +
    `export const EMOJI = ${JSON.stringify(list)};\n`,
);

console.log(`Iconos: ${Object.keys(icons).length}/${ICONS.length}, emojis: ${list.length}`);
