// Persistencia de configuración (JSON en userData) y contraseñas cifradas con safeStorage (DPAPI en Windows).
import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { t } from "./i18n.js";
const dir = () => app.getPath("userData");
const configFile = () => path.join(dir(), "config.json");
const secretsFile = () => path.join(dir(), "secrets.json");

export const DEFAULT_SETTINGS = {
  theme: "eve-dark",
  colors: {},
  fontFamily: "Inter Variable",
  monoFamily: "JetBrains Mono Variable",
  fontSize: 14,
  uiScale: 1,
  density: "cozy",
  messageStyle: "modern",
  bubbleRadius: 14,
  showAvatars: true,
  nickColors: true,
  timeFormat: "24",
  showSeconds: false,
  language: "auto",
  showLocalTime: true,
  showEveTime: true,
  showEveClock: true,
  background: { type: "none", value: "", opacity: 0.35, blur: 0, dim: 0.4 },
  sidebarBackground: { type: "none", value: "", opacity: 0.25, blur: 8 },
  conversationBackgrounds: {},
  emojiStyle: "noto-animated",
  downloadEmoji: false, // descargar de Google los animados que no vienen con la app
  emojiSize: 1.25,
  jumboEmoji: true,
  emoticonToEmoji: true,
  customEmoji: [],
  // GIFs: colección propia y buscador opcional (cada usuario pone su propia clave).
  gifs: { saved: [], provider: "none", keys: { giphy: "", klipy: "" }, rating: "pg-13" },
  notifications: {
    enabled: true,
    privateMessages: true,
    mentions: true,
    allRoomMessages: false,
    pings: true,
    keywords: [],
    showPreview: true,
    flashTaskbar: true,
    sound: true,
    // Sonido por tipo de aviso: preset sintetizado o un archivo propio ("custom" + file), con su volumen (0–1).
    sounds: {
      private: { preset: "chime", file: "", volume: 1 },
      mention: { preset: "ding", file: "", volume: 1 },
      room: { preset: "pop", file: "", volume: 1 },
      sent: { preset: "none", file: "", volume: 1 },
      ping: { preset: "alarm", file: "", volume: 1 },
      disconnected: { preset: "down", file: "", volume: 1 },
      reconnected: { preset: "up", file: "", volume: 1 },
      contactOnline: { preset: "none", file: "", volume: 1 },
      contactOffline: { preset: "none", file: "", volume: 1 },
      subscribe: { preset: "bubble", file: "", volume: 1 },
      invite: { preset: "ding", file: "", volume: 1 },
    },
    volume: 0.6,
    outputDevice: "", // "" = salida predeterminada de Windows
    pingRepeat: { enabled: false, interval: 30, times: 5 }, // repetir el sonido del ping hasta mirar la ventana
    popupStyle: "custom",
    popupCorner: "bottom-left",
    popupDuration: 8,
    pingSticky: true,
    trayBlink: true,
    dnd: false,
    roomModes: {},
  },
  pingSenders: [],
  // Cuánto late la sirena de los pings recientes: minutos ("0" = nunca) o "unseen" (hasta volver a abrir los pings).
  pingHighlight: "60",
  behavior: {
    enterToSend: true,
    sendTyping: true,
    showJoinLeave: false,
    mucHistory: 50,
    linkPreviews: true,
    spellcheck: true,
    checkUpdates: false, // consultar en GitHub si hay versión nueva (solo avisa)
    spellLanguages: ["es-ES", "en-US"],
    closeToTray: true,
    minimizeToTray: false,
    startMinimized: false,
    startWithWindows: false,
    restoreOpenTabs: true,
    showOffline: false,
    groupMessagesMinutes: 5,
    autoAwayMinutes: 10,
  },
  layout: { sidebarWidth: 290, occupantsWidth: 230, showOccupants: true, compactSidebar: false },
  openTabs: [],
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function deepMerge(base, extra) {
  if (Array.isArray(base) || typeof base !== "object" || base === null) return extra === undefined ? base : extra;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = typeof v === "object" && v !== null && !Array.isArray(v) && typeof base[k] === "object" && !Array.isArray(base[k])
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

let config = null;

export function load() {
  const raw = readJson(configFile(), {});
  config = {
    accounts: raw.accounts || [],
    settings: deepMerge(DEFAULT_SETTINGS, raw.settings || {}),
    imported: raw.imported || {},
  };
  return config;
}

export function get() {
  return config || load();
}

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

export function flush() {
  clearTimeout(saveTimer);
  if (config) writeJsonAtomic(configFile(), config);
}

export function setSettings(settings) {
  get().settings = deepMerge(DEFAULT_SETTINGS, settings);
  save();
  return config.settings;
}

export function newId() {
  return crypto.randomUUID();
}

export function normalizeAccount(a) {
  const jid = String(a.jid || "").trim().toLowerCase();
  return {
    id: a.id || newId(),
    jid,
    resource: a.resource || "EvEX-MPP",
    alias: a.alias || jid.split("@")[0],
    host: a.host || "",
    port: Number(a.port) || 5222,
    security: a.security || "starttls",
    autoLogin: a.autoLogin !== false,
    savePassword: a.savePassword !== false,
    priority: Number.isFinite(Number(a.priority)) ? Number(a.priority) : 1,
    nick: a.nick || jid.split("@")[0],
    conferenceServer: a.conferenceServer || (jid.includes("@") ? `conference.${jid.split("@")[1]}` : ""),
    syncBookmarks: a.syncBookmarks !== false,
    color: a.color || "",
    rooms: (a.rooms || []).map(normalizeRoom),
    // Salas quitadas a mano: no se vuelven a añadir aunque sigan en los marcadores del servidor.
    dismissedRooms: [...new Set((a.dismissedRooms || []).map((j) => String(j).toLowerCase()))],
  };
}

export function normalizeRoom(r) {
  return {
    jid: String(r.jid).toLowerCase(),
    name: r.name || String(r.jid).split("@")[0],
    nick: r.nick || "",
    password: r.password || "",
    autojoin: !!r.autojoin,
    favorite: r.favorite !== false,
    notify: r.notify || "default",
    group: r.group || "",
  };
}

export function upsertAccount(a) {
  const acc = normalizeAccount(a);
  const list = get().accounts;
  const i = list.findIndex((x) => x.id === acc.id);
  if (i >= 0) list[i] = acc;
  else list.push(acc);
  save();
  return acc;
}

export function removeAccount(id) {
  config.accounts = get().accounts.filter((a) => a.id !== id);
  setPassword(id, null).catch(() => {});
  save();
}

export function getAccount(id) {
  return get().accounts.find((a) => a.id === id);
}

// ---- contraseñas ----

export async function setPassword(accountId, password) {
  let enc = null;
  if (password) {
    try {
      enc = (await safeStorage.encryptStringAsync(password)).toString("base64");
    } catch {
      throw new Error(t("El cifrado del sistema no está disponible; no se puede guardar la contraseña de forma segura."));
    }
  }
  const secrets = readJson(secretsFile(), {});
  if (enc) secrets[accountId] = { enc };
  else delete secrets[accountId];
  writeJsonAtomic(secretsFile(), secrets);
}

export async function getPassword(accountId) {
  const s = readJson(secretsFile(), {})[accountId];
  if (!s?.enc) return null;
  try {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(s.enc, "base64"));
    if (shouldReEncrypt) await setPassword(accountId, result);
    return result;
  } catch {
    return null;
  }
}

export function hasPassword(accountId) {
  return !!readJson(secretsFile(), {})[accountId]?.enc;
}
