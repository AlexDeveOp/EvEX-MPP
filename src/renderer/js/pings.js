// Vista de pings de flota: convierte los broadcasts (p. ej. de un bot como pingbot) en tarjetas.
import { h, icon, esc } from "./dom.js";
import { formatBody, fmtDateTime, fmtEve, fmtTimes, timeAgo } from "./format.js";
import { S } from "./state.js";
import { matchRule, highlightRules, ruleLabel } from "./keywords.js";
import { parseFormup, countdownText, countdownSettings, watchCountdowns } from "./formup.js";

import { t } from "./i18n.js";
import { srpEnabled, isMarked, flagButton, deadlineChip, srpPanel, statusChip } from "./srp.js";
import { INVISIBLE, trimSpaces, withoutInvisible, removeCleanRange, spaceAfterLeadingInvisible } from "./invisible.js";
// «Clave: valor». El valor va tal cual, con sus caracteres invisibles (marcas de agua): solo se quitan los espacios de
// después de los dos puntos.
const FIELD_RE = /^([A-Za-z][\w ./()'&-]{1,32}?)\s*:[ \t]*(.+)$/;
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
  const fields = [];
  // Texto libre en orden; "" marca una línea en blanco (separa párrafos).
  const free = [];
  let fieldsAt = -1; // posición en `free` donde empiezan los campos
  let footer = null;
  // El texto (título, campos y demás) va TAL CUAL, con sus caracteres invisibles; para reconocer el pie y los campos
  // se mira una copia sin ellos. Solo se quitan espacios normales (trim() quitaría también U+FEFF).
  for (const raw of body.split("\n")) {
    let line = trimSpaces(raw);
    if (!line) {
      if (free.length && free[free.length - 1] !== "") free.push("");
      continue;
    }
    // El pie "~~~ This was a … broadcast ~~~" puede venir en su propia línea o al final de otra.
    const inline = line.match(FOOTER_RE);
    const clean = withoutInvisible(line);
    const f = inline || clean.match(FOOTER_RE);
    if (f) {
      footer = { from: f[1], to: f[2], at: f[3] };
      // Si el pie solo se reconoce sin los invisibles, se quita del original el trozo que ocupa: lo demás de la línea
      // sigue con sus invisibles.
      line = trimSpaces(inline ? line.replace(inline[0], "") : removeCleanRange(line, f.index, f[0].length));
      if (!line) continue;
    }
    const m = line.match(FIELD_RE);
    // «Tomorrow at 17:15 we form…» no es un campo: los dos puntos son de una hora (dígito a cada lado).
    const isTime = m && /\d$/.test(m[1]) && /^\d/.test(withoutInvisible(m[2]).trimStart());
    if (m && !isTime && !/^https?$/i.test(m[1].trim())) {
      if (fieldsAt < 0) fieldsAt = free.length;
      fields.push({ key: m[1].trim(), value: trimSpaces(m[2]) });
    } else free.push(line);
  }
  // Con campos, lo de antes es el título y lo de después va debajo. Sin campos, el título es solo la primera
  // línea y el resto, con sus párrafos, va debajo (antes se juntaba todo en un título en negrita).
  const cut = fieldsAt >= 0 ? fieldsAt : Math.min(1, free.length);
  const title = free.slice(0, cut).filter(Boolean);
  const extra = free.slice(cut);
  while (extra[0] === "") extra.shift();
  while (extra.length && extra[extra.length - 1] === "") extra.pop();
  return { title: title.join(" ") || t("Ping"), fields, extra, footer };
}

const FIELD_ICONS = { "fc name": "crown", fc: "crown", "formup location": "map-pin", formup: "map-pin", location: "map-pin", "pap type": "flag", comms: "radio", doctrine: "swords", ships: "rocket", target: "crosshair", time: "clock" };

// Sistema para el enlace a Dotlan: solo en campos de LUGAR («Formup Location», «Location», «System», «Staging»,
// «Formup» a secas…), nunca en uno de hora («Formup Time», «When»…) ni si el valor es una hora o una fecha.
const PLACE_KEY = /location|system|staging|rally|^form\s*-?up(?:\s*(?:point|spot))?$/i;
const TIME_LIKE_KEY = /time|when|date|\bat\b/i;
const TIME_LIKE_VALUE = /\b\d{1,2}:\d{2}\b|\b\d{4}[-./]\d{1,2}[-./]\d{1,2}\b|\b(?:in|en)\s+\d+\s*(?:m|min|mins|minutes?|h|hrs?|hours?)\b/i;
export function dotlanSystem(key, value) {
  const k = String(key || "").replace(INVISIBLE, "").trim();
  if (!PLACE_KEY.test(k) || TIME_LIKE_KEY.test(k)) return "";
  const v = String(value || "").replace(INVISIBLE, "").trim();
  if (TIME_LIKE_VALUE.test(v)) return "";
  const sys = v.split(/[\s,(]/)[0];
  return /^[A-Za-z0-9-]{3,12}$/.test(sys) && /[A-Za-z]/.test(sys) ? sys : "";
}

function fieldValue(key, raw, rules) {
  const sys = dotlanSystem(key, raw);
  const value = spaceAfterLeadingInvisible(raw); // solo al pintar: el valor guardado no cambia
  if (sys) {
    return h("span", { html: formatBody(value, { rules }).html + ` <a class="link dotlan" href="https://evemaps.dotlan.net/system/${encodeURIComponent(sys)}" title="${esc(t("Ver {system} en Dotlan", { system: sys }))}">🗺 Dotlan</a>` });
  }
  return h("span", { html: formatBody(value, { rules }).html });
}

// ---------- pings recientes: la sirena late ----------

const SEEN_KEY = "evex.pingsSeenAt";
// Momento en que se salió por última vez de la vista de pings (para el modo «hasta volver a abrirlos»).
// Si aún no hay ninguno (perfil nuevo), cuenta desde ahora: si no, al elegir ese modo latirían todos los pings guardados.
let seenFallback = 0; // por si localStorage no funciona
export function pingsSeenAt() {
  let v;
  try {
    v = Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return (seenFallback ||= Date.now());
  }
  if (v) return v;
  markPingsSeen();
  return seenFallback;
}
// La vista de pings no se vuelve a pintar al salir y entrar: se apagan ya las sirenas de los que pasan a estar vistos.
export function markPingsSeen(ts = Date.now()) {
  seenFallback = ts;
  try {
    localStorage.setItem(SEEN_KEY, String(ts));
  } catch {}
  if (typeof document !== "undefined" && document.querySelector?.(FRESH_SEL)) sweepFresh();
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

// El ping más reciente de una lista (los recuperados pueden llegar desordenados). 0 si no hay ninguno.
export function newestPingTs(messages) {
  let max = 0;
  for (const m of messages) if (m.ts > max) max = m.ts;
  return max;
}

// ¿Late la sirena de «Pings de flota» en la barra lateral? Sí mientras lata la del ping más reciente.
// Deja puesto el temporizador que la apaga a su hora.
export function sidebarSirenTs(messages) {
  const ts = newestPingTs(messages);
  if (!ts || !isFreshPing(ts)) return 0;
  watchFresh(ts);
  return ts;
}

// Apaga a su hora las sirenas visibles: tarjetas y barra lateral (antes seguían latiendo hasta que se repintaban).
// Un solo temporizador, puesto para la sirena que antes se apaga; no hay ninguno si no late nada.
const FRESH_SEL = ".ping-card.fresh, .sb-item.pings.fresh";
let sweepTimer = null;
let sweepAt = Infinity;
function sweepFresh() {
  sweepTimer = null;
  sweepAt = Infinity;
  for (const card of document.querySelectorAll(FRESH_SEL)) {
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
  sweepTimer.unref?.(); // en los tests (Node), que el temporizador no impida terminar
}

// Otras partes de la app pueden poner botones en el pie de cada tarjeta, antes de «Copiar» (p. ej. el del calendario
// de flotas), sin que este fichero dependa de ellas: build(ping) → elemento o null.
const cardActions = [];
export function addPingCardAction(build) {
  cardActions.push(build);
}
function cardActionEls(m) {
  const out = [];
  for (const build of cardActions) {
    try {
      const el = build(m);
      if (el) out.push(el);
    } catch (e) {
      console.error(e);
    }
  }
  return out;
}

// opts.srp: vista «Solo marcados» (muestra el panel de SRP de cada ping).
export function pingCard(m, opts = {}) {
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
    { class: `ping-card ${fresh ? "fresh" : ""} ${rule ? "kw" : ""} ${srpEnabled() && isMarked(m.key) ? "srp-marked" : ""}`, dataset: { key: m.key, ts: String(m.ts) }, style: rule ? { "--kw": rule.color } : null },
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
      srpEnabled() ? statusChip(m) : null,
      srpEnabled() ? deadlineChip(m) : null,
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
      ...cardActionEls(m),
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
  if (srpEnabled()) {
    card.querySelector(".ping-foot").append(flagButton(m, card, { srpOnly: opts.srp }));
    if (opts.srp) card.append(srpPanel(m) || "");
  }
  return card;
}

export function pingMatches(m, query, group, srpOnly) {
  if (srpOnly && !(srpEnabled() && isMarked(m.key))) return false;
  if (group) {
    const p = parsePing(m.body);
    if ((p.footer?.to || "") !== group) return false;
  }
  if (!query) return true;
  return m.body.replace(INVISIBLE, "").toLowerCase().includes(query.toLowerCase());
}

// Pings que se pintan con un filtro de la vista. Con el SRP apagado, el filtro «Marcados» deja de valer y se quita
// aquí, antes de filtrar: si no, al apagar el SRP con «Marcados» puesto la lista se pintaba vacía.
export function visiblePings(messages, filter, limit = 400) {
  if (!srpEnabled()) filter.srpOnly = false;
  return messages.filter((m) => pingMatches(m, filter.query, filter.group, filter.srpOnly)).slice(-limit).reverse();
}

export function pingGroups(messages) {
  const set = new Set();
  for (const m of messages) {
    const to = parsePing(m.body).footer?.to;
    if (to) set.add(to);
  }
  return [...set].sort();
}
