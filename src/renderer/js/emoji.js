// Emojis: estilos de dibujo, atajos :código:, emoticonos clásicos, emojis personalizados y selector.
import { EMOJI, EMOJI_GROUPS } from "./data/emoji.js";
import { BUNDLED_ANIMATED } from "./data/emoji-anim.js";
import { S, updateSettings } from "./state.js";
import { h, icon, esc } from "./dom.js";

import { t, currentLang } from "./i18n.js";

// Nombre del emoji y de su grupo en el idioma de la interfaz.
const label = (e) => (currentLang() === "es" ? e[1] : e[7]);
const groupName = (g) => (currentLang() === "es" ? g.name : g.nameEn);
export const EMOJI_RE = /(\p{RI}\p{RI}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{EMod})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{EMod})?)*)/gu;

export const SHORTCODES = new Map();
const BY_EMOJI = new Map();
for (const e of EMOJI) {
  BY_EMOJI.set(e[0], e);
  for (const sc of e[2]) SHORTCODES.set(sc, e[0]);
}

export const EMOTICONS = {
  ":)": "🙂", ":-)": "🙂", ":D": "😃", ":-D": "😃", "xD": "😆", "XD": "😆", ";)": "😉", ";-)": "😉", ":(": "🙁", ":-(": "🙁",
  ":P": "😛", ":-P": "😛", ":p": "😛", ":O": "😮", ":o": "😮", ":'(": "😢", ":|": "😐", ":/": "😕", "<3": "❤️", "</3": "💔",
  "B)": "😎", "8)": "😎", ":*": "😘", ">:(": "😠", "o/": "👋", "\\o/": "🙌", ":3": "😺", "^^": "😊", "-_-": "😑", ":S": "😖",
};
const EMOTICON_RE = new RegExp(
  `(^|\\s)(${Object.keys(EMOTICONS).sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})(?=$|\\s)`,
  "g",
);

export function replaceEmoticons(text) {
  return text.replace(EMOTICON_RE, (_, pre, emo) => pre + EMOTICONS[emo]);
}

export function replaceShortcodes(text) {
  return text.replace(/:([a-z0-9_+-]{1,40}):/gi, (m, name) => SHORTCODES.get(name.toLowerCase()) || m);
}

function codepoints(emoji, sep, keepFe0f) {
  const cps = [...emoji].map((c) => c.codePointAt(0));
  const hasZwj = cps.includes(0x200d);
  return cps.filter((cp) => keepFe0f || hasZwj || cp !== 0xfe0f).map((cp) => cp.toString(16)).join(sep);
}

// Clave de los ficheros de Noto: códigos en hexadecimal unidos por "_" y sin fe0f (p. ej. "2764", "1f44d").
const notoKey = (emoji) => codepoints(emoji, "_").replace(/_fe0f/g, "");
// ¿Se pueden descargar de Google los emojis animados que no vienen con la app? (desactivado por defecto: privacidad)
const mayDownload = () => !!S.settings?.downloadEmoji;

// URL de la imagen del emoji, o null si debe mostrarse el emoji de Windows.
// «Noto animados» usa los que vienen con la app y, solo si el usuario lo permite, descarga el resto de Google.
// «Noto estáticos» y «Twemoji» se descargan siempre: el usuario los elige sabiendo que vienen de Internet.
export function emojiImageUrl(emoji, style = S.settings.emojiStyle) {
  if (style === "noto-animated") {
    const key = notoKey(emoji);
    if (BUNDLED_ANIMATED.has(key)) return `assets/emoji-anim/${key}.webp`;
    return mayDownload() ? `https://fonts.gstatic.com/s/e/notoemoji/latest/${key}/512.webp` : null;
  }
  if (style === "noto") return `https://fonts.gstatic.com/s/e/notoemoji/latest/${codepoints(emoji, "_").replace(/_fe0f/g, "")}/emoji.svg`;
  if (style === "twemoji") return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${codepoints(emoji, "-")}.svg`;
  return null;
}

// Devuelve HTML seguro: el texto ya debe venir escapado.
const TEXT_SYMBOLS = new Set(["©", "®", "™", "‼", "⁉", "↔", "↕", "▪", "▫", "◀", "▶"]);

const nativeSpan = (e) => `<span class="emoji-native">${e}</span>`;

export function emojifyHtml(escaped, style = S.settings.emojiStyle) {
  if (style === "native") return escaped.replace(EMOJI_RE, (e) => (TEXT_SYMBOLS.has(e) ? e : nativeSpan(e)));
  return escaped.replace(EMOJI_RE, (e) => {
    if (TEXT_SYMBOLS.has(e)) return e;
    const url = emojiImageUrl(e, style);
    if (!url) return nativeSpan(e);
    const entry = BY_EMOJI.get(e);
    const name = entry ? label(entry) : "";
    return `<img class="emoji" src="${url}" alt="${e}" title="${esc(name)}" draggable="false" data-style="${style}" loading="lazy">`;
  });
}

export function customEmojiMap() {
  return new Map((S.settings.customEmoji || []).map((c) => [c.name.toLowerCase(), c.url]));
}

// Cadena de reserva si una imagen de emoji no existe (p. ej. emoji sin versión animada).
document.addEventListener(
  "error",
  (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains("emoji")) return;
    if (img.dataset.style === "noto-animated" && mayDownload()) {
      img.dataset.style = "noto";
      img.src = emojiImageUrl(img.alt, "noto");
    } else {
      img.replaceWith(Object.assign(document.createElement("span"), { className: "emoji-native", textContent: img.alt }));
    }
  },
  true,
);

export function isEmojiOnly(text) {
  const stripped = text.replace(EMOJI_RE, "").replace(/[\s\uFE0F\u200D]/g, "");
  const count = (text.match(EMOJI_RE) || []).length;
  return !stripped && count > 0 && count <= 8;
}

// ---------- recientes ----------

function recent() {
  try {
    return JSON.parse(localStorage.getItem("evex.recentEmoji") || "[]");
  } catch {
    return [];
  }
}
function pushRecent(e) {
  try {
    const list = [e, ...recent().filter((x) => x !== e)].slice(0, 32);
    localStorage.setItem("evex.recentEmoji", JSON.stringify(list));
  } catch {}
}

// ---------- selector ----------

let pickerEl = null;
export function closePicker() {
  pickerEl?.remove();
  pickerEl = null;
}

// En el selector, «Noto animados» muestra quieto lo que no viene con la app (Noto estático de Google solo si se permite
// descargar; si no, el emoji de Windows). Así abrir el selector no pide cientos de imágenes a Internet.
function pickerImage(u, style) {
  let src = null;
  let dataStyle = style;
  if (style === "noto-animated") {
    src = emojiImageUrl(u, "noto-animated");
    if (src?.startsWith("https:")) {
      src = emojiImageUrl(u, "noto");
      dataStyle = "noto";
    }
  } else if (style !== "native") src = emojiImageUrl(u, style);
  if (!src) return h("span", { class: "emoji-native" }, u);
  return h("img", { class: "emoji", src, alt: u, loading: "lazy", "data-style": dataStyle });
}

export function openPicker(anchor, onPick) {
  if (pickerEl) return closePicker();
  const skin = Number(localStorage.getItem("evex.skin") || 0);
  const style = S.settings.emojiStyle;
  const search = h("input", { class: "input", placeholder: t("Buscar emoji (nombre o :código:)…"), autofocus: true });
  const grid = h("div", { class: "emoji-grid" });
  const preview = h("div", { class: "emoji-preview" }, t("Pasa el ratón sobre un emoji"));
  const tabs = h("div", { class: "emoji-tabs" });

  const sections = [
    { id: "recent", name: "Recientes", icon: "clock" },
    ...(S.settings.customEmoji?.length ? [{ id: "custom", name: "Personalizados", icon: "sticker" }] : []),
    ...EMOJI_GROUPS.map((g) => ({ id: g.id, name: groupName(g), icon: ["smile", "user", null, "sparkles", "zap", "globe", "swords", "lock", "hash", "flag"][g.id] || "circle" })),
  ];

  const cell = (e) => {
    const u = skin && e[6] ? e[6][skin - 1] : e[0];
    const inner = pickerImage(u, style);
    return h(
      "button",
      {
        class: "emoji-cell",
        type: "button",
        title: label(e),
        onclick: (ev) => {
          pushRecent(e[0]);
          onPick(u);
          if (!ev.shiftKey) closePicker();
        },
        onmouseenter: () => (preview.innerHTML = `${emojifyHtml(u)} <b>${esc(label(e))}</b> <span class="muted">${e[2].map((s) => `:${esc(s)}:`).join(" ")}</span>`),
      },
      inner,
    );
  };
  const customCell = (c) =>
    h(
      "button",
      {
        class: "emoji-cell",
        type: "button",
        title: `:${c.name}:`,
        onclick: (ev) => {
          onPick(`:${c.name}:`);
          if (!ev.shiftKey) closePicker();
        },
        onmouseenter: () => (preview.innerHTML = `<img class="emoji custom" src="${esc(c.url)}"> <b>:${esc(c.name)}:</b>`),
      },
      h("img", { class: "emoji custom", src: c.url, alt: `:${c.name}:`, loading: "lazy" }),
    );

  function render() {
    grid.innerHTML = "";
    const q = search.value.trim().toLowerCase().replace(/^:|:$/g, "");
    if (q) {
      const custom = (S.settings.customEmoji || []).filter((c) => c.name.includes(q));
      const found = EMOJI.filter((e) => e[1].toLowerCase().includes(q) || e[7].toLowerCase().includes(q) || e[4].includes(q) || e[8].includes(q) || e[2].some((s) => s.includes(q))).slice(0, 240);
      grid.append(h("div", { class: "emoji-section-title" }, t("Resultados ({x})", { x: found.length + custom.length })), h("div", { class: "emoji-cells" }, custom.map(customCell), found.map(cell)));
      return;
    }
    for (const sec of sections) {
      let cells;
      if (sec.id === "recent") {
        const r = recent().map((u) => BY_EMOJI.get(u)).filter(Boolean);
        if (!r.length) continue;
        cells = r.map(cell);
      } else if (sec.id === "custom") cells = S.settings.customEmoji.map(customCell);
      else cells = EMOJI.filter((e) => e[3] === sec.id).map(cell);
      grid.append(h("div", { class: "emoji-section-title", id: `emo-sec-${sec.id}` }, sec.name), h("div", { class: "emoji-cells" }, cells));
    }
  }

  for (const sec of sections) {
    tabs.append(h("button", { class: "icon-btn", title: sec.name, type: "button", onclick: () => grid.querySelector(`#emo-sec-${sec.id}`)?.scrollIntoView({ block: "start" }) }, icon(sec.icon)));
  }
  const skins = ["✋", "✋🏻", "✋🏼", "✋🏽", "✋🏾", "✋🏿"];
  const skinBtn = h("button", { class: "icon-btn skin-btn", title: t("Tono de piel"), type: "button" }, skins[skin]);
  skinBtn.onclick = () => {
    const next = (Number(localStorage.getItem("evex.skin") || 0) + 1) % 6;
    localStorage.setItem("evex.skin", next);
    closePicker();
    openPicker(anchor, onPick);
  };

  search.addEventListener("input", render);
  pickerEl = h("div", { class: "emoji-picker" }, h("div", { class: "emoji-top" }, search, skinBtn), tabs, grid, preview);
  document.getElementById("menu-root").append(pickerEl);
  const r = anchor.getBoundingClientRect();
  const pr = pickerEl.getBoundingClientRect();
  pickerEl.style.left = `${Math.max(8, Math.min(r.right - pr.width, innerWidth - pr.width - 8))}px`;
  pickerEl.style.top = `${Math.max(8, r.top - pr.height - 8)}px`;
  render();
  setTimeout(() => search.focus(), 20);
}

document.addEventListener("pointerdown", (e) => {
  if (pickerEl && !pickerEl.contains(e.target) && !e.target.closest(".emoji-toggle")) closePicker();
});
document.addEventListener("keydown", (e) => e.key === "Escape" && closePicker());

// Autocompletado de :código: en el compositor
export function shortcodeSuggestions(prefix, limit = 8) {
  const p = prefix.toLowerCase();
  const out = [];
  for (const c of S.settings.customEmoji || []) if (c.name.startsWith(p)) out.push({ code: c.name, url: c.url, custom: true });
  for (const [code, u] of SHORTCODES) {
    if (out.length >= limit) break;
    if (code.startsWith(p)) out.push({ code, emoji: u });
  }
  return out.slice(0, limit);
}

export function addCustomEmoji(list) {
  updateSettings((s) => {
    const map = new Map((s.customEmoji || []).map((c) => [c.name, c]));
    for (const c of list) map.set(c.name, c);
    s.customEmoji = [...map.values()];
  });
}
