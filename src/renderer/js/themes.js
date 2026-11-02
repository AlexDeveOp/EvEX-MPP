// Temas predefinidos, fuentes y aplicación de la apariencia (colores, fondos, tipografía, densidad).
import { S, api } from "./state.js";

import { t, tk } from "./i18n.js";
export const TOKENS = [
  ["bg", t("Fondo principal")],
  ["bg2", t("Barra lateral")],
  ["bg3", t("Paneles y campos")],
  ["surface", t("Tarjetas y menús")],
  ["hover", t("Elemento resaltado")],
  ["border", t("Bordes")],
  ["text", t("Texto")],
  ["text2", t("Texto secundario")],
  ["accent", t("Color de acento")],
  ["accent2", t("Acento secundario")],
  ["accentText", t("Texto sobre acento")],
  ["link", t("Enlaces")],
  ["mention", t("Fondo de mención")],
  ["bubbleIn", t("Burbuja recibida")],
  ["bubbleOut", t("Burbuja enviada")],
  ["bubbleOutText", t("Texto burbuja enviada")],
  ["titlebar", t("Barra de título")],
  ["ok", t("Conectado / éxito")],
  ["warn", t("Ausente / aviso")],
  ["danger", t("Ocupado / error")],
];

const dark = {
  scheme: "dark", bg: "#0d1117", bg2: "#10151d", bg3: "#161d27", surface: "#1a2230", hover: "#202b3b", border: "#263244",
  text: "#e6edf3", text2: "#8b98a9", accent: "#3b9bff", accent2: "#8b5cf6", accentText: "#ffffff", link: "#58a6ff",
  mention: "#3b9bff26", bubbleIn: null, bubbleOut: "#1f6feb", bubbleOutText: "#ffffff", titlebar: "#0b0f15",
  ok: "#3fb950", warn: "#d29922", danger: "#f85149", nickL: "68%", nickS: "70%",
};
const light = {
  scheme: "light", bg: "#ffffff", bg2: "#f4f6f9", bg3: "#eef1f5", surface: "#ffffff", hover: "#e7ebf0", border: "#d8dee6",
  text: "#1b2330", text2: "#5d6b7d", accent: "#2563eb", accent2: "#7c3aed", accentText: "#ffffff", link: "#1d4ed8",
  mention: "#2563eb1f", bubbleIn: null, bubbleOut: "#2563eb", bubbleOutText: "#ffffff", titlebar: "#eef1f5",
  ok: "#16a34a", warn: "#b45309", danger: "#dc2626", nickL: "38%", nickS: "70%",
};

export const PRESETS = {
  "eve-dark": { name: tk("EvEX Oscuro"), ...dark },
  gold: { name: tk("Oro"), ...dark, bg: "#0f0f0c", bg2: "#14140f", bg3: "#1b1b14", surface: "#212117", hover: "#2a2a1c", border: "#34331f", accent: "#e8c547", accent2: "#f59e0b", accentText: "#1a1600", link: "#f2d36b", mention: "#e8c54726", bubbleOut: "#8a7420", titlebar: "#0b0b08" },
  caldari: { name: tk("Caldari (acero)"), ...dark, bg: "#0b1218", bg2: "#0e161e", bg3: "#13202b", surface: "#172634", hover: "#1d3042", border: "#24394d", accent: "#5ab8e6", accent2: "#9ad4f0", accentText: "#06131b", link: "#7cc9ee", mention: "#5ab8e624", bubbleOut: "#1d5f80", titlebar: "#081016" },
  amarr: { name: tk("Amarr (oro imperial)"), ...dark, bg: "#16110a", bg2: "#1b150c", bg3: "#241b10", surface: "#2b2114", hover: "#352816", border: "#43331c", text: "#f4e9d6", text2: "#b5a385", accent: "#d4a24c", accent2: "#f0d18a", accentText: "#1a1205", link: "#e8bf6c", mention: "#d4a24c26", bubbleOut: "#7d5a1e", titlebar: "#120d07" },
  gallente: { name: tk("Gallente (esmeralda)"), ...dark, bg: "#0a1411", bg2: "#0d1a16", bg3: "#11231d", surface: "#152b24", hover: "#1a362d", border: "#214236", accent: "#34d399", accent2: "#5eead4", accentText: "#03140d", link: "#6ee7b7", mention: "#34d39924", bubbleOut: "#0f6b4f", titlebar: "#08100d" },
  minmatar: { name: tk("Minmatar (óxido)"), ...dark, bg: "#140d0b", bg2: "#1a110e", bg3: "#231713", surface: "#2a1c17", hover: "#35231c", border: "#432c22", text: "#f2e4dc", text2: "#b09184", accent: "#e0663a", accent2: "#f59e0b", accentText: "#1a0802", link: "#f08a62", mention: "#e0663a26", bubbleOut: "#8a3517", titlebar: "#100a08" },
  amoled: { name: tk("AMOLED negro"), ...dark, bg: "#000000", bg2: "#050505", bg3: "#0c0c0c", surface: "#121212", hover: "#1b1b1b", border: "#222222", bubbleIn: "#121212", titlebar: "#000000" },
  nord: { name: tk("Nord"), ...dark, bg: "#2e3440", bg2: "#2b303b", bg3: "#3b4252", surface: "#3b4252", hover: "#434c5e", border: "#4c566a", text: "#eceff4", text2: "#a3adbf", accent: "#88c0d0", accent2: "#b48ead", accentText: "#1d232d", link: "#8fbcbb", mention: "#88c0d02e", bubbleIn: "#3b4252", bubbleOut: "#5e81ac", titlebar: "#272c36", ok: "#a3be8c", warn: "#ebcb8b", danger: "#bf616a" },
  dracula: { name: tk("Dracula"), ...dark, bg: "#282a36", bg2: "#21222c", bg3: "#343746", surface: "#343746", hover: "#3e4153", border: "#44475a", text: "#f8f8f2", text2: "#a4a9c6", accent: "#bd93f9", accent2: "#ff79c6", accentText: "#1a1325", link: "#8be9fd", mention: "#bd93f92e", bubbleIn: "#343746", bubbleOut: "#6c4bb8", titlebar: "#1e1f28", ok: "#50fa7b", warn: "#f1fa8c", danger: "#ff5555" },
  synthwave: { name: tk("Synthwave"), ...dark, bg: "#1a1028", bg2: "#1e1230", bg3: "#28183f", surface: "#2d1b47", hover: "#382257", border: "#46296b", text: "#f6eaff", text2: "#b59ad6", accent: "#ff3ea5", accent2: "#00e5ff", accentText: "#ffffff", link: "#5ef0ff", mention: "#ff3ea52e", bubbleIn: "#2d1b47", bubbleOut: "#b31d78", titlebar: "#150c21" },
  light: { name: tk("Claro"), ...light },
  pidgin: { name: tk("Clásico (estilo Pidgin)"), ...light, bg: "#ffffff", bg2: "#ececec", bg3: "#f6f6f6", surface: "#ffffff", hover: "#dcdcdc", border: "#c4c4c4", accent: "#3465a4", accent2: "#a82f2f", link: "#204a87", mention: "#fce94f80", bubbleIn: "#f2f2f2", bubbleOut: "#3465a4", titlebar: "#e4e4e4" },
  solarized: { name: tk("Solarized claro"), ...light, bg: "#fdf6e3", bg2: "#eee8d5", bg3: "#f5efdc", surface: "#fdf6e3", hover: "#e6dfc8", border: "#d8cfb4", text: "#3c4a50", text2: "#6f7f84", accent: "#268bd2", accent2: "#d33682", link: "#2075b5", mention: "#b5890033", bubbleIn: "#eee8d5", bubbleOut: "#268bd2", titlebar: "#eee8d5", ok: "#859900", warn: "#b58900", danger: "#dc322f" },
};

export const GRADIENTS = {
  nebula: "radial-gradient(ellipse at 20% 10%, #3b1d6e 0%, transparent 55%), radial-gradient(ellipse at 85% 80%, #0c4a6e 0%, transparent 50%), radial-gradient(ellipse at 60% 40%, #6b1d4f55 0%, transparent 45%), #070910",
  aurora: "linear-gradient(160deg, #031b1f 0%, #053d3a 35%, #1c1b4d 70%, #0b0b1a 100%)",
  sunset: "linear-gradient(160deg, #2b0f2e 0%, #6b1f3a 40%, #c2552d 80%, #f2a65a 100%)",
  ocean: "linear-gradient(180deg, #021526 0%, #03346e 60%, #6eacda 130%)",
  ember: "radial-gradient(circle at 70% 120%, #7c2d12 0%, transparent 60%), linear-gradient(180deg, #0c0a09, #1c1210)",
  gold: "radial-gradient(circle at 10% 0%, #5a4410 0%, transparent 50%), linear-gradient(180deg, #0f0e0a, #16130b)",
  grid: "linear-gradient(#ffffff08 1px, transparent 1px) 0 0 / 28px 28px, linear-gradient(90deg, #ffffff08 1px, transparent 1px) 0 0 / 28px 28px, #0b1018",
  paper: "linear-gradient(180deg, #fffdf7, #f3ecdc)",
};

export const BUNDLED_FONTS = [
  ["Inter Variable", t("Inter (moderna)")],
  ["Nunito Variable", t("Nunito (redondeada)")],
  ["Rajdhani", t("Rajdhani (sci-fi)")],
  ["Orbitron Variable", t("Orbitron (futurista)")],
  ["JetBrains Mono Variable", t("JetBrains Mono (monoespaciada)")],
  ["Segoe UI", t("Segoe UI (Windows)")],
  ["system-ui", t("Fuente del sistema")],
];

const FONT_CSS = {
  "Inter Variable": "@fontsource-variable/inter/index.css",
  "Nunito Variable": "@fontsource-variable/nunito/index.css",
  "Orbitron Variable": "@fontsource-variable/orbitron/index.css",
  "JetBrains Mono Variable": "@fontsource-variable/jetbrains-mono/index.css",
  Rajdhani: ["@fontsource/rajdhani/400.css", "@fontsource/rajdhani/500.css", "@fontsource/rajdhani/600.css", "@fontsource/rajdhani/700.css"],
};
const loadedFonts = new Set();
function ensureFont(family) {
  const css = FONT_CSS[family];
  if (!css || loadedFonts.has(family)) return;
  loadedFonts.add(family);
  for (const href of [css].flat()) document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: `app://evex/node_modules/${href}` }));
}

const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// Identificador de tema válido. Los de versiones anteriores que ya no existen se reconducen al más parecido.
export function resolveThemeId(id) {
  if (PRESETS[id]) return id;
  if (/gold/i.test(id || "")) return "gold";
  return "eve-dark";
}

export function themeColors(settings = S.settings) {
  const base = PRESETS[resolveThemeId(settings.theme)];
  const out = { ...base, ...(settings.colors || {}) };
  // La burbuja recibida sigue al color de tarjeta del tema salvo que se indique otra cosa.
  out.bubbleIn ??= out.scheme === "light" ? out.bg3 : out.surface;
  return out;
}

// Ajustes de una imagen de fondo (los que falten valen lo de antes: llenar, centrada, sin zoom ni filtros).
export const IMAGE_FITS = ["cover", "contain", "stretch", "tile", "original"];
const clampNum = (v, min, max, def) => (v != null && Number.isFinite(+v) ? Math.min(max, Math.max(min, +v)) : def);
export function imageAdjust(bg) {
  return {
    fit: IMAGE_FITS.includes(bg?.fit) ? bg.fit : "cover",
    zoom: clampNum(bg?.zoom, 1, 4, 1),
    posX: clampNum(bg?.posX, 0, 100, 50),
    posY: clampNum(bg?.posY, 0, 100, 50),
    brightness: clampNum(bg?.brightness, 0.3, 1.6, 1),
    saturate: clampNum(bg?.saturate, 0, 2, 1),
  };
}

// Pinta un fondo en una capa (ventana, barra lateral, sala o la vista previa del editor), con encaje, zoom, posición
// y filtros. El zoom va con transform para que funcione igual con todos los encajes (también el mosaico).
export function applyBackgroundLayer(el, bg) {
  if (!el) return;
  const on = !!bg && bg.type !== "none" && !!bg.value;
  const s = el.style;
  s.background = on ? backgroundCss(bg) : "";
  s.opacity = on ? (bg.opacity ?? 1) : 0;
  const a = imageAdjust(bg);
  const isImage = on && bg.type === "image";
  const filters = [bg?.blur ? `blur(${bg.blur}px)` : "", isImage && a.brightness !== 1 ? `brightness(${a.brightness})` : "", isImage && a.saturate !== 1 ? `saturate(${a.saturate})` : ""];
  s.filter = filters.filter(Boolean).join(" ");
  s.transform = isImage && a.zoom !== 1 ? `scale(${a.zoom})` : "";
  s.transformOrigin = isImage ? `${a.posX}% ${a.posY}%` : "";
}

export function backgroundCss(bg) {
  if (!bg || bg.type === "none" || !bg.value) return "";
  if (bg.type === "image") {
    const a = imageAdjust(bg);
    const size = { cover: "cover", contain: "contain", stretch: "100% 100%", tile: "auto", original: "auto" }[a.fit];
    return `url("${bg.value.replace(/["\\\n]/g, encodeURIComponent)}") ${a.posX}% ${a.posY}% / ${size} ${a.fit === "tile" ? "repeat" : "no-repeat"}`;
  }
  if (bg.type === "gradient") return GRADIENTS[bg.value] || bg.value;
  if (bg.type === "color") return bg.value;
  return "";
}

export function applyAppearance(settings = S.settings) {
  const root = document.documentElement;
  const c = themeColors(settings);
  for (const [k, v] of Object.entries(c)) if (k !== "name" && k !== "scheme") root.style.setProperty(`--${kebab(k)}`, v);
  root.dataset.scheme = c.scheme;
  root.style.colorScheme = c.scheme;

  ensureFont(settings.fontFamily);
  ensureFont(settings.monoFamily);
  root.style.setProperty("--font", `"${settings.fontFamily}", "Segoe UI", system-ui, sans-serif`);
  root.style.setProperty("--mono", `"${settings.monoFamily}", "Cascadia Code", Consolas, monospace`);
  root.style.setProperty("--font-size", `${settings.fontSize}px`);
  root.style.setProperty("--bubble-radius", `${settings.bubbleRadius}px`);
  root.style.setProperty("--emoji-size", `${settings.emojiSize}em`);
  root.style.setProperty("--sidebar-w", `${settings.layout.sidebarWidth}px`);
  root.style.setProperty("--occupants-w", `${settings.layout.occupantsWidth}px`);
  document.body.style.zoom = settings.uiScale;

  const app = document.getElementById("app");
  app.dataset.style = settings.messageStyle;
  app.dataset.density = settings.density;
  app.classList.toggle("no-avatars", !settings.showAvatars);
  app.classList.toggle("no-nick-colors", !settings.nickColors);
  app.classList.toggle("compact-sidebar", !!settings.layout.compactSidebar);
  app.classList.toggle("hide-occupants", !settings.layout.showOccupants);
  app.classList.toggle("animations", settings.animations !== false);

  const bg = settings.background;
  applyBackgroundLayer(document.getElementById("app-bg"), bg);
  root.style.setProperty("--bg-dim", bg.type === "none" ? 1 : 1 - (bg.dim ?? 0.4) * 0.6);
  app.classList.toggle("has-bg", bg.type !== "none" && !!bg.value);

  const sb = settings.sidebarBackground;
  applyBackgroundLayer(document.getElementById("sidebar-bg"), sb);

  api("window:titlebar", { color: c.titlebar, symbolColor: c.text }).catch(() => {});
}
