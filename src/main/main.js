// Proceso principal de EvEX-MPP: ventanas, bandeja, protocolos internos, IPC y conexiones XMPP.
import { app, BrowserWindow, ipcMain, protocol, net, shell, Menu, nativeImage, Notification, powerMonitor, session, clipboard } from "electron";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as store from "./store.js";
import { XmppAccount } from "./xmpp-account.js";
import { Logs } from "./logs.js";
import { renderIcon, renderAlertIcon } from "./icon.js";
import { showPopup, configurePopups, popupIpc, systemPopups } from "./popups.js";
import { createTray, buildTrayMenu, refreshTray, setUnread } from "./tray.js";
import { configurePingSync, syncPings } from "./ping-sync.js";
import { registerMediaIpc } from "./media-ipc.js";
import { registerPidginIpc } from "./pidgin-ipc.js";
import { userData, mediaDir, avatarDir } from "./paths.js";
import { autostartFile, autostartExec, desktopEntry } from "./platform.js";
import { checkForUpdates, repoFromUrl } from "./updates.js";
import { isProviderUrl } from "./gifs.js";
import { startBridge, testProxy, normalizeProxy, openTunnel } from "./proxy.js";
import { globalProxy, accountProxy } from "./proxy-settings.js";
import { createNetFetch } from "./net-fetch.js";

import { t, setLanguage, currentLang } from "./i18n.js";
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
// Linux: Chromium solo usa las voces del sistema (speech-dispatcher) para «Leer en voz alta» si se le pide al arrancar.
if (process.platform === "linux") app.commandLine.appendSwitch("enable-speech-dispatcher");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  { scheme: "media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win = null;
let tray = null;
let quitting = false;
let logs = null;
// Los eventos XMPP que llegan mientras la interfaz carga se guardan y se entregan cuando avisa de que está lista.
let rendererReady = false;
const pendingEvents = [];
const accounts = new Map(); // id -> XmppAccount
let pingSyncTimer = null;
let pendingRecovered = 0; // pings recuperados antes de que la interfaz esté lista
const autoAway = new Map(); // id -> presencia previa


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
  return checkForUpdates({ currentVersion: app.getVersion(), repo: REPO, fetchImpl: netFetch });
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
  for (const evt of ["maximize", "unmaximize"]) win.on(evt, () => send("window-maximized", win.isMaximized()));
  // Si arranca maximizada, el aviso llega antes que la página: se repite al cargarla.
  win.webContents.on("did-finish-load", () => send("window-maximized", win.isMaximized()));
  win.on("close", (e) => {
    if (!quitting && store.get().settings.behavior.closeToTray) {
      e.preventDefault();
      hideToTray();
    }
  });
  win.on("minimize", (e) => {
    // Sin bandeja no se oculta: la ventana se quedaría sin forma de volver a abrirla.
    if (store.get().settings.behavior.minimizeToTray && trayAvailable) {
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

  win.once("ready-to-show", async () => {
    // Arrancar oculta (inicio automático o «Iniciar minimizada») solo si hay bandeja; sin ella, minimizada en la barra.
    await trayCheck;
    const hidden = START_HIDDEN || s.behavior.startMinimized;
    if (!hidden) win.show();
    else if (!trayAvailable) win.minimize();
    if (DEV) win.webContents.openDevTools({ mode: "detach" });
  });
  win.loadURL("app://evex/index.html");
}

// En Linux la bandeja depende del escritorio (StatusNotifierItem): en GNOME sin extensión de indicadores no aparece.
// Mientras no se sepa, se da por ausente para no ocultar nunca la ventana sin forma de volver.
let trayAvailable = process.platform !== "linux";
let trayCheck = Promise.resolve();

function detectTray() {
  if (process.platform !== "linux") return Promise.resolve(true);
  const args = ["--session", "--dest=org.freedesktop.DBus", "--type=method_call", "--print-reply", "/org/freedesktop/DBus", "org.freedesktop.DBus.NameHasOwner", "string:org.kde.StatusNotifierWatcher"];
  return new Promise((resolve) => execFile("dbus-send", args, { timeout: 3000 }, (err, out) => resolve(!err && /boolean true/.test(out))));
}

function hideToTray() {
  if (!trayAvailable) return win.minimize();
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

// ---------- cuentas ----------

function publicAccount(a) {
  return { ...a, rooms: a.rooms.map(({ password, ...r }) => ({ ...r, hasPassword: !!password })), hasPassword: store.hasPassword(a.id), hasProxyPassword: store.hasPassword(store.proxySecretKey(a.id)) };
}

// ---------- proxy ----------

const proxyPassword = (id) => store.getPassword(store.proxySecretKey(id));
let bridge = null;
let bridgeProxy = null; // proxy general con contraseña, ya descifrada, para el puente

// Todo el tráfico web de la app (Chromium y net.fetch) va por un proxy HTTP local que reenvía al proxy general.
// Así valen SOCKS5 con usuario (Chromium no lo admite) y las contraseñas no salen del proceso principal. El puente
// pide un usuario y una contraseña aleatorios (ver startBridge), que la app da con «login» y con netFetch.
// Si el proxy general está activado pero falla o está incompleto, el puente responde 502: nunca se va directo.
async function applyGlobalProxy() {
  const s = store.get().settings;
  try {
    bridgeProxy = await globalProxy(s, proxyPassword);
  } catch {
    bridgeProxy = null; // incompleto: el puente responde 502
  }
  const ses = session.defaultSession;
  if (s.proxy.enabled) {
    try {
      bridge ||= await startBridge(() => bridgeProxy);
    } catch {
      bridge = null;
    }
    // Sin puente, un proxy local que no existe (puerto 9, «discard»): todo falla en vez de salir directo.
    await ses.setProxy({ proxyRules: bridge ? `http://127.0.0.1:${bridge.port}` : "http://127.0.0.1:9" });
  } else {
    await ses.setProxy({ mode: "direct" });
    // Sin proxy general, el puente no se queda escuchando.
    bridge?.close();
    bridge = null;
  }
  // Las conexiones abiertas con la configuración anterior no deben seguir usándose.
  await ses.closeAllConnections().catch(() => {});
}

// Credenciales del puente local: solo para él (127.0.0.1 y su puerto), nunca para otro proxy ni para un servidor web.
function bridgeAuth(info) {
  if (!bridge || !info?.isProxy || Number(info.port) !== bridge.port || !["127.0.0.1", "localhost"].includes(info.host)) return null;
  return { username: bridge.username, password: bridge.password };
}

// Ventanas y burbujas: Chromium pide las credenciales del proxy con este evento.
function onLogin(event, _wc, _details, authInfo, callback) {
  const auth = bridgeAuth(authInfo);
  if (!auth) return;
  event.preventDefault();
  callback(auth.username, auth.password);
}

// Descargas del proceso principal (actualizaciones, GIFs): net.fetch no da credenciales al proxy; esto sí.
const netFetch = createNetFetch(bridgeAuth);

// Reconecta las cuentas conectadas a las que afecta un cambio de proxy. Las reconexiones de una misma cuenta van en
// cola: con dos cambios seguidos, la segunda cortaba a la primera a medio abrir. Cada conexión lee el proxy al
// conectar, así que la última usa siempre la configuración más reciente.
const proxyReconnects = new Map(); // id -> promesa de la última reconexión
function reconnectWithNewProxy(filter) {
  for (const [id, x] of accounts) {
    if (!x.wantOnline || !filter(x.acc)) continue;
    const next = (proxyReconnects.get(id) || Promise.resolve())
      .then(() => x.disconnect(true))
      .then(() => connectAccount(id))
      .catch((e) => sendXmpp({ accountId: id, type: "error", message: e.message }));
    proxyReconnects.set(id, next);
    next.finally(() => proxyReconnects.get(id) === next && proxyReconnects.delete(id));
  }
}

async function saveProxyPassword(key, password) {
  if (password === undefined) return;
  await store.setPassword(store.proxySecretKey(key), password || null);
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
    server: x.serverInfo,
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
    x = new XmppAccount(acc, { avatarDir: avatarDir(), version: app.getVersion(), getProxy: () => accountProxy(x.acc, store.get().settings, proxyPassword) });
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
  // Con el servidor ya conocido, se piden al archivo los pings que llegaron mientras la app estaba cerrada.
  if (ev.type === "server-info") syncPings().catch(() => {});
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
  handle("init", async () => {
    await trayCheck;
    const cfg = store.get();
    return {
      accounts: cfg.accounts.map(publicAccount),
      settings: cfg.settings,
      states: Object.fromEntries(cfg.accounts.map((a) => [a.id, accountSnapshot(a.id)])),
      avatars: listAvatars(),
      version: app.getVersion(),
      platform: process.platform,
      focused: !!win?.isFocused(),
      system: { platform: process.platform, secretStorage: await store.secretStorageSoon(), trayAvailable, hasProxyPassword: store.hasPassword(store.proxySecretKey(store.GLOBAL_PROXY)) },
    };
  });

  handle("ready", () => {
    rendererReady = true;
    for (const ev of pendingEvents.splice(0)) send("xmpp", ev);
    if (updateFound) send("update-available", updateFound);
    updateFound = null;
    if (pendingRecovered) send("pings-recovered", { count: pendingRecovered });
    pendingRecovered = 0;
    // Pings que recibió Pidgin con la app cerrada; después se revisa cada 2 minutos (por si Pidgin, con más
    // prioridad, se los queda mientras la app está abierta).
    syncPings({ server: false }).catch(() => {});
    clearInterval(pingSyncTimer);
    pingSyncTimer = setInterval(() => syncPings({ server: false }).catch(() => {}), 120e3);
  });

  // Botón «Buscar pings nuevos»: registros de Pidgin y archivo del servidor, al momento.
  handle("pings:sync", () => syncPings({ notify: false }));

  // Comprobación pedida a mano (botón «Comprobar ahora»): la interfaz muestra el resultado.
  handle("updates:check", () => checkLatest());

  handle("settings:set", async (settings) => {
    const before = currentLang();
    const proxyBefore = JSON.stringify(store.get().settings.proxy);
    const s = store.setSettings(settings);
    if (JSON.stringify(s.proxy) !== proxyBefore) {
      await applyGlobalProxy();
      reconnectWithNewProxy((acc) => acc.proxy?.mode === "global");
    }
    setLanguage(s.language);
    applySystemSettings(s);
    // El menú de la bandeja se construye con textos traducidos: rehacerlo si cambia el idioma.
    if (tray && currentLang() !== before) tray.setContextMenu(buildTrayMenu());
    return s;
  });

  handle("account:save", async ({ account, password, proxyPassword: newProxyPassword }) => {
    const prev = account.id ? store.getAccount(account.id) : null;
    const proxyBefore = JSON.stringify(prev?.proxy);
    const merged = prev ? { ...prev, ...account, rooms: account.rooms ? account.rooms.map((r) => ({ ...r, password: r.password ?? prev.rooms.find((p) => p.jid === r.jid)?.password })) : prev.rooms } : account;
    const acc = store.upsertAccount(merged);
    let passwordNotSaved;
    try {
      if (password && acc.savePassword) await store.setPassword(acc.id, password);
    } catch (err) {
      // Sin llavero, la cuenta se guarda sin la contraseña y la interfaz explica por qué.
      if (err.code !== "NO_KEYRING") throw err;
      passwordNotSaved = "no-keyring";
    }
    if (!acc.savePassword) await store.setPassword(acc.id, null);
    try {
      await saveProxyPassword(acc.id, newProxyPassword);
    } catch (err) {
      if (err.code !== "NO_KEYRING") throw err;
      passwordNotSaved = "no-keyring";
    }
    const x = accounts.get(acc.id);
    if (x) x.acc = acc;
    if (prev && (JSON.stringify(acc.proxy) !== proxyBefore || newProxyPassword !== undefined)) reconnectWithNewProxy((a) => a.id === acc.id);
    return { ...publicAccount(acc), ...(passwordNotSaved ? { passwordNotSaved } : {}) };
  });

  handle("account:delete", async (id) => {
    await accounts.get(id)?.disconnect();
    accounts.delete(id);
    store.removeAccount(id);
    return true;
  });

  handle("account:connect", (id, password) => connectAccount(id, password));

  // Contraseña del proxy general: "" la borra.
  handle("proxy:password", async (password) => {
    await saveProxyPassword(store.GLOBAL_PROXY, password ?? "");
    await applyGlobalProxy();
    reconnectWithNewProxy((acc) => acc.proxy?.mode === "global");
    return { hasProxyPassword: store.hasPassword(store.proxySecretKey(store.GLOBAL_PROXY)) };
  });

  // Botón «Probar»: abre un túnel hasta un sitio conocido. Sin contraseña nueva, se usa la guardada.
  // Botón «Probar»: sin «target», abre un túnel hasta un sitio conocido. Con «target» (el servidor XMPP de una cuenta),
  // el túnel va hasta ese servidor: si el proxy responde pero no llega a él, se dice (target.ok = false) sin fallar.
  // Sin contraseña nueva, se usa la guardada.
  handle("proxy:test", async ({ proxy, password, accountId, global, target } = {}) => {
    const p = normalizeProxy(proxy || {});
    if (!p.host) throw new Error(t("Falta el servidor del proxy"));
    const saved = password === undefined && p.username ? await proxyPassword(global ? store.GLOBAL_PROXY : accountId) : null;
    const full = { ...p, password: password ?? saved ?? "" };
    const host = String(target?.host || "").trim();
    if (!host) return testProxy(full);
    const start = Date.now();
    try {
      const tunnel = await openTunnel(full, host, Number(target.port) || 5222);
      tunnel.destroy();
      const ms = Date.now() - start;
      return { ms, target: { ok: true, ms } };
    } catch (err) {
      if (err.code !== "PROXY_TARGET") throw err; // el fallo es del propio proxy
      return { ms: Date.now() - start, target: { ok: false, error: err.message } };
    }
  });
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

  registerMediaIpc(handle, { getWin: () => win, getConn, fetchImpl: netFetch });
  registerPidginIpc(handle, { logs, send, publicAccount });

  // Burbuja propia, notificación de Windows o ambas, según Preferencias → Notificaciones.
  handle("notify", (data) => {
    const n = store.get().settings.notifications;
    const style = n.popupStyle || "custom";
    if (style === "custom" || style === "both") showPopup(data);
    // En Wayland showPopup ya muestra una notificación del sistema: con «ambas» no se repite.
    if ((style === "windows" || (style === "both" && !systemPopups())) && Notification.isSupported()) {
      const body = [data.text, ...(data.fields || []).map((f) => `${f.key}: ${f.value}`)].filter(Boolean).join("\n");
      const toast = new Notification({ title: data.title, body: body.slice(0, 400), silent: true, icon: nativeImage.createFromBuffer(data.kind === "ping" ? renderAlertIcon(128) : renderIcon(128)), urgency: data.kind === "ping" ? "critical" : "normal" });
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
  // Botones propios de la ventana (la barra de título la dibuja la app). Cerrar pasa por win.on("close"):
  // con «cerrar a la bandeja» activado, la ventana solo se oculta.
  handle("window:minimize", () => win?.minimize());
  handle("window:maximize", () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  handle("window:close", () => win?.close());
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

// Linux no tiene «iniciar con el sistema» en Electron: se crea o se quita el .desktop de ~/.config/autostart.
// El AppImage se ejecuta desde una carpeta temporal: hay que apuntar al fichero .AppImage original. Si no se conoce
// (APPIMAGE vacía), no se escribe nada, porque apuntaría a una carpeta que desaparece al cerrar la app.
function setLinuxAutostart(enabled) {
  const file = autostartFile(os.homedir());
  const exe = autostartExec({ appImage: process.env.APPIMAGE, execPath: process.execPath });
  if (!enabled || !exe) return fs.rmSync(file, { force: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, desktopEntry({ exe, args: ["--hidden"] }));
}

function applySystemSettings(s) {
  scheduleUpdateChecks(!!s.behavior.checkUpdates);
  configurePopups({ corner: s.notifications.popupCorner, duration: s.notifications.popupDuration, pingSticky: s.notifications.pingSticky, preload: path.join(ROOT, "src", "preload.cjs"), onClick: openFromNotification });
  refreshTray();
  try {
    // El portable se descomprime en una carpeta temporal: hay que registrar el .exe original.
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    if (app.isPackaged && process.platform === "linux") setLinuxAutostart(!!s.behavior.startWithWindows);
    else if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!s.behavior.startWithWindows, path: exe, args: ["--hidden"] });
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
  configurePingSync({
    accounts,
    logs,
    // Si la interfaz aún no escucha (la cuenta conecta antes de que termine de cargar), el aviso espera a «ready».
    onRecovered: (count) => {
      if (rendererReady) send("pings-recovered", { count });
      else pendingRecovered += count;
    },
  });
  registerProtocols();
  registerIpc();
  popupIpc(handle);
  applySystemSettings(store.get().settings);
  app.on("login", onLogin);
  await applyGlobalProxy().catch(() => {});

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(["notifications", "clipboard-sanitized-write", "clipboard-read", "media", "fullscreen"].includes(permission)));
  // Las imágenes externas (vistas previas, emojis animados) no deben enviar cookies ni referer.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ["https://*/*", "http://*/*"] }, (details, cb) => {
    const h = details.requestHeaders;
    delete h.Referer;
    delete h.Cookie;
    cb({ requestHeaders: h });
  });

  trayCheck = detectTray().then((ok) => (trayAvailable = ok));
  createWindow();
  tray = createTray({
    getWin: () => win,
    accounts,
    showWindow,
    send,
    quit: () => {
      quitting = true;
      app.quit();
    },
  });
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
  bridge?.close();
  if (accounts.size && !app.__disconnected) {
    e.preventDefault();
    app.__disconnected = true;
    Promise.race([Promise.all([...accounts.values()].map((x) => x.disconnect(true))), new Promise((r) => setTimeout(r, 2500))]).finally(() => app.quit());
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && quitting) app.quit();
});
