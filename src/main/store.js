// Persistencia de configuración (JSON en userData) y contraseñas cifradas con safeStorage (DPAPI en Windows, el llavero
// del escritorio en Linux).
import { app, safeStorage } from "electron";
import { linuxStorageKind, hasSecureStorage } from "./platform.js";
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
  bgLibrary: [], // imágenes importadas para los fondos («Tus imágenes»)
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
    // La entrada «Menciones» de la barra lateral solo sale con menciones sin ver, salvo que se pida verla siempre.
    alwaysShowMentions: false,
    keywords: [],
    // Reglas por palabra clave: palabras, dónde se aplican y su aviso, sonido y color (ver renderer/js/keywords.js).
    keywordRules: [],
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
    // Pantalla de las burbujas: "primary", "cursor", "window" o "display:<id>" (ver popup-display.js).
    popupDisplay: "primary",
    popupDisplayHint: null,
    popupDuration: 8,
    pingSticky: true,
    // Cuánto se queda la burbuja de un ping: "sticky", "message" o segundos (popup-duration.js). null = según
    // pingSticky (el interruptor de antes), para no cambiar lo que ya tenga guardado.
    pingDuration: null,
    trayBlink: true,
    dnd: false,
    // «No molestar» por horario (renderer/js/notify-rules.js): de–a (puede cruzar la medianoche) y días (0 = domingo).
    // dndSkipUntil: se apagó a mano durante el horario; no vuelve hasta ese momento (fin del tramo).
    dndSchedule: { enabled: false, from: "01:00", to: "08:00", days: [1, 2, 3, 4, 5, 6, 0] },
    dndAllowMentions: false,
    dndSkipUntil: 0,
    // Nivel de aviso por sala o chat (clave de la conversación): "all", "mentions" o "none".
    roomModes: {},
  },
  pingSenders: [],
  // Cuánto late la sirena de los pings recientes: minutos ("0" = nunca) o "unseen" (hasta volver a abrir los pings).
  pingHighlight: "60",
  // SRP: marcar pings para pedir el reembolso de naves (renderer/js/srp.js). Las marcas, por clave del mensaje.
  srp: { enabled: false, deadlineDays: 0, marks: {} },
  // Caducidad del historial local (main/retention.js), en días; 0 = nunca. Los pings, aparte para no perderlos sin querer.
  retention: { messagesDays: 0, pingsDays: 0, fleetsDays: 90 },
  // Calendario de flotas (src/renderer/js/fleets.js): las añadidas a mano o desde salas, los retoques de las de los
  // pings y los mensajes descartados como sugerencia. Solo local; lo de más de 90 días se borra.
  fleets: { items: {}, overrides: {}, dismissed: {} },
  // Exportar flotas a .ics (renderer/js/ics.js): por defecto lo mínimo (opsec); alarm en minutos, 0 = sin aviso.
  fleetIcs: { details: false, includeLink: false, alarm: 0 },
  // Mini ventana para jugar (src/main/mini-window.js). La posición se guarda aparte, por monitor.
  mini: { enabled: false, opacity: 0.85, clickThrough: false },
  // Modo captura (src/main/capture.js): avisos sin detalles y ventana difuminada. globalShortcut: Ctrl+Shift+H global.
  capture: { enabled: false, globalShortcut: false },
  behavior: {
    enterToSend: true,
    sendTyping: true,
    showJoinLeave: false,
    mucHistory: 50,
    // Vistas previas de imágenes y YouTube: "click" (se cargan al pulsar), "auto" (al mostrar el mensaje; la web que aloja
    // la imagen ve tu IP) u "off". Antes era linkPreviews: true/false (ver migrateLinkPreviews).
    linkPreviewMode: "click",
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
    discoverMucServices: false, // el explorador de salas busca también otros servidores de salas del dominio (muc., chat.…)
  },
  // Proxy general: lo usan las cuentas en modo «global» y todo el tráfico web de la app. La contraseña va en secrets.json.
  proxy: { enabled: false, type: "socks5", host: "", port: 1080, username: "" },
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

// Avisos de una sola vez pendientes de enseñar (la ventana los quita al mostrarlos).
DEFAULT_SETTINGS.notices = {};

// 0.11: las vistas previas pasan a «al hacer clic» por defecto (opsec: una imagen pegada en una sala no debe poder
// saber tu IP sin que la pulses). config.json se guarda entero, así que linkPreviews: true no dice si se eligió a mano:
// quien las tenía apagadas sigue sin ellas («off»); a los demás se les ponen «al hacer clic» y se les avisa una vez.
export function migrateLinkPreviews(raw = {}) {
  const b = raw.behavior;
  if (!b || "linkPreviewMode" in b || !("linkPreviews" in b)) return raw;
  const { linkPreviews, ...behavior } = b;
  const off = linkPreviews === false;
  return {
    ...raw,
    behavior: { ...behavior, linkPreviewMode: off ? "off" : "click" },
    notices: { ...(raw.notices || {}), ...(off ? {} : { linkPreviewClick: true }) },
  };
}

let config = null;

export function load() {
  const raw = readJson(configFile(), {});
  config = {
    accounts: raw.accounts || [],
    settings: deepMerge(DEFAULT_SETTINGS, migrateLinkPreviews(raw.settings || {})),
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
  config.settings.proxy = { enabled: !!config.settings.proxy.enabled, ...normalizeProxySettings(config.settings.proxy) };
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
    proxy: normalizeAccountProxy(a.proxy),
    rooms: (a.rooms || []).map(normalizeRoom),
    // Salas quitadas a mano: no se vuelven a añadir aunque sigan en los marcadores del servidor.
    dismissedRooms: [...new Set((a.dismissedRooms || []).map((j) => String(j).toLowerCase()))],
    // Rechazos seguidos del servidor al entrar (SASL): desde el segundo se avisa de una posible revocación (main.js).
    authFailures: Math.max(0, Math.floor(Number(a.authFailures) || 0)),
  };
}

const PROXY_TYPES = ["socks5", "http", "https"];
const PROXY_PORTS = { socks5: 1080, http: 8080, https: 443 };

// Datos del proxy sin contraseña: tipo válido, host sin espacios y puerto por defecto según el tipo.
export function normalizeProxySettings(p = {}) {
  const type = PROXY_TYPES.includes(p.type) ? p.type : "socks5";
  const port = Number(p.port);
  return { type, host: String(p.host || "").trim(), port: Number.isInteger(port) && port > 0 && port < 65536 ? port : PROXY_PORTS[type], username: String(p.username || "") };
}

// Proxy de una cuenta: «global» (el de Preferencias), «none» (directo) o «custom» (el suyo).
export function normalizeAccountProxy(p = {}) {
  const mode = ["global", "none", "custom"].includes(p?.mode) ? p.mode : "global";
  return { mode, ...normalizeProxySettings(p || {}) };
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
  setPassword(proxySecretKey(id), null).catch(() => {});
  save();
}

export function getAccount(id) {
  return get().accounts.find((a) => a.id === id);
}

// ---- contraseñas ----

// Dónde cifra el sistema: "os" en Windows y macOS; en Linux, "keyring" o "basic_text" (sin llavero), según el prefijo
// de un texto cifrado de prueba (ver linuxStorageKind). Se comprueba una vez, con la app ya lista.
// La prueba puede abrir la ventana del escritorio para desbloquear el llavero: un fallo o una cancelación no se recuerda,
// para volver a intentarlo la próxima vez.
let storageProbe = null;
export function secretStorage() {
  if (process.platform !== "linux") return Promise.resolve("os");
  storageProbe ||= safeStorage.encryptStringAsync("evex").then(
    (buf) => linuxStorageKind(buf.subarray(0, 3).toString()),
    () => {
      storageProbe = null;
      return "basic_text";
    },
  );
  return storageProbe;
}

// Para los tests: la próxima consulta vuelve a comprobar el llavero.
export function resetSecretStorageProbe() {
  storageProbe = null;
}

// Para la interfaz al arrancar: no espera a que el usuario conteste a la ventana del llavero. Si no hay respuesta
// enseguida devuelve "unknown"; la comprobación sigue y se usa al guardar una contraseña.
export function secretStorageSoon(ms = 1500) {
  return Promise.race([secretStorage(), new Promise((r) => setTimeout(() => r("unknown"), ms))]);
}

export class NoKeyringError extends Error {
  constructor() {
    super(t("No hay un llavero del sistema para cifrar la contraseña; no se guardará."));
    this.code = "NO_KEYRING";
  }
}

// Las contraseñas de proxy se guardan junto a las de las cuentas, con su propia clave.
export const GLOBAL_PROXY = "global";
export function proxySecretKey(accountId) {
  return `proxy:${accountId}`;
}

export async function setPassword(accountId, password) {
  let enc = null;
  if (password) {
    // Sin llavero (Linux sin GNOME Keyring ni KWallet), Chromium solo ofusca la contraseña con una clave fija: no se guarda.
    if (!hasSecureStorage(await secretStorage())) throw new NoKeyringError();
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
