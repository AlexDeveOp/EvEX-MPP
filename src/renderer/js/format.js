// Convierte el cuerpo de un mensaje en HTML seguro.
import { esc } from "./dom.js";
import { S } from "./state.js";
import { emojifyHtml, replaceEmoticons, replaceShortcodes, customEmojiMap, isEmojiOnly } from "./emoji.js";

import { t, locale } from "./i18n.js";
const TOKEN_RE = /```([\s\S]*?)```|`([^`\n]+)`|\b((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]}*_~]|xmpp:[^\s<>"']+[^\s<>"'.,;:!?)\]}])/gi;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif)(\?[^#]*)?(#.*)?$/i;
const YT_RE = /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/i;

// Se guardan por lista de palabras: cada mensaje pedía la misma expresión dos veces. Es global (flag g), así que
// quien use .test() debe poner antes lastIndex a 0.
const mentionCache = new Map();
export function mentionRegex(words) {
  const key = words.join("|");
  if (mentionCache.has(key)) return mentionCache.get(key);
  if (mentionCache.size > 200) mentionCache.clear();
  const re = buildMentionRegex(words);
  mentionCache.set(key, re);
  return re;
}

function buildMentionRegex(words) {
  const list = words.filter((w) => w && w.trim().length > 1).map((w) => w.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!list.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}_])(${list.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
}

// Marca las coincidencias solo en el texto, sin entrar en etiquetas ni entidades HTML.
function markText(html, re, open) {
  return html.replace(/(<[^>]*>|&[#\w]+;)|[^<&]+/g, (m, skip) => (skip ? m : m.replace(re, (x) => (x ? `${open}${x}</mark>` : x))));
}

function plainToHtml(text, { mentionRe, rules, custom }) {
  const s = S.settings;
  if (s.emoticonToEmoji) text = replaceEmoticons(text);
  text = replaceShortcodes(text);
  const pieces = [];
  // Emojis personalizados :nombre:
  text = text.replace(/:([a-z0-9_+-]{1,40}):/gi, (m, name) => {
    const url = custom.get(name.toLowerCase());
    if (!url) return m;
    pieces.push(`<img class="emoji custom" src="${esc(url)}" alt=":${esc(name)}:" title=":${esc(name)}:" draggable="false">`);
    return `\u0000${pieces.length - 1}\u0000`;
  });
  let html = esc(text);
  html = html
    .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=$|[\s).,!?:;])/g, "$1<strong>$2</strong>")
    .replace(/(^|[\s(])_(?!\s)([^_\n]+?)_(?=$|[\s).,!?:;])/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])~(?!\s)([^~\n]+?)~(?=$|[\s).,!?:;])/g, "$1<del>$2</del>");
  if (mentionRe) html = html.replace(mentionRe, '<mark class="mention">$1</mark>');
  // Reglas por palabra clave: cada una con su color (validado como #rrggbb en keywords.js).
  for (const r of rules) html = markText(html, r.re, `<mark class="kw" style="--kw:${r.color}">`);
  html = emojifyHtml(html);
  html = html.replace(/\n/g, "<br>");
  // eslint-disable-next-line no-control-regex -- \u0000 marca dónde va cada emoji personalizado; el texto escapado no puede contenerlo.
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => pieces[i]);
}

function shortUrl(url) {
  const u = url.replace(/^https?:\/\//, "");
  return u.length > 70 ? `${u.slice(0, 45)}…${u.slice(-20)}` : u;
}

export function formatBody(body, { mentionWords = [], rules = [] } = {}) {
  const mentionRe = mentionRegex(mentionWords);
  const custom = customEmojiMap();
  const previews = [];
  let html = "";
  let last = 0;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(body))) {
    if (m.index > last) html += plainToHtml(body.slice(last, m.index), { mentionRe, rules, custom });
    if (m[1] != null) html += `<pre class="code-block"><code>${esc(m[1].replace(/^\n/, ""))}</code></pre>`;
    else if (m[2] != null) html += `<code class="code-inline">${esc(m[2])}</code>`;
    else {
      const raw = m[3];
      const href = raw.startsWith("www.") ? `https://${raw}` : raw;
      html += `<a class="link" href="${esc(href)}" title="${esc(href)}">${esc(shortUrl(raw))}</a>`;
      if (previewMode() !== "off" && /^https?:/.test(href)) {
        let pathname = "";
        try {
          pathname = new URL(href).pathname;
        } catch {}
        if (IMAGE_RE.test(pathname)) previews.push({ type: "image", url: href });
        else {
          const yt = href.match(YT_RE);
          if (yt) previews.push({ type: "youtube", id: yt[1], url: href });
        }
      }
    }
    last = TOKEN_RE.lastIndex;
  }
  if (last < body.length) html += plainToHtml(body.slice(last), { mentionRe, rules, custom });

  if (mentionRe) mentionRe.lastIndex = 0;
  const mention = !!mentionRe && mentionRe.test(body);
  const jumbo = S.settings.jumboEmoji && isEmojiOnly(replaceShortcodes(body));
  return { html, previews, mention, jumbo };
}

// Vistas previas: "click" (por defecto: un recuadro que no pide nada hasta pulsarlo), "auto" u "off".
export const previewMode = () => {
  const m = S.settings?.behavior?.linkPreviewMode;
  return m === "auto" || m === "off" ? m : "click";
};

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

// Todas llevan .link-preview (clase estable para otras partes de la app, p. ej. el modo captura).
// pending: el recuadro «clic para cargar», sin ninguna petición a la red hasta que se pulse (loadPendingPreview).
export function previewHtml(p, { pending = false } = {}) {
  if (pending && (p.type === "image" || p.type === "youtube")) {
    const label = p.type === "youtube" ? t("Vídeo de YouTube · clic para cargar") : t("Imagen de {host} · clic para cargar", { host: hostOf(p.url) });
    return `<button type="button" class="link-preview preview-pending ${p.type}" data-preview="${esc(JSON.stringify(p))}" title="${esc(p.url)}"><span class="preview-pending-icon">${p.type === "youtube" ? "▶" : "🖼"}</span>${esc(label)}</button>`;
  }
  if (p.type === "image") return `<a class="link-preview preview image" href="${esc(p.url)}"><img src="${esc(p.url)}" loading="lazy" alt="" referrerpolicy="no-referrer"></a>`;
  if (p.type === "youtube")
    return `<a class="link-preview preview youtube" href="${esc(p.url)}"><img src="https://i.ytimg.com/vi/${esc(p.id)}/hqdefault.jpg" loading="lazy" alt="" referrerpolicy="no-referrer"><span class="play">▶</span></a>`;
  return "";
}

// Clic en un recuadro «clic para cargar»: se cambia por la vista previa de verdad (solo ahí se pide la imagen).
// Devuelve true si el clic era en un recuadro.
export function loadPendingPreview(target) {
  const btn = target?.closest?.(".preview-pending");
  if (!btn) return false;
  let p = null;
  try {
    p = JSON.parse(btn.dataset.preview || "null");
  } catch {}
  if (!p || !/^https?:/i.test(String(p.url || "")) || (p.type === "youtube" && !/^[\w-]{6,}$/.test(String(p.id || "")))) return true;
  btn.outerHTML = previewHtml(p);
  return true;
}

/// ---------- fechas ----------

// Crear un Intl.DateTimeFormat es lo caro (toLocale*String crea uno en cada llamada): se guardan por idioma y opciones.
const formatters = new Map();
function formatter(opts) {
  const key = `${locale()}|${JSON.stringify(opts)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale(), opts);
    formatters.set(key, f);
  }
  return f;
}

export function fmtTime(ts) {
  const s = S.settings;
  return formatter({ hour: "2-digit", minute: "2-digit", ...(s.showSeconds ? { second: "2-digit" } : {}), hour12: s.timeFormat === "12" }).format(ts);
}

// Hora EVE = UTC, siempre en 24 h como dentro del juego.
export function fmtEve(ts, seconds = S.settings.showSeconds) {
  return formatter({ hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: false, timeZone: "UTC" }).format(ts);
}

export function fmtEveDateTime(ts) {
  return formatter({ dateStyle: "medium", timeStyle: "medium", hour12: false, timeZone: "UTC" }).format(ts);
}

// Texto para tooltips: las dos horas, claramente etiquetadas.
export function fmtTimes(ts) {
  return t("Hora local: {dateTime}\nHora EVE: {eveDateTime}", { dateTime: fmtDateTime(ts), eveDateTime: fmtEveDateTime(ts) });
}

export function fmtDay(ts) {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(Date.now() - 86400e3);
  if (d.toDateString() === today.toDateString()) return t("Hoy");
  if (d.toDateString() === y.toDateString()) return t("Ayer");
  return formatter({ weekday: "long", day: "numeric", month: "long", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined }).format(d);
}

export function fmtDateTime(ts) {
  return formatter({ dateStyle: "medium", timeStyle: "short", hour12: S.settings.timeFormat === "12" }).format(ts);
}

export { timeAgo } from "./countdown.js";
