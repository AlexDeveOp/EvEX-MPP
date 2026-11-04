// Vista de pings de flota: convierte los broadcasts (p. ej. de un bot como pingbot) en tarjetas.
import { h, icon, esc } from "./dom.js";
import { formatBody, fmtDateTime, fmtEve, fmtTimes, timeAgo } from "./format.js";
import { S } from "./state.js";
import { matchRule, highlightRules, ruleLabel } from "./keywords.js";
import { parseFormup, countdownText, countdownSettings, watchCountdowns } from "./formup.js";

import { t } from "./i18n.js";
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
const FIELD_RE = /^([A-Za-z][\w ./()'&-]{1,32}?)\s*:[\s\u200B-\u200D\u2060\uFEFF]*(.+)$/;
// p. ej. "~~~ This was a coord broadcast from bob to all at 2026-11-02 12:00:00 EVE ~~~"
const FOOTER_RE = /~~~\s*This was an?\s+(?:[\w-]+\s+)?(?:broadcast|ping)\s+from\s+(\S+)\s+to\s+(\S+)\s+at\s+(.+?)\s*~~~/i;

// Cada ping se analizaba varias veces (tarjeta, filtro, grupos de la cabecera, cuenta atrás, voz): se guarda por texto.
// El resultado no se debe modificar.
const parsed = new Map();
export function parsePing(body) {
  let p = parsed.get(body);
  if (!p) {
    if (parsed.size > 2000) parsed.clear();
    p = parsePingNow(body);
    parsed.set(body, p);
  }
  return p;
}

function parsePingNow(body) {
  const lines = body.split("\n");
  const fields = [];
  const title = [];
  const extra = [];
  let footer = null;
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    // El pie "~~~ This was a … broadcast ~~~" puede venir en su propia línea o al final de otra.
    const inline = line.match(FOOTER_RE);
    const clean = line.replace(INVISIBLE, "");
    const f = inline || clean.match(FOOTER_RE);
    if (f) {
      footer = { from: f[1], to: f[2], at: f[3] };
      // Si el pie solo se reconoce sin los caracteres invisibles, lo que va delante se toma de la versión limpia.
      line = inline ? line.replace(inline[0], "").trim() : clean.replace(f[0], "").trim();
      if (!line) continue;
    }
    const m = line.match(FIELD_RE);
    if (m && !/^https?$/i.test(m[1].trim())) fields.push({ key: m[1].trim(), value: m[2].trim() });
    else if (!fields.length) title.push(line);
    else extra.push(line);
  }
  return { title: title.join(" ") || t("Ping"), fields, extra, footer };
}

const FIELD_ICONS = { "fc name": "crown", fc: "crown", "formup location": "map-pin", formup: "map-pin", location: "map-pin", "pap type": "flag", comms: "radio", doctrine: "swords", ships: "rocket", target: "crosshair", time: "clock" };

function fieldValue(key, value, rules) {
  const k = key.toLowerCase();
  if (/formup|location|system/.test(k)) {
    const sys = value.replace(INVISIBLE, "").trim().split(/[\s,(]/)[0];
    if (/^[A-Za-z0-9-]{3,12}$/.test(sys)) {
      return h("span", { html: formatBody(value, { rules }).html + ` <a class="link dotlan" href="https://evemaps.dotlan.net/system/${encodeURIComponent(sys)}" title="${esc(t("Ver {system} en Dotlan", { system: sys }))}">🗺 Dotlan</a>` });
    }
  }
  return h("span", { html: formatBody(value, { rules }).html });
}

// ---------- pings recientes: la sirena late ----------

const SEEN_KEY = "evex.pingsSeenAt";
// Momento en que se salió por última vez de la vista de pings (para el modo «hasta volver a abrirlos»).
export function pingsSeenAt() {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}
export function markPingsSeen(ts = Date.now()) {
  try {
    localStorage.setItem(SEEN_KEY, String(ts));
  } catch {}
}

// ¿Late la sirena de este ping? Según Preferencias → Pings de flota.
export function isFreshPing(ts, mode = S.settings?.pingHighlight ?? "60", now = Date.now(), seenAt = pingsSeenAt()) {
  if (mode === "unseen") return ts > seenAt;
  const minutes = Number(mode) || 0;
  return minutes > 0 && now - ts < minutes * 60e3;
}

// Cuándo deja de latir la sirena de un ping que llegó en `ts`: Infinity en el modo «hasta volver a abrirlos».
export function freshUntil(ts, mode = S.settings?.pingHighlight ?? "60") {
  if (mode === "unseen") return Infinity;
  return ts + (Number(mode) || 0) * 60e3;
}

// Apaga a su hora la sirena de las tarjetas visibles (antes seguía latiendo hasta que la vista se repintaba).
// Un solo temporizador, puesto para la sirena que antes se apaga; no hay ninguno si no late nada.
let sweepTimer = null;
let sweepAt = Infinity;
function sweepFresh() {
  sweepTimer = null;
  sweepAt = Infinity;
  for (const card of document.querySelectorAll(".ping-card.fresh")) {
    const ts = Number(card.dataset.ts);
    if (!isFreshPing(ts)) card.classList.remove("fresh");
    else watchFresh(ts);
  }
}
function watchFresh(ts) {
  const at = freshUntil(ts);
  if (at === Infinity || at >= sweepAt) return;
  clearTimeout(sweepTimer);
  sweepAt = at;
  sweepTimer = setTimeout(sweepFresh, Math.max(0, at - Date.now()) + 250);
}

export function pingCard(m) {
  const p = parsePing(m.body);
  const fresh = isFreshPing(m.ts);
  if (fresh) watchFresh(m.ts);
  const rule = matchRule(m.body, "pings");
  const rules = highlightRules("pings");
  const formupAt = countdownSettings().enabled ? parseFormup(p, m.ts) : null;
  const cd = formupAt ? countdownText(formupAt) : null;
  if (cd && cd.state !== "old") watchCountdowns();
  const card = h(
    "article",
    { class: `ping-card ${fresh ? "fresh" : ""} ${rule ? "kw" : ""}`, dataset: { key: m.key, ts: String(m.ts) }, style: rule ? { "--kw": rule.color } : null },
    h(
      "header",
      { class: "ping-head" },
      icon("siren", "ping-icon"),
      h("div", { class: "ping-title", html: formatBody(p.title, { rules }).html }),
      rule ? h("span", { class: "kw-tag", title: t("Regla por palabra clave") }, ruleLabel(rule)) : null,
      cd
        ? h(
            "span",
            { class: "formup-chip", dataset: { at: String(formupAt), state: cd.state }, title: t("Hora del formup: {eve} EVE · {local} local", { eve: fmtEve(formupAt), local: fmtDateTime(formupAt) }) },
            icon("clock"),
            h("span", { class: "formup-text" }, cd.text),
          )
        : null,
      p.footer ? h("span", { class: "ping-group", title: t("Destinatarios") }, p.footer.to) : null,
      h("time", { class: "ping-time", title: fmtTimes(m.ts) }, timeAgo(m.ts)),
    ),
    p.fields.length
      ? h(
          "dl",
          { class: "ping-fields" },
          p.fields.map((f) => [h("dt", {}, icon(FIELD_ICONS[f.key.toLowerCase()] || "chevron-right"), f.key), h("dd", {}, fieldValue(f.key, f.value, rules))]),
        )
      : null,
    p.extra.length ? h("div", { class: "ping-extra", html: formatBody(p.extra.join("\n"), { rules }).html }) : null,
    h(
      "footer",
      { class: "ping-foot" },
      p.footer ? h("span", {}, icon("megaphone"), ` ${p.footer.from}`) : h("span", {}, m.nick),
      h(
        "span",
        { class: "ping-times", title: fmtTimes(m.ts) },
        S.settings.showLocalTime !== false ? h("span", { class: "muted" }, `${fmtDateTime(m.ts)} local`) : null,
        S.settings.showEveTime !== false ? h("span", { class: "eve" }, t("{eve} EVE", { eve: fmtEve(m.ts, true) })) : null,
      ),
      h(
        "button",
        {
          class: "btn small ghost",
          onclick: () => navigator.clipboard.writeText(m.body),
          title: t("Copiar el ping completo"),
        },
        icon("copy"),
        t("Copiar"),
      ),
    ),
  );
  return card;
}

export function pingMatches(m, query, group) {
  if (group) {
    const p = parsePing(m.body);
    if ((p.footer?.to || "") !== group) return false;
  }
  if (!query) return true;
  return m.body.replace(INVISIBLE, "").toLowerCase().includes(query.toLowerCase());
}

export function pingGroups(messages) {
  const set = new Set();
  for (const m of messages) {
    const to = parsePing(m.body).footer?.to;
    if (to) set.add(to);
  }
  return [...set].sort();
}
