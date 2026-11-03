import { t } from "./i18n.js";
// Estado de la interfaz y acceso al proceso principal.
export const api = (channel, ...args) => window.evex.call(channel, ...args);
export const onMain = (event, fn) => window.evex.on(event, fn);

const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, data) {
  for (const fn of listeners.get(evt) || []) {
    try {
      fn(data);
    } catch (e) {
      console.error(evt, e);
    }
  }
}

export const S = {
  accounts: [],
  settings: null,
  conn: {}, // accountId -> { state, show, statusText, jid, error, avatarHash }
  roster: {}, // accountId -> Map(jid -> contacto)
  rooms: {}, // accountId -> Map(roomJid -> { joined, joining, nick, subject, occupants: Map, role, affiliation, error })
  convs: new Map(), // clave -> conversación
  tabs: [],
  active: null,
  avatars: new Map(), // hash -> url
  avatarOf: new Map(), // jid (o sala/nick) -> hash
  focused: true,
  version: "",
  // Sistema y capacidades que informa el proceso principal (init.system); ver system.js.
  system: { platform: "win32", secretStorage: "os", trayAvailable: true },
};

export const convKey = (accountId, conv) => `${accountId}|${conv}`;
export const PINGS_KEY = "pings|*";

export const account = (id) => S.accounts.find((a) => a.id === id);
export const conn = (id) => S.conn[id] || (S.conn[id] = { state: "offline" });
export const rosterOf = (id) => S.roster[id] || (S.roster[id] = new Map());
export const roomsOf = (id) => S.rooms[id] || (S.rooms[id] = new Map());

export function roomState(accountId, jid) {
  const rooms = roomsOf(accountId);
  if (!rooms.has(jid)) rooms.set(jid, { joined: false, joining: false, nick: "", subject: "", occupants: new Map(), typing: new Map() });
  return rooms.get(jid);
}

export function contact(accountId, jid) {
  const r = rosterOf(accountId);
  if (!r.has(jid)) r.set(jid, { jid, name: "", groups: [], subscription: "none", resources: new Map(), inRoster: false });
  return r.get(jid);
}

const SHOW_RANK = { chat: 0, "": 1, away: 2, xa: 3, dnd: 4, offline: 9 };
export function bestPresence(c) {
  let best = null;
  for (const r of c?.resources?.values() || []) {
    if (!best || r.priority > best.priority || (r.priority === best.priority && SHOW_RANK[r.show] < SHOW_RANK[best.show])) best = r;
  }
  return best ? { show: best.show || "online", status: best.status } : { show: "offline", status: "" };
}

export function displayName(accountId, jid) {
  const c = rosterOf(accountId).get(jid);
  if (c?.name) return c.name;
  const acc = account(accountId);
  const room = acc?.rooms.find((r) => r.jid === jid);
  if (room?.name) return room.name;
  if (jid.includes("/")) return jid.split("/")[1];
  return jid.split("@")[0];
}

export function avatarUrl(jidOrHash) {
  const hash = S.avatarOf.get(jidOrHash) || jidOrHash;
  return S.avatars.get(hash) || null;
}

let saveTimer = null;
export function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api("settings:set", S.settings).catch(console.error), 300);
}

export function updateSettings(fn) {
  fn(S.settings);
  saveSettings();
  emit("settings", S.settings);
}

export async function saveRooms(accountId) {
  const acc = account(accountId);
  const updated = await api("rooms:update", accountId, acc.rooms);
  Object.assign(acc, updated);
  emit("accounts");
}

export function nickColor(nick) {
  let h = 0;
  for (const ch of String(nick).toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `hsl(${h % 360} var(--nick-s) var(--nick-l))`;
}

export function initials(name) {
  const parts = String(name || "?").replace(/[_.-]+/g, " ").trim().split(/\s+/);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

export const SHOW_LABEL = { online: t("Disponible"), "": t("Disponible"), chat: t("Hablador"), away: t("Ausente"), xa: t("Ausente (ext.)"), dnd: t("No molestar"), offline: t("Desconectado") };
