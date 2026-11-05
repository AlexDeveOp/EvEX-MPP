// Datos de la mini ventana para jugar (src/main/mini-window.js): se calculan aquí, en la ventana principal, y se
// mandan al proceso principal solo si cambian. Por opsec, del ping solo van el título y el grupo, nunca el texto
// entero; el título va tal cual llega (con sus caracteres invisibles, sin tocarlos).
import { S, api, on, emit, onMain, updateSettings } from "./state.js";
import { pingsConv, totalUnread } from "./convs.js";
import { mentionsConv } from "./mentions.js";
import { parsePing } from "./pings.js";
import { countdownSettings } from "./formup.js";
import { upcoming, onChange as onFleetsChange } from "./fleets.js";
import { fmtEve } from "./format.js";
import { themeColors } from "./themes.js";
import { t, currentLang, locale } from "./i18n.js";

const TITLE_MAX = 120;

function latest(messages) {
  let last = null;
  for (const m of messages) if (!last || m.ts >= last.ts) last = m;
  return last;
}

// Las próximas flotas del calendario (sin las sugeridas por decidir): hora EVE con el día si no es hoy, título y grupo.
const MINI_FLEETS = 3;
const nextFleets = (now) => upcoming({ now, limit: MINI_FLEETS, includePending: false });
function whenLabel(at, now) {
  const day = (ts) => Math.floor(ts / 86400e3);
  const hm = fmtEve(at, false);
  if (day(at) === day(now)) return hm;
  if (day(at) === day(now) + 1) return `${t("mañ")} ${hm}`;
  return `${new Intl.DateTimeFormat(locale(), { weekday: "short", timeZone: "UTC" }).format(at)} ${hm}`;
}

export function miniState(now = Date.now()) {
  const pc = pingsConv();
  const last = latest(pc.messages);
  const p = last ? parsePing(last.body) : null;
  const c = themeColors();
  return {
    ping: last ? { title: String(p.title || "").slice(0, TITLE_MAX), group: p.footer?.to || "", ts: last.ts } : null,
    // Próximas flotas: solo hora, título (tal cual) y grupo. La cuenta atrás, solo si está activada en Preferencias.
    fleets: nextFleets(now).map((f) => ({ at: f.at, when: whenLabel(f.at, now), title: String(f.title || "").slice(0, 80), group: f.group || "", manual: f.source === "manual" })),
    countdown: countdownSettings().enabled,
    unread: Math.max(0, totalUnread() - pc.unread),
    pings: pc.unread,
    mentions: mentionsConv().pending || 0,
    clickThrough: !!S.settings.mini?.clickThrough,
    lang: currentLang(),
    // Colores del tema que usa mini.css (danger: la cuenta atrás en «¡Formup ahora!»).
    colors: { surface: c.surface, text: c.text, text2: c.text2, border: c.border, warn: c.warn, accent: c.accent, danger: c.danger },
  };
}

export const miniEnabled = () => !!S.settings?.mini?.enabled;

export function setMini(patch) {
  updateSettings((s) => (s.mini = { ...s.mini, ...patch }));
}
export const toggleMini = () => setMini({ enabled: !miniEnabled() });

let lastJson = "";
let timer = null;
let boundary = null;
function push() {
  timer = null;
  clearTimeout(boundary);
  boundary = null;
  if (!miniEnabled()) return void (lastJson = "");
  const now = Date.now();
  const state = miniState(now);
  // Se vuelve a calcular justo cuando la primera flota empieza y cuando deja de contar (15 min después).
  const first = state.fleets[0];
  if (first) boundary = setTimeout(() => schedule(0), Math.max(0, (first.at > now ? first.at : first.at + 15 * 60e3) - now) + 500);
  const json = JSON.stringify(state);
  if (json === lastJson) return;
  lastJson = json;
  api("mini:update", state).catch(() => {});
}
// Un solo temporizador: al cargar historial o el archivo del servidor llegan cientos de mensajes seguidos.
function schedule(ms = 150) {
  if (!timer && miniEnabled()) timer = setTimeout(push, ms);
}

// Se llama al arrancar. La casilla de la bandeja la abre o la cierra el proceso principal, que guarda el ajuste y
// avisa con «mini-changed» para que Preferencias y esta ventana lo vean.
// Los no leídos cambian con «sidebar»/«tabs» (mensajes nuevos, marcar como leído) y los pings con «message».
export function initMiniFeed() {
  onMain("mini-changed", (mini) => {
    S.settings.mini = { ...S.settings.mini, ...mini };
    emit("settings", S.settings);
  });
  for (const evt of ["message", "history", "sidebar", "tabs"]) on(evt, () => schedule());
  onFleetsChange(() => schedule());
  on("settings", () => {
    lastJson = "";
    clearTimeout(timer);
    timer = null;
    schedule(400);
  });
  // Por si cambia algo sin evento (p. ej. un ping antiguo que deja de contar): una revisión cada minuto.
  setInterval(() => schedule(0), 60e3);
  schedule(0);
}
