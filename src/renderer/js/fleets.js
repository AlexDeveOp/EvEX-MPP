// Calendario de flotas: las flotas anunciadas en los pings (se calculan del historial, no se guardan), las añadidas a
// mano y las sugeridas desde mensajes de sala. Todo es local: se guarda en S.settings.fleets (config.json), como las
// marcas de SRP, y nada sale de la app. Del enlace al calendario de la alianza solo se guarda la dirección: nunca se
// abre ni se pide desde aquí (hace falta la sesión del foro).
//
// Fleet = { id, at (ms UTC), title, group, source: "ping"|"manual"|"message", pingKeys: [], msgKey, link, note,
//           status: "active"|"pending"|"dismissed", announcedAt (cuándo se anunció o se añadió) }
// - De ping: id "p-<clave del ping más antiguo de la op>"; varios pings de la misma op (±15 min y mismo enlace o título
//   parecido) son una sola flota. Los cambios del usuario se guardan aparte (overrides) sin tocar el ping.
// - Manual o de mensaje: id "m-<aleatorio>"; las de mensaje empiezan «pending» (sugeridas: se aceptan o se descartan).
import { S, saveSettings, on } from "./state.js";
import { pingsConv } from "./convs.js";
import { parsePing } from "./pings.js";
import { parseFormup, INVISIBLE, TIME_KEY } from "./fleet-time.js";
import { trimSpaces } from "./invisible.js";
import { t } from "./i18n.js";

export const SAME_OP_MS = 15 * 60e3;
export const KEEP_MS = 90 * 86400e3; // lo guardado de hace más de 90 días se borra (config.json se guarda entero)
const SOURCES = ["ping", "manual", "message"];
const STATUSES = ["active", "pending", "dismissed"];

// ---------- guardado ----------

function store() {
  const f = S.settings.fleets || {};
  S.settings.fleets = { items: f.items || {}, overrides: f.overrides || {}, dismissed: f.dismissed || {} };
  return S.settings.fleets;
}

// Cuánto se guardan: Preferencias → Privacidad (settings.retention.fleetsDays; 90 de serie, 0 = nunca se borran).
export function fleetsKeepMs(days = S.settings?.retention?.fleetsDays) {
  if (days === 0) return Infinity;
  return [30, 90, 180, 365].includes(days) ? days * 86400e3 : KEEP_MS;
}

// Lo que caducaría con ese plazo: [[«items»|«overrides»|«dismissed», clave], …].
function oldFleetEntries(st, now, keepMs) {
  if (keepMs === Infinity) return [];
  const cut = now - keepMs;
  return [
    ...Object.entries(st.items).filter(([, f]) => !(f.at >= cut)).map(([id]) => ["items", id]),
    ...Object.entries(st.overrides).filter(([, o]) => !(o._at >= cut)).map(([id]) => ["overrides", id]),
    ...Object.entries(st.dismissed).filter(([, ts]) => !(ts >= cut)).map(([k]) => ["dismissed", k]),
  ];
}

// Para confirmar antes de acortar el plazo: cuántas cosas guardadas se borrarían.
export const countOldFleets = (days, now = Date.now()) => oldFleetEntries(store(), now, fleetsKeepMs(days)).length;

let pruned = false;
// Borra lo viejo una vez por sesión (al primer uso) y al cambiar el plazo: flotas guardadas, retoques y descartadas.
export function pruneFleets(now = Date.now()) {
  const st = store();
  const old = oldFleetEntries(st, now, fleetsKeepMs());
  for (const [bucket, k] of old) delete st[bucket][k];
  if (old.length) saveSettings();
  return old.length > 0;
}
function ready() {
  if (!pruned && S.settings) {
    pruned = true;
    pruneFleets();
  }
  return store();
}

// ---------- avisos de cambios ----------

const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function changed() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  }
}
// Pings nuevos o historial cargado: cambian las flotas de ping.
let watching = false;
function watchPings() {
  if (watching) return;
  watching = true;
  let timer = null;
  const later = (ev) => {
    if (ev?.conv && ev.conv.type !== "pings") return;
    clearTimeout(timer);
    timer = setTimeout(changed, 100);
  };
  on("message", later);
  on("history", later);
}

// ---------- flotas de los pings ----------

const norm = (s) => String(s || "").replace(INVISIBLE, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// Palabras que salen en casi todos los pings y no distinguen una op de otra.
const COMMON = new Set(["fleet", "fleets", "form", "formup", "forming", "now", "the", "and", "for", "with", "ping", "all", "op", "ops", "up", "undock", "reminder", "last", "call", "please", "everyone", "join"]);
const words = (s) => new Set(norm(s).split(" ").filter((w) => w.length >= 3 && !COMMON.has(w)));

// ¿Mismo título? Igual, uno contiene al otro o comparten al menos la mitad de las palabras.
export function similarTitle(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return false;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.min(wa.size, wb.size) > 0.5;
}

// Enlace a un calendario o evento (de la alianza) dentro del ping. Solo se guarda: nunca se abre ni se pide.
const URL_RE = /https?:\/\/[^\s<>"'()]+/gi;
const CAL_RE = /\/(?:calendar|calendars|events?)(?:\/|$)|[?&](?:event|calendar)(?:_?id)?=/i;
export function calendarLink(body) {
  for (const u of String(body || "").replace(INVISIBLE, "").match(URL_RE) || []) if (CAL_RE.test(u)) return u.replace(/[.,;:!?]+$/, "");
  return "";
}
// Título sacado del final de la dirección («…/event/123-final-timer-in-c-j» → «final timer in c j»).
export function titleFromLink(link) {
  let path;
  try {
    path = new URL(link).pathname;
  } catch {
    return "";
  }
  const parts = path.split("/").filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  for (const p of parts.reverse()) {
    const t = p.replace(/\.\w+$/, "").replace(/^\d+[-_]?/, "").replace(/[-_+]+/g, " ").trim();
    if (/\p{L}{3}/u.test(t) && !/^(?:calendar|calendars|events?|index|view)$/i.test(t)) return t;
  }
  return "";
}

// Datos de flota de un ping, o null si no trae hora de formup. El título va tal cual (con sus invisibles).
export function fleetFromPing(m) {
  if (!m?.body) return null;
  const p = parsePing(m.body);
  const at = parseFormup(p, m.ts);
  if (!at) return null;
  const link = calendarLink(m.body);
  return { at, title: String(p.title || "").trim() || titleFromLink(link), group: p.footer?.to || "", link };
}

// Agrupa los pings con hora en operaciones. El id usa siempre el ping MÁS ANTIGUO de la op, para que no cambie al
// llegar recordatorios (y no se pierdan los retoques guardados con ese id).
// Lo que se lee de cada ping se guarda por mensaje: al llegar un ping nuevo solo se analiza ese.
const parsed = new WeakMap();
function candidateOf(m) {
  if (!parsed.has(m)) parsed.set(m, fleetFromPing(m));
  return parsed.get(m);
}

export function fleetsFromPings(messages) {
  const ops = [];
  const withTime = messages.filter((m) => candidateOf(m)).sort((a, b) => a.ts - b.ts);
  for (const m of withTime) {
    const f = candidateOf(m);
    if (!f) continue;
    // Misma op: hora parecida y mismo enlace, o título parecido y sin grupos distintos (un ping a «caps» y otro a «all»
    // a la misma hora pueden ser flotas diferentes).
    const sameGroup = (o) => !f.group || !o.group || f.group.toLowerCase() === o.group.toLowerCase();
    const op = ops.find((o) => Math.abs(o.at - f.at) <= SAME_OP_MS && ((f.link && f.link === o.link) || (sameGroup(o) && similarTitle(f.title, o.title))));
    if (op) {
      op.pingKeys.push(m.key);
      op.at = f.at; // el recordatorio más reciente trae la hora más al día
      op.link ||= f.link;
      op.group ||= f.group;
      continue;
    }
    ops.push({ id: `p-${m.key}`, at: f.at, title: f.title, group: f.group, source: "ping", pingKeys: [m.key], msgKey: "", link: f.link, note: "", status: "active", announcedAt: m.ts });
  }
  return ops;
}

let cache = { key: "", list: [] };
function pingFleets() {
  const msgs = pingsConv().messages;
  const key = `${msgs.length}|${msgs.at(-1)?.key || ""}|${msgs[0]?.key || ""}`;
  if (cache.key !== key) cache = { key, list: fleetsFromPings(msgs) };
  return cache.list;
}

// FC, sitio del formup y doctrina, de los campos del ping más antiguo de la op (para el .ics). Vacío en las manuales y
// en las de mensaje. Los valores van tal cual (con sus invisibles).
const DETAIL_KEYS = { fc: /^(?:fc\b|fleet commander)/i, formup: /formup|location|staging/i, doctrine: /doctrine|ships|comp/i };
export function fleetDetails(fleet) {
  const out = { fc: "", formup: "", doctrine: "" };
  const key = fleet?.source === "ping" ? fleet.pingKeys?.[0] : null;
  const m = key && pingsConv().messages.find((x) => x.key === key);
  if (!m) return out;
  // Las líneas «Clave: valor» del ping tal cual (parsePing limpia los valores; aquí no se toca nada).
  for (const line of String(m.body).split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).replace(INVISIBLE, "").trim();
    if (!k || TIME_KEY.test(k)) continue;
    for (const [name, re] of Object.entries(DETAIL_KEYS)) if (!out[name] && re.test(k)) out[name] = trimSpaces(line.slice(i + 1));
  }
  return out;
}

// ---------- consulta ----------

const OVERRIDABLE = ["at", "title", "group", "note", "link", "status"];

export function allFleets({ includeDismissed = false } = {}) {
  watchPings();
  const st = ready();
  const out = [];
  for (const f of pingFleets()) {
    const o = st.overrides[f.id];
    out.push(o ? { ...f, ...Object.fromEntries(OVERRIDABLE.filter((k) => k in o).map((k) => [k, o[k]])) } : { ...f, pingKeys: [...f.pingKeys] });
  }
  for (const f of Object.values(st.items)) out.push({ ...f, pingKeys: [...(f.pingKeys || [])] });
  return out.filter((f) => includeDismissed || f.status !== "dismissed").sort((a, b) => a.at - b.at);
}

export function getFleet(id) {
  return allFleets({ includeDismissed: true }).find((f) => f.id === id) || null;
}

// Las que aún no han pasado (hasta 15 min después de su hora siguen como «¡Formup ahora!»).
export function upcoming({ now = Date.now(), limit = Infinity, withinMs = Infinity, includePending = true } = {}) {
  return allFleets()
    .filter((f) => f.at >= now - SAME_OP_MS && f.at - now <= withinMs && (includePending || f.status !== "pending"))
    .slice(0, limit);
}

export function fleetsBetween(start, end) {
  return allFleets().filter((f) => f.at >= start && f.at < end);
}

// ---------- cambios ----------

function clean(f) {
  const at = Number(f.at);
  // La vista de flotas lo enseña en un aviso (toast): va traducido.
  if (!Number.isFinite(at)) throw new Error(t("Hora de la flota no válida"));
  return {
    at,
    title: String(f.title ?? "").slice(0, 200),
    group: String(f.group ?? "").slice(0, 80),
    note: String(f.note ?? "").slice(0, 1000),
    link: String(f.link ?? "").slice(0, 500),
  };
}

// De qué sala y de quién viene una flota sacada de un mensaje: { accountId, room (JID de la sala), nick }. El nombre
// visible de la sala no se guarda: se saca al pintar (puede cambiar si se renombra el marcador). null si no hay sala.
function cleanOrigin(o) {
  if (!o || typeof o !== "object") return null;
  const room = String(o.room ?? "").slice(0, 300);
  if (!room) return null;
  return { accountId: String(o.accountId ?? "").slice(0, 100), room, nick: String(o.nick ?? "").slice(0, 100) };
}

export function addFleet({ at, title = "", group = "", note = "", link = "", source = "manual", pingKeys = [], msgKey = "", status, origin = null } = {}) {
  const st = ready();
  if (!SOURCES.includes(source)) source = "manual";
  const f = {
    id: `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    ...clean({ at, title, group, note, link }),
    source,
    pingKeys: [...pingKeys].map(String),
    msgKey: String(msgKey || ""),
    status: STATUSES.includes(status) ? status : source === "message" ? "pending" : "active",
    announcedAt: Date.now(),
  };
  const from = cleanOrigin(origin);
  if (from) f.origin = from;
  st.items[f.id] = f;
  saveSettings();
  changed();
  return { ...f };
}

export function updateFleet(id, patch = {}) {
  const st = ready();
  const cur = getFleet(id);
  if (!cur) return null;
  const next = { ...cur, ...Object.fromEntries(OVERRIDABLE.filter((k) => k in patch).map((k) => [k, patch[k]])) };
  const fixed = { ...clean(next), status: STATUSES.includes(next.status) ? next.status : cur.status };
  if (st.items[id]) st.items[id] = { ...st.items[id], ...fixed };
  else {
    // Flota de ping: solo se guarda lo que cambia, con su hora para poder borrarlo cuando pase (_at).
    const o = { ...(st.overrides[id] || {}) };
    for (const k of OVERRIDABLE) if (k in patch) o[k] = fixed[k];
    o._at = fixed.at;
    st.overrides[id] = o;
  }
  saveSettings();
  changed();
  return getFleet(id);
}

export function removeFleet(id) {
  const st = ready();
  if (st.items[id]) {
    delete st.items[id];
    saveSettings();
    changed();
    return true;
  }
  return !!updateFleet(id, { status: "dismissed" });
}

export const acceptFleet = (id) => updateFleet(id, { status: "active" });

// Descartar: la flota queda oculta y, si salió de un mensaje, ese mensaje no vuelve a sugerirla.
export function dismissFleet(id) {
  const f = getFleet(id);
  if (!f) return null;
  if (f.msgKey) dismissSuggestion(f.msgKey);
  return updateFleet(id, { status: "dismissed" });
}

export function dismissSuggestion(msgKey) {
  if (!msgKey) return;
  ready().dismissed[String(msgKey)] = Date.now();
  saveSettings();
}
export const isDismissed = (msgKey) => !!msgKey && !!ready().dismissed[String(msgKey)];

// Para pruebas: olvida la caché y el estado de la sesión.
export function _resetFleetsForTests() {
  cache = { key: "", list: [] };
  pruned = false;
}
