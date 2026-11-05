// Cuenta atrás del formup: lee la hora del formup de un ping (hora EVE = UTC), la muestra en la tarjeta
// y avisa unos minutos antes y a la hora, según Preferencias → Pings de flota → Cuenta atrás del formup.
import { S, api } from "./state.js";
import { dndState } from "./notify-rules.js";
import { parsePing } from "./pings.js";
import { pingsConv, loadHistory } from "./convs.js";
import { playRuleSound } from "./sounds.js";
import { speak, speechAvailable, voiceSettings } from "./tts.js";
import { themeColors } from "./themes.js";
import { fmtTime, fmtEve, fmtEveDateTime } from "./format.js";
import { countdownText as baseCountdown } from "./countdown.js";
import { INVISIBLE, TIME_KEY, parseFormup, parseFleetTime } from "./fleet-time.js";
import { allFleets, fleetsFromPings } from "./fleets.js";

export { parseFormup, parseFleetTime };

import { t } from "./i18n.js";

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

// Un aviso se identifica por la hora del formup y el título, no por la clave del ping: dos copias del mismo broadcast
// (otra conexión, el archivo del servidor…) avisan una sola vez. Es el mismo id que antes del calendario.
function alertBase(at, title) {
  return `${at}|${String(title || "").replace(INVISIBLE, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80)}`;
}

// Avisos de las flotas del calendario (fleets.js): las de los pings, las añadidas a mano y las sugeridas ya aceptadas.
// Un aviso solo salta en su momento (con 90 s de margen): si la app estaba cerrada, no llega tarde; y no avisa de un
// momento anterior a cuando se anunció la flota (un ping que llega 20 min antes no da el aviso de «30 min antes»).
const LATE_MS = 90e3;
export function fleetAlerts(fleets, cfg, now = Date.now(), done = {}) {
  const out = [];
  if (!cfg.enabled || !cfg.alert) return out;
  const groups = wantedGroups(cfg.groups);
  const seen = new Set();
  for (const f of fleets) {
    if (f.status !== "active" || !Number.isFinite(f.at) || now - f.at > 86400e3) continue;
    if (groups.length && !groups.includes(String(f.group || "").toLowerCase())) continue;
    const base = alertBase(f.at, f.title);
    const marks = (cfg.befores || []).map((n) => [`${base}|${n}`, f.at - n * 60e3, n]);
    if (cfg.atTime) marks.push([`${base}|0`, f.at, 0]);
    for (const [id, when, minutes] of marks) {
      if (done[id] || seen.has(id) || now < when || now - when > LATE_MS || when < (f.announcedAt || 0)) continue;
      seen.add(id);
      out.push({ id, fleet: f, at: f.at, minutes });
    }
  }
  return out;
}

// Los mismos avisos a partir de los pings (las ops juntadas como en el calendario); `m` es el primer ping de la op.
export function dueAlerts(messages, cfg, now = Date.now(), done = {}) {
  const byKey = new Map(messages.map((m) => [m.key, m]));
  return fleetAlerts(fleetsFromPings(messages), cfg, now, done).map((a) => ({ ...a, m: byKey.get(a.fleet.pingKeys[0]) }));
}

// Texto que se lee: en inglés, como la plantilla de la lectura de pings (la voz automática es inglesa).
export function reminderSpeech(minutes, title) {
  const what = minutes ? `Formup in ${minutes} minute${minutes === 1 ? "" : "s"}` : "Formup now";
  return title ? `${what}. ${title}` : what;
}

// Contenido del aviso: el título y la nota de la flota (con los cambios que haya hecho el usuario) y, si viene de un
// ping, los campos del ping más reciente de la op.
export function alertContent(fleet) {
  const keys = fleet.pingKeys || [];
  const msgs = pingsConv().messages;
  let fields = [];
  for (let i = keys.length - 1; i >= 0; i--) {
    const m = msgs.find((x) => x.key === keys[i]);
    if (m) {
      fields = parsePing(m.body).fields || [];
      break;
    }
  }
  if (fleet.note) fields = [{ key: t("Nota"), value: fleet.note }, ...fields];
  return { title: fleet.title || "", fields };
}

function notifyFormup({ fleet, at, minutes }, cfg) {
  const p = alertContent(fleet);
  const clean = (s) => String(s || "").replace(INVISIBLE, "").trim();
  playRuleSound({ id: "formup", sound: cfg.sound, dnd: true }, "ping");
  if (cfg.speak && speechAvailable()) {
    const voice = voiceSettings();
    if (voice.dnd || !dndState(S.settings.notifications).active) setTimeout(() => speak(reminderSpeech(minutes, clean(p.title)), { ...voice, repeat: 1 }), 1500);
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
    reminder: true,
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
  for (const a of fleetAlerts(allFleets(), cfg, Date.now(), fired())) {
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
