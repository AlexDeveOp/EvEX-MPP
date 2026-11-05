// Cuenta atrás del formup: lee la hora del formup de un ping (hora EVE = UTC), la muestra en la tarjeta
// y avisa unos minutos antes y a la hora, según Preferencias → Pings de flota → Cuenta atrás del formup.
import { S, api } from "./state.js";
import { parsePing } from "./pings.js";
import { pingsConv, loadHistory } from "./convs.js";
import { playRuleSound } from "./sounds.js";
import { speak, speechAvailable, voiceSettings } from "./tts.js";
import { themeColors } from "./themes.js";
import { fmtTime, fmtEve, fmtEveDateTime } from "./format.js";
import { countdownText as baseCountdown } from "./countdown.js";

import { t } from "./i18n.js";
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

// befores: minutos antes del formup en los que se avisa (varios a la vez). groups: solo estos grupos de destino del pie
// del ping, separados por comas (vacío = todos). speak: leer el aviso en voz alta con la voz de la lectura de pings.
export const COUNTDOWN_DEFAULTS = { enabled: true, alert: true, befores: [5], atTime: true, sticky: true, groups: "", speak: false, sound: { preset: "radar", file: "", volume: 1 } };
export const BEFORE_CHOICES = [5, 10, 15, 30, 60];
export function countdownSettings(s = S.settings) {
  const c = s?.pingCountdown || {};
  // Hasta la 0.8.0 había un solo «before» (0 = solo a la hora).
  const raw = Array.isArray(c.befores) ? c.befores : c.before !== undefined ? [c.before] : COUNTDOWN_DEFAULTS.befores;
  const befores = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 24 * 60))].sort((a, b) => b - a);
  const { before: _old, ...rest } = c;
  return { ...COUNTDOWN_DEFAULTS, ...rest, befores, sound: { ...COUNTDOWN_DEFAULTS.sound, ...(c.sound || {}) } };
}

// Grupos de destino elegidos («all, caps»), en minúsculas. Vacío = todos.
export function wantedGroups(groups) {
  return String(groups || "")
    .split(/[,\n]/)
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean);
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

// Texto del chip (countdown.js), con la fecha y la hora EVE según los ajustes.
export function countdownText(at, now = Date.now()) {
  return baseCountdown(at, now, { eveDateTime: fmtEveDateTime, eve: fmtEve });
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
  if (cache.size > 2000) cache.clear();
  if (!cache.has(m.key)) cache.set(m.key, parseFormup(parsePing(m.body), m.ts));
  return cache.get(m.key);
}

// Próximo formup entre los pings de las últimas 24 h, para la mini ventana: el siguiente que aún no ha empezado; si no
// hay ninguno, el que empezó hace menos (hasta 15 min después cuenta como «¡Formup ahora!»). Un formup que ya empezó
// no tapa al que empieza dentro de 5 min. `until` dice cuándo cambia la elección (empieza el elegido o deja de valer).
export const FORMUP_NOW_MS = 15 * 60e3;
export function nextFormup(messages, now = Date.now()) {
  let future = null;
  let started = null;
  for (const m of messages) {
    if (now - m.ts > 86400e3) continue;
    const at = formupOf(m);
    if (!at || at < now - FORMUP_NOW_MS) continue;
    if (at > now) {
      if (!future || at < future.at) future = { at, m };
    } else if (!started || at > started.at) started = { at, m };
  }
  const best = future || started;
  return best && { ...best, until: best.at > now ? best.at : best.at + FORMUP_NOW_MS };
}

// Un aviso se identifica por la hora del formup y el título del ping, no por la clave del ping: dos copias del mismo
// broadcast (otra conexión, el archivo del servidor…) avisan una sola vez.
function alertBase(m, at, p) {
  const title = String(p.title || "").replace(INVISIBLE, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);
  return `${at}|${title}`;
}

// Un aviso solo salta en su momento (con 90 s de margen): si la app estaba cerrada, no llega tarde.
const LATE_MS = 90e3;
export function dueAlerts(messages, cfg, now = Date.now(), done = {}) {
  const out = [];
  if (!cfg.enabled || !cfg.alert) return out;
  const groups = wantedGroups(cfg.groups);
  const seen = new Set();
  for (const m of messages) {
    if (now - m.ts > 86400e3) continue;
    const at = formupOf(m);
    if (!at) continue;
    const p = parsePing(m.body);
    if (groups.length && !groups.includes(String(p.footer?.to || "").toLowerCase())) continue;
    const base = alertBase(m, at, p);
    const marks = (cfg.befores || []).map((n) => [`${base}|${n}`, at - n * 60e3, n]);
    if (cfg.atTime) marks.push([`${base}|0`, at, 0]);
    for (const [id, when, minutes] of marks) {
      if (done[id] || seen.has(id) || now < when || now - when > LATE_MS || when < m.ts) continue;
      seen.add(id);
      out.push({ id, m, at, minutes });
    }
  }
  return out;
}

// Texto que se lee: en inglés, como la plantilla de la lectura de pings (la voz automática es inglesa).
export function reminderSpeech(minutes, title) {
  const what = minutes ? `Formup in ${minutes} minute${minutes === 1 ? "" : "s"}` : "Formup now";
  return title ? `${what}. ${title}` : what;
}

function notifyFormup({ m, at, minutes }, cfg) {
  const p = parsePing(m.body);
  const clean = (s) => s.replace(INVISIBLE, "").trim();
  playRuleSound({ id: "formup", sound: cfg.sound, dnd: true }, "ping");
  if (cfg.speak && speechAvailable()) {
    const voice = voiceSettings();
    if (voice.dnd || !S.settings.notifications?.dnd) setTimeout(() => speak(reminderSpeech(minutes, clean(p.title)), { ...voice, repeat: 1 }), 1500);
  }
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
