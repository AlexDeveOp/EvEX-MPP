// Convierte el cuerpo de un mensaje en HTML seguro.
import { esc } from "./dom.js";
import { S } from "./state.js";
import { emojifyHtml, replaceEmoticons, replaceShortcodes, customEmojiMap, isEmojiOnly } from "./emoji.js";

import { t, locale } from "./i18n.js";
const TOKEN_RE = /```([\s\S]*?)```|`([^`\n]+)`|\b((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]}*_~]|xmpp:[^\s<>"']+[^\s<>"'.,;:!?)\]}])/gi;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif)(\?[^#]*)?(#.*)?$/i;
const YT_RE = /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/i;

export function mentionRegex(words) {
  const list = words.filter((w) => w && w.trim().length > 1).map((w) => w.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!list.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}_])(${list.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
}

function plainToHtml(text, { mentionRe, custom }) {
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
  html = emojifyHtml(html);
  html = html.replace(/\n/g, "<br>");
  // eslint-disable-next-line no-control-regex -- \u0000 marca dónde va cada emoji personalizado; el texto escapado no puede contenerlo.
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => pieces[i]);
}

function shortUrl(url) {
  const u = url.replace(/^https?:\/\//, "");
  return u.length > 70 ? `${u.slice(0, 45)}…${u.slice(-20)}` : u;
}

export function formatBody(body, { mentionWords = [] } = {}) {
  const mentionRe = mentionRegex(mentionWords);
  const custom = customEmojiMap();
  const previews = [];
  let html = "";
  let last = 0;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(body))) {
    if (m.index > last) html += plainToHtml(body.slice(last, m.index), { mentionRe, custom });
    if (m[1] != null) html += `<pre class="code-block"><code>${esc(m[1].replace(/^\n/, ""))}</code></pre>`;
    else if (m[2] != null) html += `<code class="code-inline">${esc(m[2])}</code>`;
    else {
      const raw = m[3];
      const href = raw.startsWith("www.") ? `https://${raw}` : raw;
      html += `<a class="link" href="${esc(href)}" title="${esc(href)}">${esc(shortUrl(raw))}</a>`;
      if (S.settings.behavior.linkPreviews && /^https?:/.test(href)) {
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
  if (last < body.length) html += plainToHtml(body.slice(last), { mentionRe, custom });

  const mention = !!mentionRe && new RegExp(mentionRe.source, "iu").test(body);
  const jumbo = S.settings.jumboEmoji && isEmojiOnly(replaceShortcodes(body));
  return { html, previews, mention, jumbo };
}

export function previewHtml(p) {
  if (p.type === "image") return `<a class="preview image" href="${esc(p.url)}"><img src="${esc(p.url)}" loading="lazy" alt="" referrerpolicy="no-referrer"></a>`;
  if (p.type === "youtube")
    return `<a class="preview youtube" href="${esc(p.url)}"><img src="https://i.ytimg.com/vi/${esc(p.id)}/hqdefault.jpg" loading="lazy" alt="" referrerpolicy="no-referrer"><span class="play">▶</span></a>`;
  return "";
}

// ---------- fechas ----------

export function fmtTime(ts) {
  const s = S.settings;
  return new Date(ts).toLocaleTimeString(locale(), {
    hour: "2-digit",
    minute: "2-digit",
    ...(s.showSeconds ? { second: "2-digit" } : {}),
    hour12: s.timeFormat === "12",
  });
}

// Hora EVE = UTC, siempre en 24 h como dentro del juego.
export function fmtEve(ts, seconds = S.settings.showSeconds) {
  return new Date(ts).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: false, timeZone: "UTC" });
}

export function fmtEveDateTime(ts) {
  return new Date(ts).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "medium", hour12: false, timeZone: "UTC" });
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
  return d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
}

export function fmtDateTime(ts) {
  return new Date(ts).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short", hour12: S.settings.timeFormat === "12" });
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return t("ahora");
  if (s < 3600) return t("hace {n} min", { n: Math.floor(s / 60) });
  if (s < 86400) return t("hace {n} h", { n: Math.floor(s / 3600) });
  return t("hace {n} d", { n: Math.floor(s / 86400) });
}
