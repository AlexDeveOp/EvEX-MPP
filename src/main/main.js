// Proceso principal de EvEX-MPP: ventanas, bandeja, protocolos internos, IPC y conexiones XMPP.
import { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, Tray, Menu, nativeImage, Notification, powerMonitor, session, clipboard } from "electron";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as store from "./store.js";
import { XmppAccount } from "./xmpp-account.js";
import { Logs } from "./logs.js";
import { scanPidgin, importLogs, scanPidginSounds, repairImportedLogs } from "./pidgin-import.js";
import { renderIcon, renderAlertIcon } from "./icon.js";
import { showPopup, configurePopups, popupIpc, closeAllPopups } from "./popups.js";
import { checkForUpdates, repoFromUrl } from "./updates.js";
import { searchGifs, downloadGif, isProviderUrl } from "./gifs.js";

import { t, tk, setLanguage, currentLang } from "./i18n.js";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RENDERER = path.join(ROOT, "src", "renderer");
const NODE_MODULES = path.join(ROOT, "node_modules");
const ALLOWED_MODULES = ["@fontsource", "@fontsource-variable"];
const DEV = process.argv.includes("--dev");
const START_HIDDEN = process.argv.includes("--hidden");

app.setAppUserModelId("com.evex.mpp");
// Permite usar un perfil aislado (pruebas o varias instancias).
if (process.env.EVEX_USERDATA) app.setPath("userData", path.resolve(process.env.EVEX_USERDATA));
// Versión portable: los datos viajan junto al .exe (las contraseñas cifradas solo valen en el PC donde se guardaron).
else if (process.env.PORTABLE_EXECUTABLE_DIR) app.setPath("userData", path.join(process.env.PORTABLE_EXECUTABLE_DIR, "EvEX-MPP-datos"));
if (!app.requestSingleInstanceLock()) app.quit();

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  { scheme: "media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win = null;
let tray = null;
let quitting = false;
let logs = null;
let unread = 0;
// Los eventos XMPP que llegan mientras la interfaz carga se guardan y se entregan cuando avisa de que está lista.
let rendererReady = false;
const pendingEvents = [];
const accounts = new Map(); // id -> XmppAccount
const autoAway = new Map(); // id -> presencia previa

const userData = () => app.getPath("userData");
const mediaDir = (...p) => path.join(userData(), "media", ...p);
const avatarDir = () => mediaDir("avatars");

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------- aviso de versión nueva (opcional, desactivado por defecto) ----------
// Solo consulta la última release de GitHub y avisa; no descarga ni instala nada.
const UPDATE_EVERY = 24 * 3600e3;
const REPO = (() => {
  try {
    return repoFromUrl(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).repository?.url);
  } catch {
    return null;
  }
})();
let updateTimer = null;
let updatesEnabled = false;
let updateFound = null; // versión nueva pendiente de mostrar cuando la interfaz esté lista
const updateNotified = new Set();

function checkLatest() {
  if (!REPO) throw new Error(t("No se conoce el repositorio de la app."));
  return checkForUpdates({ currentVersion: app.getVersion(), repo: REPO, fetchImpl: (url, opts) => net.fetch(url, opts) });
}

// Comprobación automática: avisa una sola vez por versión.
async function runUpdateCheck() {
  const r = await checkLatest();
  if (r.newer && !updateNotified.has(r.latest)) {
    updateNotified.add(r.latest);
    if (rendererReady) send("update-available", r);
    else updateFound = r;
    if (tray && (!win || !win.isVisible())) tray.displayBalloon({ title: t("Hay una versión nueva de EvEX-MPP"), content: t("Versión {version}. Ábrela desde la ventana de la app.", { version: r.latest }), iconType: "info" });
  }
  return r;
}

function scheduleUpdateChecks(enabled) {
  if (enabled === updatesEnabled) return;
  updatesEnabled = enabled;
  clearInterval(updateTimer);
  updateTimer = null;
  if (!enabled) return;
  setTimeout(() => updatesEnabled && runUpdateCheck().catch(() => {}), 10000);
  updateTimer = setInterval(() => runUpdateCheck().catch(() => {}), UPDATE_EVERY);
}

function sendXmpp(ev) {
  if (rendererReady) return send("xmpp", ev);
  pendingEvents.push(ev);
  if (pendingEvents.length > 20000) pendingEvents.shift();
}

function safeJoin(base, rel) {
  const target = path.normalize(path.join(base, rel));
  return target.startsWith(base + path.sep) || target === base ? target : null;
}

// Los archivos de la interfaz no se guardan en la caché de Chromium: tras actualizar la app (o al recargar
// en desarrollo) siempre se usan los ficheros actuales, p. ej. las traducciones.
async function fetchNoCache(file) {
  const res = await net.fetch(pathToFileURL(file).toString());
  const headers = new Headers(res.headers);
  headers.set("cache-control", "no-store");
  return new Response(res.body, { status: res.status, headers });
}

function registerProtocols() {
  protocol.handle("app", (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname);
    let file;
    if (rel.startsWith("/node_modules/")) {
      const sub = rel.slice("/node_modules/".length);
      if (!ALLOWED_MODULES.some((m) => sub.startsWith(m + "/"))) return new Response("forbidden", { status: 403 });
      file = safeJoin(NODE_MODULES, sub);
    } else {
      file = safeJoin(RENDERER, rel === "/" ? "index.html" : rel.slice(1));
    }
    if (!file) return new Response("forbidden", { status: 403 });
    return fetchNoCache(file);
  });
  protocol.handle("media", (req) => {
    const url = new URL(req.url);
    const file = safeJoin(mediaDir(), decodeURIComponent(url.pathname).slice(1));
    if (!file || !fs.existsSync(file)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

// ---------- ventana ----------

function createWindow() {
  const s = store.get().settings;
  const bounds = s.layout.window || { width: 1280, height: 820 };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: "EvEX-MPP",
    icon: nativeImage.createFromBuffer(renderIcon(256)),
    backgroundColor: "#0d1117",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#00000000", symbolColor: "#c9d1d9", height: 40 },
    webPreferences: {
      preload: path.join(ROOT, "src", "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      // Sonidos y avisos deben funcionar con la ventana oculta en la bandeja.
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  if (s.layout.maximized) win.maximize();

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("app://")) {
      e.preventDefault();
      openExternal(url);
    }
  });
  win.webContents.on("context-menu", (_e, params) => nativeContextMenu(params));
  win.webContents.on("did-start-loading", () => (rendererReady = false));

  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    const st = store.get().settings;
    st.layout.maximized = win.isMaximized();
    if (!win.isMaximized() && !win.isMinimized()) st.layout.window = win.getBounds();
    store.save();
  };
  win.on("resize", saveBounds);
  win.on("move", saveBounds);
  // La interfaz solo da un mensaje por visto si la ventana está delante y con foco;
  // minimizada o en la bandeja, todo sigue avisando con burbuja y sonido.
  win.on("focus", () => send("window-focus", true));
  for (const evt of ["blur", "minimize", "hide"]) win.on(evt, () => send("window-focus", false));
  win.on("restore", () => send("window-focus", win.isFocused()));
  win.on("close", (e) => {
    if (!quitting && store.get().settings.behavior.closeToTray) {
      e.preventDefault();
      hideToTray();
    }
  });
  win.on("minimize", (e) => {
    if (store.get().settings.behavior.minimizeToTray) {
      e.preventDefault();
      hideToTray();
    }
  });

  // Diagnóstico: EVEX_DEBUG=1 vuelca la consola de la interfaz; EVEX_SHOT=ruta.png guarda una captura.
  if (process.env.EVEX_DEBUG) {
    win.webContents.on("console-message", (e) => console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`));
  }
  if (process.env.EVEX_SHOT) {
    win.webContents.once("did-finish-load", () =>
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.EVEX_SHOT, img.toPNG());
        console.log("captura guardada", process.env.EVEX_SHOT);
      }, Number(process.env.EVEX_SHOT_DELAY || 3500)),
    );
  }

  win.once("ready-to-show", () => {
    if (!(START_HIDDEN || s.behavior.startMinimized)) win.show();
    if (DEV) win.webContents.openDevTools({ mode: "detach" });
  });
  win.loadURL("app://evex/index.html");
}

function hideToTray() {
  win.hide();
  const cfg = store.get();
  // La primera vez se avisa de dónde ha ido la ventana.
  if (!cfg.imported.__trayHintShown && tray) {
    cfg.imported.__trayHintShown = 1;
    store.save();
    tray.displayBalloon({ title: t("EvEX-MPP sigue abierto"), content: t("Está en la bandeja del sistema. Haz clic en el icono para volver; para salir usa «Salir» en su menú."), iconType: "info" });
  }
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function openExternal(url) {
  try {
    const u = new URL(url);
    if (["http:", "https:", "mailto:", "xmpp:"].includes(u.protocol)) shell.openExternal(url);
  } catch {}
}

function nativeContextMenu(params) {
  const items = [];
  if (params.misspelledWord) {
    for (const s of params.dictionarySuggestions.slice(0, 6)) items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
    if (!params.dictionarySuggestions.length) items.push({ label: t("Sin sugerencias"), enabled: false });
    items.push({ label: t("Añadir al diccionario"), click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
    items.push({ type: "separator" });
  }
  if (params.linkURL) {
    items.push({ label: t("Abrir enlace"), click: () => openExternal(params.linkURL) });
    items.push({ label: t("Copiar enlace"), click: () => clipboard.writeText(params.linkURL) });
    items.push({ type: "separator" });
  }
  if (params.mediaType === "image" && params.srcURL) {
    items.push({ label: t("Copiar imagen"), click: () => win.webContents.copyImageAt(params.x, params.y) });
    if (/^https?:/.test(params.srcURL)) items.push({ label: t("Abrir imagen en el navegador"), click: () => openExternal(params.srcURL) });
    if (/^https?:/.test(params.srcURL) && !isProviderUrl(params.srcURL)) items.push({ label: t("Guardar en Mis GIFs"), click: () => send("gif-save", params.srcURL) });
    items.push({ type: "separator" });
  }
  if (params.isEditable) {
    items.push({ role: "undo", label: t("Deshacer") }, { role: "redo", label: t("Rehacer") }, { type: "separator" });
    items.push({ role: "cut", label: t("Cortar") }, { role: "copy", label: t("Copiar") }, { role: "paste", label: t("Pegar") }, { role: "selectAll", label: t("Seleccionar todo") });
  } else if (params.selectionText) {
    items.push({ role: "copy", label: t("Copiar") });
  }
  if (DEV) items.push({ type: "separator" }, { label: t("Inspeccionar"), click: () => win.webContents.inspectElement(params.x, params.y) });
  while (items.length && items[items.length - 1].type === "separator") items.pop();
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
}

// ---------- bandeja ----------

function trayImage() {
  return nativeImage.createFromBuffer(renderIcon(64, { badge: unread > 0 })).resize({ width: 16, height: 16, quality: "best" });
}

function buildTrayMenu() {
  const setAll = (show, label) => ({
    label,
    click: () => {
      for (const a of accounts.values()) if (a.online) a.setPresence(show).catch(() => {});
    },
  });
  return Menu.buildFromTemplate([
    { label: t("Mostrar EvEX-MPP"), click: showWindow },
    {
      label: t("Cambiar de cuenta…"),
      click: () => {
        showWindow();
        send("switch-account");
      },
    },
    { type: "separator" },
    setAll("", t("Disponible")),
    setAll("away", t("Ausente")),
    setAll("dnd", t("No molestar")),
    setAll("xa", t("Ausente (extendido)")),
    { type: "separator" },
    {
      label: t("Desconectar todo"),
      click: () => {
        for (const a of accounts.values()) a.disconnect().catch(() => {});
      },
    },
    {
      label: t("Salir"),
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip("EvEX-MPP");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => (win?.isVisible() && win.isFocused() ? win.hide() : showWindow()));
  tray.on("double-click", showWindow);
  tray.on("balloon-click", showWindow);
}

// Pings sin leer: la bandeja muestra un «!» ámbar (parpadeando si está activado) hasta que se abren los pings.
let pingAlert = 0;
let blinkTimer = null;
let blinkOn = false;
const alertImage = () => nativeImage.createFromBuffer(renderAlertIcon(64)).resize({ width: 16, height: 16, quality: "best" });

function refreshTray() {
  if (!tray) return;
  if (process.env.EVEX_DEBUG) console.log(`[bandeja] sin leer=${unread} pings=${pingAlert}`);
  clearInterval(blinkTimer);
  blinkTimer = null;
  if (pingAlert) {
    tray.setImage(alertImage());
    tray.setToolTip(t("¡{pingAlert} ping{x} de flota sin leer!", { pingAlert, x: pingAlert > 1 ? "s" : "" }));
    if (store.get().settings.notifications.trayBlink) {
      blinkOn = true;
      blinkTimer = setInterval(() => {
        blinkOn = !blinkOn;
        tray.setImage(blinkOn ? alertImage() : trayImage());
      }, 650);
    }
  } else {
    tray.setImage(trayImage());
    tray.setToolTip(unread ? t("EvEX-MPP — {unread} sin leer", { unread }) : "EvEX-MPP");
  }
  if (win && process.platform === "win32") {
    const overlay = pingAlert ? renderAlertIcon(32) : unread ? renderBadge() : null;
    win.setOverlayIcon(overlay ? nativeImage.createFromBuffer(overlay) : null, pingAlert ? t("Ping de flota") : unread ? t("{unread} sin leer", { unread }) : "");
  }
}

function setUnread(count, pings = 0) {
  const changed = count !== unread || pings !== pingAlert;
  unread = count;
  if (pings === 0 && pingAlert) closeAllPopups("ping");
  pingAlert = pings;
  if (changed) refreshTray();
}

function renderBadge() {
  return renderIcon(32, { badge: true, accent: "#ef4444", accent2: "#dc2626" });
}

// ---------- cuentas ----------

function publicAccount(a) {
  return { ...a, rooms: a.rooms.map(({ password, ...r }) => ({ ...r, hasPassword: !!password })), hasPassword: store.hasPassword(a.id) };
}

function accountSnapshot(id) {
  const x = accounts.get(id);
  if (!x) return { state: "offline" };
  return {
    state: x.state,
    show: x.presence.show,
    statusText: x.presence.status,
    jid: x.ownJid,
    roster: [...x.roster.values()],
    rooms: x.roomSnapshot(),
    presences: [...x.presences.values()].flatMap((m) => [...m.values()]),
    avatarHash: x.avatarHash,
  };
}

function listAvatars() {
  try {
    return Object.fromEntries(fs.readdirSync(avatarDir()).map((f) => [path.parse(f).name, f]));
  } catch {
    return {};
  }
}

function getConn(id) {
  let x = accounts.get(id);
  const acc = store.getAccount(id);
  if (!acc) throw new Error(t("Cuenta no encontrada"));
  if (!x) {
    x = new XmppAccount(acc, { avatarDir: avatarDir(), version: app.getVersion() });
    x.historyOptions = (roomJid) => historyOptions(id, roomJid);
    x.on("event", (ev) => onAccountEvent(x, ev));
    accounts.set(id, x);
  }
  x.acc = acc;
  return x;
}

function onAccountEvent(x, ev) {
  const accId = x.acc.id;
  if (ev.type === "message") {
    if (ev.replaces) {
      const saved = logs.append(accId, ev.conv, { ...ev, kind: "edit" });
      ev.key = saved?.key;
    } else {
      const saved = logs.append(accId, ev.conv, ev);
      if (!saved && ev.delayed) return;
      ev.key = saved?.key || Logs.key(ev);
    }
  }
  if (ev.type === "status" && ev.state === "online" && !x.autojoinDone) {
    x.autojoinDone = true;
    // Al conectar solo se entra en las salas marcadas con ⚡ (las demás pestañas no se restauran).
    for (const r of x.acc.rooms.filter((r) => r.autojoin)) joinRoom(x, r.jid).catch(() => {});
  }
  if (ev.type === "bookmarks") mergeBookmarks(x, ev.rooms);
  sendXmpp(ev);
}

// Solo pedimos a la sala el historial posterior al último mensaje guardado.
function historyOptions(accountId, roomJid) {
  const since = logs.lastTimestamp(accountId, roomJid);
  return { historySince: since ? since + 1000 : null, maxStanzas: store.get().settings.behavior.mucHistory };
}

function joinRoom(x, roomJid, nick, password) {
  const r = x.acc.rooms.find((y) => y.jid === roomJid);
  return x.joinRoom(roomJid, nick || r?.nick || x.acc.nick, password || r?.password, historyOptions(x.acc.id, roomJid));
}

function mergeBookmarks(x, rooms) {
  const acc = store.getAccount(x.acc.id);
  let changed = false;
  const dismissed = new Set(acc.dismissedRooms || []);
  for (const b of rooms) {
    if (acc.rooms.some((r) => r.jid === b.jid) || dismissed.has(b.jid)) continue;
    acc.rooms.push(store.normalizeRoom({ ...b, favorite: true }));
    changed = true;
    if (b.autojoin && x.online && !x.rooms.has(b.jid)) joinRoom(x, b.jid).catch(() => {});
  }
  if (changed) {
    store.save();
    send("accounts", store.get().accounts.map(publicAccount));
  }
}

async function connectAccount(id, password) {
  const x = getConn(id);
  const pw = password || (await store.getPassword(id));
  if (!pw) throw new Error("NEED_PASSWORD");
  x.autojoinDone = false;
  await x.connect(pw);
}

// ---------- ficheros de usuario ----------

// Los nombres se traducen al abrir el diálogo (el idioma puede cambiar en marcha).
const fileFilters = (kind) => (FILTERS[kind] || []).map((f) => ({ ...f, name: t(f.name) }));

const FILTERS = {
  image: [{ name: tk("Imágenes"), extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"] }],
  sound: [{ name: tk("Sonidos"), extensions: ["mp3", "wav", "ogg", "m4a", "flac"] }],
  video: [{ name: tk("Vídeo"), extensions: ["mp4", "webm"] }],
};

function copyToMedia(src, sub = "files") {
  const data = fs.readFileSync(src);
  const hash = crypto.createHash("sha1").update(data).digest("hex").slice(0, 20);
  const ext = path.extname(src).toLowerCase();
  const name = `${hash}${ext}`;
  fs.mkdirSync(mediaDir(sub), { recursive: true });
  const dest = mediaDir(sub, name);
  // "wx" falla si ya existe: el nombre es el hash del contenido, así que ya está copiado.
  try {
    fs.writeFileSync(dest, data, { flag: "wx" });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  return `media://evex/${sub}/${name}`;
}

function listSystemFonts() {
  const keys = ["HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts", "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"];
  const query = (k) =>
    new Promise((resolve) => execFile("reg", ["query", k], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err ? "" : out)));
  const STYLE = /\b(bold|italic|oblique|light|semilight|semibold|demibold|black|heavy|thin|extralight|extrabold|ultralight|ultrabold|medium|regular|condensed|narrow|semicondensed|extended|book|normal)\b/gi;
  return Promise.all(keys.map(query)).then((outs) => {
    const names = new Set();
    for (const line of outs.join("\n").split(/\r?\n/)) {
      const m = line.match(/^\s{4}(.+?)\s+REG_SZ\s+/);
      if (!m) continue;
      for (const part of m[1].replace(/\s*\((TrueType|OpenType|All res)\)\s*$/i, "").split(/\s*&\s*/)) {
        const fam = part.replace(STYLE, "").replace(/\s+/g, " ").trim();
        if (fam && !/^\d/.test(fam)) names.add(fam);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  });
}

// ---------- IPC ----------

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
}

function registerIpc() {
  handle("init", () => {
    const cfg = store.get();
    return {
      accounts: cfg.accounts.map(publicAccount),
      settings: cfg.settings,
      states: Object.fromEntries(cfg.accounts.map((a) => [a.id, accountSnapshot(a.id)])),
      avatars: listAvatars(),
      version: app.getVersion(),
      platform: process.platform,
      focused: !!win?.isFocused(),
    };
  });

  handle("ready", () => {
    rendererReady = true;
    for (const ev of pendingEvents.splice(0)) send("xmpp", ev);
    if (updateFound) send("update-available", updateFound);
    updateFound = null;
  });

  // Comprobación pedida a mano (botón «Comprobar ahora»): la interfaz muestra el resultado.
  handle("updates:check", () => checkLatest());

  handle("settings:set", (settings) => {
    const before = currentLang();
    const s = store.setSettings(settings);
    setLanguage(s.language);
    applySystemSettings(s);
    // El menú de la bandeja se construye con textos traducidos: rehacerlo si cambia el idioma.
    if (tray && currentLang() !== before) tray.setContextMenu(buildTrayMenu());
    return s;
  });

  handle("account:save", async ({ account, password }) => {
    const prev = account.id ? store.getAccount(account.id) : null;
    const merged = prev ? { ...prev, ...account, rooms: account.rooms ? account.rooms.map((r) => ({ ...r, password: r.password ?? prev.rooms.find((p) => p.jid === r.jid)?.password })) : prev.rooms } : account;
    const acc = store.upsertAccount(merged);
    if (password && acc.savePassword) await store.setPassword(acc.id, password);
    if (!acc.savePassword) await store.setPassword(acc.id, null);
    const x = accounts.get(acc.id);
    if (x) x.acc = acc;
    return publicAccount(acc);
  });

  handle("account:delete", async (id) => {
    await accounts.get(id)?.disconnect();
    accounts.delete(id);
    store.removeAccount(id);
    return true;
  });

  handle("account:connect", (id, password) => connectAccount(id, password));
  handle("account:disconnect", (id) => accounts.get(id)?.disconnect());
  handle("account:snapshot", (id) => accountSnapshot(id));

  handle("presence:set", (id, show, status) => getConn(id).setPresence(show, status));

  handle("msg:send", (id, msg) => getConn(id).sendMessage(msg));
  handle("chatstate:send", (id, to, state, isRoom) => getConn(id).sendChatState(to, state, isRoom));

  handle("room:join", (id, room, nick, password) => {
    const x = getConn(id);
    return joinRoom(x, room.toLowerCase(), nick, password);
  });
  handle("room:leave", (id, room) => getConn(id).leaveRoom(room));
  handle("room:list", (id, server) => getConn(id).listRooms(server));
  handle("room:info", (id, room) => getConn(id).roomInfo(room));
  handle("room:nick", (id, room, nick) => getConn(id).changeNick(room, nick));
  handle("room:subject", (id, room, subject) => getConn(id).setSubject(room, subject));
  handle("room:moderate", (id, room, opts) => getConn(id).moderate(room, opts));
  handle("room:invite", (id, room, jid, reason) => getConn(id).invite(room, jid, reason));
  handle("disco:items", (id, target) => getConn(id).discoItems(target));

  handle("rooms:update", (id, rooms) => {
    const acc = store.getAccount(id);
    const before = new Set(acc.rooms.map((r) => r.jid));
    acc.rooms = rooms.map((r) => store.normalizeRoom({ ...r, password: r.password ?? acc.rooms.find((p) => p.jid === r.jid)?.password }));
    const now = new Set(acc.rooms.map((r) => r.jid));
    const dismissed = new Set(acc.dismissedRooms || []);
    for (const j of before) if (!now.has(j)) dismissed.add(j);
    for (const j of now) dismissed.delete(j);
    acc.dismissedRooms = [...dismissed];
    store.save();
    // Mantener los marcadores del servidor iguales a la lista local, para que lo quitado no reaparezca al reconectar.
    const x = accounts.get(id);
    // Algunos servidores permiten leer los marcadores pero no guardarlos: se avisa una vez y no se reintenta.
    if (acc.syncBookmarks && x?.online && !x.bookmarksReadOnly) {
      x.saveBookmarks(acc.rooms.filter((r) => r.favorite || r.autojoin)).catch((e) => {
        x.bookmarksReadOnly = true;
        sendXmpp({ accountId: id, type: "bookmarks-readonly", message: e.message });
      });
    }
    return publicAccount(acc);
  });
  handle("rooms:pushBookmarks", (id) => {
    const acc = store.getAccount(id);
    return getConn(id).saveBookmarks(acc.rooms.filter((r) => r.favorite));
  });
  handle("rooms:fetchBookmarks", (id) => getConn(id).fetchBookmarks());

  handle("roster:add", (id, jid, name, groups) => getConn(id).addContact(jid, name, groups));
  handle("roster:remove", (id, jid) => getConn(id).removeContact(jid));
  handle("roster:update", (id, jid, name, groups) => getConn(id).rosterSet(jid, name, groups));
  handle("roster:answer", (id, jid, accept) => getConn(id).answerSubscription(jid, accept));

  handle("logs:tail", (id, conv, limit, beforeTs) => logs.tail(id, conv, limit, beforeTs));
  handle("logs:search", (id, opts) => logs.search(id, opts));
  handle("logs:list", (id) => logs.listConversations(id));

  // Sonidos de Pidgin: se buscan en el Pidgin instalado y se copian a la carpeta de la app (no se incluyen con EvEX-MPP).
  // GIFs: búsqueda con la clave del usuario y copias locales de «Mis GIFs» (solo para la miniatura).
  handle("gifs:search", ({ query, page }) => {
    const g = store.get().settings.gifs;
    return searchGifs({ provider: g.provider, key: g.keys?.[g.provider], query, page, rating: g.rating, lang: currentLang(), fetchImpl: (url, opts) => net.fetch(url, opts) });
  });
  handle("gifs:save", async (url) => {
    const { buffer, ext } = await downloadGif(url, { fetchImpl: (u, opts) => net.fetch(u, opts) });
    const name = `${crypto.createHash("sha1").update(buffer).digest("hex").slice(0, 20)}.${ext}`;
    fs.mkdirSync(mediaDir("gifs"), { recursive: true });
    fs.writeFileSync(mediaDir("gifs", name), buffer);
    return { url, thumb: `media://evex/gifs/${name}` };
  });
  handle("gifs:remove", (thumb) => {
    const m = String(thumb || "").match(/^media:\/\/evex\/gifs\/([0-9a-f]{20}\.[a-z]{3,4})$/);
    if (m) fs.rmSync(mediaDir("gifs", m[1]), { force: true });
    return true;
  });

  handle("sounds:pidginScan", () => {
    const r = scanPidginSounds();
    return { found: r.found, sounds: Object.fromEntries(Object.entries(r.sounds).map(([k, v]) => [k, { name: path.basename(v.file), custom: v.custom }])) };
  });
  handle("sounds:pidginImport", (kinds) => {
    const r = scanPidginSounds();
    const out = {};
    for (const k of kinds || []) if (r.sounds[k]) out[k] = copyToMedia(r.sounds[k].file, "sounds");
    return out;
  });

  // Repara el historial importado de Pidgin con versiones anteriores (fechas día/mes y avisos de Pidgin).
  // Antes copia la carpeta de historial entera, por si hubiera que volver atrás.
  handle("pidgin:repairLogs", async () => {
    const scan = scanPidgin();
    const targets = store.get().accounts.map((acc) => ({ acc, p: scan.accounts.find((p) => p.jid === acc.jid) })).filter((x) => x.p && fs.existsSync(x.p.logsDir));
    if (!targets.length) return { accounts: 0 };
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const backup = path.join(userData(), `logs-copia-${stamp}`);
    fs.cpSync(path.join(userData(), "logs"), backup, { recursive: true });
    const total = { accounts: targets.length, conversations: 0, fixed: 0, removed: 0, backup: path.basename(backup) };
    for (const { acc, p } of targets) {
      const r = await repairImportedLogs({ logsDir: p.logsDir, selfNames: [p.alias, p.jid.split("@")[0]].filter(Boolean).map((s) => s.toLowerCase()), logs, accountId: acc.id });
      total.conversations += r.conversations;
      total.fixed += r.fixed;
      total.removed += r.removed;
    }
    return total;
  });

  handle("pidgin:scan", () => {
    const r = scanPidgin();
    return { ...r, imported: Object.keys(store.get().imported).length };
  });
  handle("pidgin:import", async ({ jids, importPasswords, importRooms, importLogs: doLogs }) => {
    const scan = scanPidgin({ includePasswords: importPasswords });
    const results = [];
    for (const p of scan.accounts.filter((a) => jids.includes(a.jid))) {
      let acc = store.get().accounts.find((a) => a.jid === p.jid);
      const rooms = acc?.rooms ? [...acc.rooms] : [];
      if (importRooms) for (const r of p.rooms) if (!rooms.some((x) => x.jid === r.jid)) rooms.push(r);
      acc = store.upsertAccount({
        ...(acc || {}),
        jid: p.jid,
        alias: acc?.alias || p.alias,
        host: p.host,
        port: p.port,
        security: p.security,
        autoLogin: p.autoLogin,
        nick: acc?.nick || p.alias,
        rooms,
      });
      if (importPasswords && p.password) await store.setPassword(acc.id, p.password);
      let logResult = null;
      if (doLogs) {
        const cfg = store.get();
        logResult = await importLogs({
          logsDir: p.logsDir,
          selfNames: [p.alias, p.jid.split("@")[0]].map((s) => s.toLowerCase()),
          logs,
          accountId: acc.id,
          alreadyImported: cfg.imported,
          onProgress: (pr) => send("import-progress", pr),
        });
        for (const f of logResult.files) cfg.imported[f] = 1;
        store.save();
        logResult = { conversations: logResult.conversations, messages: logResult.messages };
      }
      results.push({ jid: p.jid, accountId: acc.id, rooms: p.rooms.length, logs: logResult, password: importPasswords && !!p.password });
    }
    store.flush();
    return { results, accounts: store.get().accounts.map(publicAccount) };
  });

  handle("file:pick", async (kind) => {
    const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: fileFilters(kind) });
    if (r.canceled || !r.filePaths[0]) return null;
    return copyToMedia(r.filePaths[0], kind === "sound" ? "sounds" : "files");
  });

  // Imágenes de fuera de la app para los fondos: arrastradas desde el Explorador, pegadas del portapapeles o desde una
  // dirección de Internet. Siempre se copian a la carpeta de la app (así el fondo sigue aunque se borre el original).
  const IMAGE_EXT = FILTERS.image[0].extensions;
  const MAX_IMAGE = 25 * 1024 * 1024;
  const saveImageBuffer = (buffer, ext) => {
    const name = `${crypto.createHash("sha1").update(buffer).digest("hex").slice(0, 20)}.${ext}`;
    fs.mkdirSync(mediaDir("files"), { recursive: true });
    try {
      fs.writeFileSync(mediaDir("files", name), buffer, { flag: "wx" });
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
    return `media://evex/files/${name}`;
  };
  handle("image:importPath", (file) => {
    const ext = path.extname(String(file || "")).slice(1).toLowerCase();
    if (!IMAGE_EXT.includes(ext)) throw new Error(t("Ese archivo no es una imagen ({ext}).", { ext: ext || "?" }));
    const st = fs.statSync(file);
    if (!st.isFile()) throw new Error(t("Ese archivo no es una imagen ({ext}).", { ext }));
    if (st.size > MAX_IMAGE) throw new Error(t("La imagen es demasiado grande (máximo {mb} MB).", { mb: 25 }));
    return copyToMedia(file, "files");
  });
  // Imagen pegada (Ctrl+V o «Pegar imagen»): la interfaz la lee del portapapeles y manda sus bytes.
  // Se comprueba la cabecera del fichero: no basta con el tipo que diga el portapapeles.
  const MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46, 0x38], webp: [0x52, 0x49, 0x46, 0x46] };
  handle("image:importBytes", (data, type) => {
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[String(type).toLowerCase()];
    const buffer = Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data || []));
    if (!ext || !MAGIC[ext].every((b, i) => buffer[i] === b)) throw new Error(t("No hay ninguna imagen copiada en el portapapeles."));
    if (buffer.length > MAX_IMAGE) throw new Error(t("La imagen es demasiado grande (máximo {mb} MB).", { mb: 25 }));
    return saveImageBuffer(buffer, ext);
  });
  handle("image:importUrl", async (url) => {
    const { buffer, ext } = await downloadGif(String(url || "").trim(), { fetchImpl: (u, opts) => net.fetch(u, opts), maxBytes: MAX_IMAGE });
    return saveImageBuffer(buffer, ext);
  });

  handle("emoji:import", async () => {
    const r = await dialog.showOpenDialog(win, { title: t("Elige imágenes (GIF, PNG, WebP…) — el nombre del fichero será el :código:"), properties: ["openFile", "multiSelections"], filters: fileFilters("image") });
    if (r.canceled) return [];
    return r.filePaths.map((f) => ({
      name: path.basename(f, path.extname(f)).toLowerCase().replace(/[^a-z0-9_+-]+/g, "_"),
      url: copyToMedia(f, "emoji"),
    }));
  });

  handle("theme:export", async (data) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: `${(data.name || "tema").replace(/[^\w-]+/g, "_")}.evex-theme.json`, filters: [{ name: t("Tema EvEX"), extensions: ["json"] }] });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2));
    return true;
  });
  handle("theme:import", async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: t("Tema EvEX"), extensions: ["json"] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return JSON.parse(fs.readFileSync(r.filePaths[0], "utf8"));
  });

  handle("avatar:set", async (id) => {
    const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: fileFilters("image") });
    if (r.canceled || !r.filePaths[0]) return false;
    let img = nativeImage.createFromPath(r.filePaths[0]);
    if (img.isEmpty()) throw new Error(t("No se pudo leer la imagen"));
    const { width, height } = img.getSize();
    const side = Math.min(width, height);
    img = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side }).resize({ width: 128, height: 128, quality: "best" });
    await getConn(id).setOwnAvatar(img.toPNG(), "image/png");
    return true;
  });

  handle("fonts:list", () => listSystemFonts());

  // Burbuja propia, notificación de Windows o ambas, según Preferencias → Notificaciones.
  handle("notify", (data) => {
    const n = store.get().settings.notifications;
    const style = n.popupStyle || "custom";
    if (style === "custom" || style === "both") showPopup(data);
    if ((style === "windows" || style === "both") && Notification.isSupported()) {
      const body = [data.text, ...(data.fields || []).map((f) => `${f.key}: ${f.value}`)].filter(Boolean).join("\n");
      const toast = new Notification({ title: data.title, body: body.slice(0, 400), silent: true, icon: nativeImage.createFromBuffer(renderIcon(128)), urgency: data.kind === "ping" ? "critical" : "normal" });
      toast.on("click", () => openFromNotification(data));
      toast.show();
    }
    if (n.flashTaskbar && win && !win.isFocused()) win.flashFrame(true);
    return true;
  });
  handle("notify:test", (kind, colors) => {
    showPopup(
      kind === "ping"
        ? { kind: "ping", title: "Capital fleet up now!!", fields: [{ key: "FC Name", value: "Ejemplo FC" }, { key: "Formup Location", value: "1DQ1-A" }, { key: "Doctrine", value: "Typhoons" }], footer: t("Prueba de EvEX-MPP"), time: testTimes(), colors }
        : { kind: "msg", title: t("Alice en general"), text: t("Esto es una notificación de prueba 👋"), time: testTimes(), colors },
    );
  });

  handle("window:unread", (count, pings) => setUnread(count, pings));
  handle("window:titlebar", ({ color, symbolColor }) => {
    if (win && process.platform === "win32") win.setTitleBarOverlay({ color, symbolColor, height: 40 });
  });
  handle("window:focus", () => showWindow());
  handle("shell:open", (url) => openExternal(url));
  handle("shell:openUserData", () => shell.openPath(userData()));
  handle("app:quit", () => {
    quitting = true;
    app.quit();
  });
}

function testTimes() {
  const d = new Date();
  const s = store.get().settings;
  return {
    local: s.showLocalTime !== false ? d.toLocaleTimeString(currentLang() === "es" ? "es-ES" : "en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null,
    eve: s.showEveTime !== false ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" }) : null,
  };
}

function openFromNotification(data) {
  showWindow();
  send("nav", { accountId: data.accountId, conv: data.conv, convType: data.convType });
}

function applySystemSettings(s) {
  scheduleUpdateChecks(!!s.behavior.checkUpdates);
  configurePopups({ corner: s.notifications.popupCorner, duration: s.notifications.popupDuration, pingSticky: s.notifications.pingSticky, preload: path.join(ROOT, "src", "preload.cjs"), onClick: openFromNotification });
  refreshTray();
  try {
    // El portable se descomprime en una carpeta temporal: hay que registrar el .exe original.
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!s.behavior.startWithWindows, path: exe, args: ["--hidden"] });
  } catch {}
  try {
    const langs = s.behavior.spellcheck ? s.behavior.spellLanguages.filter((l) => session.defaultSession.availableSpellCheckerLanguages.includes(l)) : [];
    session.defaultSession.setSpellCheckerEnabled(!!s.behavior.spellcheck && langs.length > 0);
    if (langs.length) session.defaultSession.setSpellCheckerLanguages(langs);
  } catch {}
}

// ---------- ausencia automática ----------

function startIdleWatcher() {
  setInterval(() => {
    const mins = store.get().settings.behavior.autoAwayMinutes;
    if (!mins) return;
    const idle = powerMonitor.getSystemIdleTime();
    for (const [id, x] of accounts) {
      if (!x.online) continue;
      if (idle >= mins * 60 && !autoAway.has(id) && (x.presence.show === "" || x.presence.show === "chat")) {
        autoAway.set(id, { ...x.presence });
        x.setPresence("away", x.presence.status || t("Ausente (inactivo)")).catch(() => {});
      } else if (idle < 30 && autoAway.has(id)) {
        const prev = autoAway.get(id);
        autoAway.delete(id);
        if (x.presence.show === "away") x.setPresence(prev.show, prev.status).catch(() => {});
      }
    }
  }, 15000);
}

// ---------- arranque ----------

app.on("second-instance", showWindow);

app.whenReady().then(async () => {
  store.load();
  setLanguage(store.get().settings.language);
  logs = new Logs(path.join(userData(), "logs"));
  registerProtocols();
  registerIpc();
  popupIpc(handle);
  applySystemSettings(store.get().settings);

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(["notifications", "clipboard-sanitized-write", "clipboard-read", "media", "fullscreen"].includes(permission)));
  // Las imágenes externas (vistas previas, emojis animados) no deben enviar cookies ni referer.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ["https://*/*", "http://*/*"] }, (details, cb) => {
    const h = details.requestHeaders;
    delete h.Referer;
    delete h.Cookie;
    cb({ requestHeaders: h });
  });

  createWindow();
  createTray();
  startIdleWatcher();

  for (const a of store.get().accounts) {
    if (a.autoLogin && store.hasPassword(a.id)) connectAccount(a.id).catch(() => {});
  }
});

app.on("before-quit", () => {
  quitting = true;
  store.flush();
});

app.on("will-quit", (e) => {
  if (accounts.size && !app.__disconnected) {
    e.preventDefault();
    app.__disconnected = true;
    Promise.race([Promise.all([...accounts.values()].map((x) => x.disconnect(true))), new Promise((r) => setTimeout(r, 2500))]).finally(() => app.quit());
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && quitting) app.quit();
});
