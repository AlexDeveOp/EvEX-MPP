// Cuenta atrás del formup: lee la hora del formup de un ping (hora EVE = UTC), la muestra en la tarjeta
// y avisa unos minutos antes y a la hora, según Preferencias → Pings de flota → Cuenta atrás del formup.
import { S, api } from "./state.js";
import { parsePing } from "./pings.js";
import { pingsConv, loadHistory } from "./convs.js";
import { playRuleSound } from "./sounds.js";
import { themeColors } from "./themes.js";
import { fmtTime, fmtEve, fmtEveDateTime } from "./format.js";

import { t } from "./i18n.js";
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

export const COUNTDOWN_DEFAULTS = { enabled: true, alert: true, before: 5, atTime: true, sticky: true, sound: { preset: "radar", file: "", volume: 1 } };
export function countdownSettings(s = S.settings) {
  const c = s?.pingCountdown || {};
  return { ...COUNTDOWN_DEFAULTS, ...c, sound: { ...COUNTDOWN_DEFAULTS.sound, ...(c.sound || {}) } };
}

// Campos que dan la hora: «Formup Time», «Time», «When», «Start Time», «Undock», «Formup» (si lleva hora)…
const TIME_KEY = /^(?:(?:form\s*-?up|fleet|start|undock|op)\s*)?(?:time|at|when)$|^form\s*-?up$|^undock$/i;
const DATE_RE = /\b(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b/;
const HHMM = String.raw`\b([01]?\d|2[0-3]):([0-5]\d)\b|\b([01]\d|2[0-3])([0-5]\d)(?=\s*(?:eve|utc|et)\b)`;
const RELATIVE_RE = /\b(?:in|en|dentro de)\s+(\d{1,3})\s*(m|mins?|minutes?|minutos?|h|hrs?|hours?|horas?)\b/i;
// En texto libre la hora necesita contexto: «formup at 19:00», «undock 1930 EVE», «fleet @ 19:00», «19:00 EVE».
const CONTEXT_RE = new RegExp(String.raw`(?:\b(?:form\s*-?up|undock|fleet|start|at)\b|@)[^\n\d]{0,24}(?:${HHMM})|(?:${HHMM})\s*(?:eve|utc|et)\b`, "i");

function relative(text, ts) {
  const m = text.match(RELATIVE_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return ts + n * (/^h/i.test(m[2]) ? 3600e3 : 60e3);
}

// Hora absoluta en el texto. Sin fecha, se toma el día del ping; si queda más de 6 h antes del ping,
// es del día siguiente (un ping a las 23:30 para un formup a las 00:15).
function absolute(text, ts, re) {
  const m = text.match(re);
  if (!m) return null;
  const g = m.slice(1).filter((x) => x !== undefined);
  const [hh, mm] = g.slice(-2).map(Number);
  const d = text.match(DATE_RE);
  const base = new Date(ts);
  const at = d ? Date.UTC(+d[1], +d[2] - 1, +d[3], hh, mm) : Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hh, mm);
  return !d && at < ts - 6 * 3600e3 ? at + 86400e3 : at;
}

// p = resultado de parsePing (el pie «This was a broadcast … at …» es la hora de envío, no la del formup).
export function parseFormup(p, ts) {
  if (!p || !ts) return null;
  const clean = (s) => String(s || "").replace(INVISIBLE, "");
  for (const f of p.fields || []) {
    if (!TIME_KEY.test(f.key.trim())) continue;
    const v = clean(f.value);
    const at = relative(v, ts) ?? absolute(v, ts, new RegExp(HHMM, "i"));
    if (at) return at;
  }
  // Clave y valor se unen sin espacio: parsePing parte «fight 21:00 EVE» como si fuera un campo «fight 21: 00 EVE».
  const text = clean([p.title, ...(p.fields || []).map((f) => `${f.key}:${f.value}`), ...(p.extra || [])].join("\n"));
  return relative(text, ts) ?? absolute(text, ts, CONTEXT_RE);
}

// Texto del chip: «Formup en 12:34», «Formup en 1:05:00», «¡Formup ahora!», «Formup hace 12 min».
export function countdownText(at, now = Date.now()) {
  const diff = at - now;
  const pad = (n) => String(n).padStart(2, "0");
  if (diff > 0) {
    const s = Math.ceil(diff / 1000);
    const h = Math.floor(s / 3600);
    const clock = h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    return { state: h >= 24 ? "later" : "soon", text: h >= 24 ? t("Formup el {date} EVE", { date: fmtEveDateTime(at) }) : t("Formup en {time}", { time: clock }) };
  }
  if (diff > -15 * 60e3) return { state: "now", text: t("¡Formup ahora!") };
  if (diff > -2 * 3600e3) return { state: "past", text: t("Formup hace {n} min", { n: Math.floor(-diff / 60e3) }) };
  return { state: "old", text: t("Formup a las {time} EVE", { time: fmtEve(at) }) };
}

// Las tarjetas visibles se actualizan cada segundo mientras queda alguna cuenta atrás que no sea vieja.
let ticker = null;
function tick() {
  const chips = document.querySelectorAll(".formup-chip[data-at]");
  let live = false;
  for (const chip of chips) {
    const c = countdownText(Number(chip.dataset.at));
    if (chip.dataset.state !== c.state) chip.dataset.state = c.state;
    const label = chip.querySelector(".formup-text");
    if (label && label.textContent !== c.text) label.textContent = c.text;
    if (c.state !== "old") live = true;
  }
  if (!live) {
    clearInterval(ticker);
    ticker = null;
  }
}
export function watchCountdowns() {
  ticker ??= setInterval(tick, 1000);
}

// ---------- avisos ----------

const FIRED_KEY = "evex.formupFired";
function fired() {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) || "{}");
  } catch {
    return {};
  }
}
function markFired(id) {
  const all = fired();
  const now = Date.now();
  for (const [k, v] of Object.entries(all)) if (now - v > 2 * 86400e3) delete all[k];
  all[id] = now;
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(all));
  } catch {}
}

const cache = new Map(); // clave del ping → hora del formup (o null)
function formupOf(m) {
  if (!cache.has(m.key)) cache.set(m.key, parseFormup(parsePing(m.body), m.ts));
  return cache.get(m.key);
}

// Un aviso solo salta en su momento (con 90 s de margen): si la app estaba cerrada, no llega tarde.
const LATE_MS = 90e3;
export function dueAlerts(messages, cfg, now = Date.now(), done = {}) {
  const out = [];
  if (!cfg.enabled || !cfg.alert) return out;
  for (const m of messages) {
    if (now - m.ts > 86400e3) continue;
    const at = formupOf(m);
    if (!at) continue;
    const marks = [];
    if (cfg.before > 0) marks.push([`${m.key}|${cfg.before}`, at - cfg.before * 60e3, cfg.before]);
    if (cfg.atTime) marks.push([`${m.key}|0`, at, 0]);
    for (const [id, when, minutes] of marks) {
      if (done[id] || now < when || now - when > LATE_MS || when < m.ts) continue;
      out.push({ id, m, at, minutes });
    }
  }
  return out;
}

function notifyFormup({ m, at, minutes }, cfg) {
  const p = parsePing(m.body);
  const clean = (s) => s.replace(INVISIBLE, "").trim();
  playRuleSound({ id: "formup", sound: cfg.sound, dnd: true }, "ping");
  const c = themeColors();
  api("notify", {
    kind: "ping",
    title: minutes ? t("Formup en {n} min", { n: minutes }) : t("¡Hora del formup!"),
    text: clean(p.title).slice(0, 120),
    fields: p.fields
      .filter((f) => !TIME_KEY.test(f.key.trim()))
      .slice(0, 6)
      .map((f) => ({ key: f.key, value: clean(f.value).slice(0, 140) })),
    footer: t("Formup a las {time} EVE", { time: fmtEve(at) }),
    sticky: cfg.sticky,
    accountId: null,
    conv: "*",
    convType: "pings",
    time: { local: S.settings.showLocalTime !== false ? fmtTime(at) : null, eve: fmtEve(at) },
    colors: { surface: c.surface, text: c.text, border: c.border, warn: c.warn, "theme-accent": c.accent },
  }).catch(() => {});
}

let watchTimer = null;
function sweep() {
  const cfg = countdownSettings();
  if (!cfg.enabled || !cfg.alert || !S.settings.notifications.enabled) return;
  for (const a of dueAlerts(pingsConv().messages, cfg, Date.now(), fired())) {
    markFired(a.id);
    notifyFormup(a, cfg);
  }
}

// Se llama al arrancar: carga los pings guardados (para avisar de un formup anunciado antes de abrir la app)
// y revisa cada 15 s.
export function startFormupWatch() {
  if (watchTimer) return;
  const pc = pingsConv();
  if (!pc.loaded) loadHistory(pc).catch(() => {});
  watchTimer = setInterval(sweep, 15000);
}
