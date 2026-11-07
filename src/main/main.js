// Proceso principal de EvEX-MPP: ventanas, bandeja, protocolos internos, IPC y conexiones XMPP.
import { app, BrowserWindow, ipcMain, protocol, net, shell, Menu, nativeImage, Notification, powerMonitor, session, clipboard, globalShortcut } from "electron";
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
import { configureMini, applyMini, miniIpc, isMiniOpen, miniOnTop, resendMini } from "./mini-window.js";
import { captureNotification, captureMiniState, keepCapture } from "./capture.js";
import { createTray, getTray, buildTrayMenu, refreshTray, setUnread, setTrayDnd } from "./tray.js";
import { configurePingSync, syncPings } from "./ping-sync.js";
import { createPingDedupe, isPingSender } from "./ping-dedupe.js";
import { registerMediaIpc } from "./media-ipc.js";
import { registerPidginIpc } from "./pidgin-ipc.js";
import { markFcReply, registerFcIpc } from "./fc-ipc.js";
import { registerFcShareIpc } from "./fc-share-ipc.js";
import { userData, mediaDir, avatarDir } from "./paths.js";
import { createConnLog } from "./conn-log.js";
import { autostartFile, autostartExec, desktopEntry, storeUserDataDir } from "./platform.js";
import { checkForUpdates, repoFromUrl } from "./updates.js";
import { isProviderUrl } from "./gifs.js";
import { startBridge, testProxy, normalizeProxy, openTunnel } from "./proxy.js";
import { globalProxy, accountProxy } from "./proxy-settings.js";
import { createNetFetch } from "./net-fetch.js";

import { t, setLanguage, currentLang } from "./i18n.js";
import { pruneHistory, cutoffFor, DAY_MS } from "./retention.js";
import { wipeAccount, nextAuthFailures } from "./account-wipe.js";
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
// Un solo registro de conexión para todas las cuentas, en la carpeta de datos ya fijada (ver conn-log.js).
const connLog = createConnLog(path.join(userData(), "connection.log"));
// Linux: Chromium solo usa las voces del sistema (speech-dispatcher) para «Leer en voz alta» si se le pide al arrancar.
if (process.platform === "linux") app.commandLine.appendSwitch("enable-speech-dispatcher");
// Atajo global del modo captura en Wayland: Chromium lo pide al portal GlobalShortcuts de xdg-desktop-portal (si el
// escritorio no lo tiene, se usa la orden «evex-mpp --toggle-capture»; ver Preferencias → Privacidad).
if (process.platform === "linux") app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");

// Electron en Linux solo pide a logind el aviso de apagado (el que permite cerrar bien, ver «shutdown» más abajo) si
// «shutdown» no es el primer oyente de powerMonitor: comprobado en Electron 45 con systemd-inhibit. Este oyente vacío,
// registrado antes de ready, va primero a propósito.
powerMonitor.on("resume", () => {});

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  { scheme: "media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win = null;
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
// Versión de la Microsoft Store (MSIX): la Store la actualiza y Windows gestiona el inicio automático (tarea de inicio
// del paquete, en Configuración → Aplicaciones → Inicio), así que no se consulta GitHub ni se usan los login items.
const STORE = process.windowsStore === true;

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
    if (getTray() && (!win || !win.isVisible())) getTray().displayBalloon({ title: t("Hay una versión nueva de EvEX-MPP"), content: t("Versión {version}. Ábrela desde la ventana de la app.", { version: r.latest }), iconType: "info" });
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

// Icono de la ventana (barra de tareas y Alt+Tab): un tamaño por escala de pantalla, todos con el dibujo pequeño
// (solo el cyno). Con un único PNG de 256, Windows lo reducía y en la barra de tareas se veía el dibujo con naves.
function windowIcon() {
  const img = nativeImage.createEmpty();
  for (const [scaleFactor, px] of [
    [1, 32],
    [1.25, 40],
    [1.5, 48],
    [2, 64],
    [2.5, 80],
    [3, 96],
  ])
    img.addRepresentation({ scaleFactor, width: px, height: px, buffer: renderIcon(px, { small: true }) });
  return img;
}

function createWindow() {
  const s = store.get().settings;
  const bounds = s.layout.window || { width: 1280, height: 820 };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: "EvEX-MPP",
    icon: windowIcon(),
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
  // Sin «cerrar a la bandeja», la ventana se destruye y la app sigue en la bandeja (y con la mini ventana): se olvida,
  // para que «Mostrar EvEX-MPP» o la mini la vuelvan a crear en vez de fallar con una ventana destruida.
  const self = win;
  win.on("closed", () => {
    if (win !== self) return;
    win = null;
    rendererReady = false;
  });
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

  // En Wayland (GNOME) Chromium a veces no pinta una ventana oculta y «ready-to-show» no llega nunca: la app se
  // quedaba abierta solo en la bandeja. Se muestra con lo primero que llegue: ese evento o la página ya cargada.
  let revealed = false;
  const reveal = async () => {
    if (revealed) return;
    revealed = true;
    // Arrancar oculta (inicio automático o «Iniciar minimizada») solo si hay bandeja; sin ella, minimizada en la barra.
    await trayCheck;
    if (!win || win.isDestroyed()) return;
    const hidden = START_HIDDEN || s.behavior.startMinimized;
    if (!hidden) win.show();
    else if (!trayAvailable) win.minimize();
    if (DEV) win.webContents.openDevTools({ mode: "detach" });
  };
  win.once("ready-to-show", reveal);
  // Un pequeño margen tras la carga deja que «ready-to-show» llegue primero cuando sí funciona (sin parpadeo).
  win.webContents.once("did-finish-load", () => setTimeout(reveal, 250));
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
  const tray = getTray();
  if (!cfg.imported.__trayHintShown && tray) {
    cfg.imported.__trayHintShown = 1;
    store.save();
    tray.displayBalloon({ title: t("EvEX-MPP sigue abierto"), content: t("Está en la bandeja del sistema. Haz clic en el icono para volver; para salir usa «Salir» en su menú."), iconType: "info" });
  }
}

function showWindow() {
  if (!win || win.isDestroyed()) return createWindow();
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
  return { ...a, rooms: a.rooms.map(({ password, ...r }) => ({ ...r, hasPassword: !!password })), hasPassword: store.hasPassword(a.id), hasProxyPassword: hasProxyPassword(a.id) };
}

// ---------- proxy ----------

// Contraseñas de proxy. Sin llavero (Linux) no se guardan en disco: se quedan en memoria hasta cerrar la app, y si
// faltan se piden al conectar (NEED_PROXY_PASSWORD), igual que la contraseña de la cuenta.
const sessionProxyPasswords = new Map(); // clave de proxy -> contraseña, solo en memoria
const proxyPassword = async (id) => sessionProxyPasswords.get(store.proxySecretKey(id)) ?? (await store.getPassword(store.proxySecretKey(id)));
const hasProxyPassword = (id) => sessionProxyPasswords.has(store.proxySecretKey(id)) || store.hasPassword(store.proxySecretKey(id));
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

// El proxy general pide usuario pero no hay contraseña (Linux sin llavero, tras reiniciar): la interfaz la pide al arrancar.
function globalNeedsPassword() {
  const g = store.get().settings.proxy;
  return !!(g.enabled && g.host && g.username && !hasProxyPassword(store.GLOBAL_PROXY));
}

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

// Devuelve "memory" si, por no haber llavero, la contraseña se queda solo en memoria.
async function saveProxyPassword(key, password) {
  if (password === undefined) return null;
  const k = store.proxySecretKey(key);
  sessionProxyPasswords.delete(k);
  try {
    await store.setPassword(k, password || null);
    return null;
  } catch (err) {
    if (err.code !== "NO_KEYRING") throw err;
    if (password) sessionProxyPasswords.set(k, password);
    return "memory";
  }
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
    contactAvatars: Object.fromEntries(x.pepAvatars),
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
  // Mientras se borra una cuenta no se puede volver a conectar (ver account:wipe).
  if (wipingAccounts.has(id)) throw new Error(t("Se están borrando los datos de esta cuenta."));
  let x = accounts.get(id);
  const acc = store.getAccount(id);
  if (!acc) throw new Error(t("Cuenta no encontrada"));
  if (!x) {
    x = new XmppAccount(acc, { avatarDir: avatarDir(), version: app.getVersion(), getProxy: () => accountProxy(x.acc, store.get().settings, proxyPassword), log: connLog });
    x.historyOptions = (roomJid) => historyOptions(id, roomJid);
    x.on("event", (ev) => onAccountEvent(x, ev));
    accounts.set(id, x);
  }
  x.acc = acc;
  return x;
}

const pingRepeats = createPingDedupe();

function onAccountEvent(x, ev) {
  const accId = x.acc.id;
  // Modo FC: la respuesta del bot a un envío en curso no es un ping (ev.fcReply); se guarda como mensaje normal.
  markFcReply(x, ev);
  // La segunda copia de un ping (otra conexión de la cuenta, p. ej. Pidgin) no se guarda ni se avisa.
  if (ev.type === "message" && !ev.outgoing && !ev.replaces && !ev.fcReply && isPingSender(store.get().settings.pingSenders, x.acc.jid, ev.conv)) {
    if (pingRepeats.repeated(`${accId}/${ev.conv.toLowerCase()}`, ev.body, ev.ts)) return;
  }
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
  if (ev.type === "status" || ev.type === "auth-rejected") countAuthFailures(accId, ev);
  sendXmpp(ev);
  // Con el servidor ya conocido, se piden al archivo los pings que llegaron mientras la app estaba cerrada.
  if (ev.type === "server-info") syncPings().catch(() => {});
}

// ---- rechazos del servidor al entrar (posible revocación) ----
// Se cuentan solo los rechazos de la autenticación (SASL: contraseña, cuenta desactivada, credenciales caducadas), nunca
// los errores de red, y se guardan para que cuenten también entre un arranque y otro. Al conectar bien vuelve a 0.
// La interfaz avisa desde el segundo rechazo seguido, o desde el primero si el servidor dice que la cuenta está
// desactivada o sus credenciales caducadas, y no cambia nada sin preguntar.
const wipingAccounts = new Set();
function countAuthFailures(accId, ev) {
  const acc = store.getAccount(accId);
  if (!acc) return;
  const { count, notify } = nextAuthFailures(acc.authFailures, ev);
  if (count !== (acc.authFailures || 0)) {
    acc.authFailures = count;
    store.save();
  }
  if (ev.type === "auth-rejected") Object.assign(ev, { count, notify });
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
  // Si el proxy pide usuario y no hay contraseña (p. ej. Linux sin llavero, tras reiniciar), se pide antes de conectar.
  try {
    await accountProxy(x.acc, store.get().settings, proxyPassword);
  } catch (err) {
    if (err.code === "NEED_PROXY_PASSWORD") throw new Error(x.acc.proxy?.mode === "custom" ? "NEED_PROXY_PASSWORD" : "NEED_GLOBAL_PROXY_PASSWORD", { cause: err });
    throw err;
  }
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
      repo: REPO,
      platform: process.platform,
      focused: !!win?.isFocused(),
      system: { platform: process.platform, store: STORE, secretStorage: await store.secretStorageSoon(), trayAvailable, miniOnTop: miniOnTop(), hasProxyPassword: hasProxyPassword(store.GLOBAL_PROXY), globalProxyNeedsPassword: globalNeedsPassword() },
    };
  });

  handle("ready", () => {
    rendererReady = true;
    for (const ev of pendingEvents.splice(0)) send("xmpp", ev);
    if (updateFound) send("update-available", updateFound);
    updateFound = null;
    if (pendingRecovered) send("pings-recovered", { count: pendingRecovered });
    pendingRecovered = 0;
    if (pendingNav) send("nav", pendingNav);
    pendingNav = null;
    // Pings que recibió Pidgin con la app cerrada; después se revisa cada 2 minutos (por si Pidgin, con más
    // prioridad, se los queda mientras la app está abierta).
    syncPings({ server: false }).catch(() => {});
    clearInterval(pingSyncTimer);
    pingSyncTimer = setInterval(() => syncPings({ server: false }).catch(() => {}), 120e3);
  });

  // Botón «Buscar pings nuevos»: registros de Pidgin y archivo del servidor, al momento.
  handle("pings:sync", () => syncPings({ notify: false }));

  // Comprobación pedida a mano (botón «Comprobar ahora»): la interfaz muestra el resultado.
  handle("updates:check", () => (STORE ? { store: true } : checkLatest()));

  handle("settings:set", async (settings) => {
    const before = currentLang();
    const proxyBefore = JSON.stringify(store.get().settings.proxy);
    // El modo captura lo lleva el proceso principal: la copia de la ventana no lo deshace (ver keepCapture).
    const s = store.setSettings(keepCapture(settings, store.get().settings));
    if (JSON.stringify(s.proxy) !== proxyBefore) {
      await applyGlobalProxy();
      reconnectWithNewProxy((acc) => acc.proxy?.mode === "global");
    }
    setLanguage(s.language);
    applySystemSettings(s);
    // El menú de la bandeja se construye con textos traducidos: rehacerlo si cambia el idioma.
    if (currentLang() !== before) refreshTrayMenu();
    return s;
  });

  handle("account:save", async ({ account, password, proxyPassword: newProxyPassword }) => {
    const prev = account.id ? store.getAccount(account.id) : null;
    const proxyBefore = JSON.stringify(prev?.proxy);
    const merged = prev ? { ...prev, ...account, rooms: account.rooms ? account.rooms.map((r) => ({ ...r, password: r.password ?? prev.rooms.find((p) => p.jid === r.jid)?.password })) : prev.rooms } : account;
    // Con una contraseña nueva, los rechazos de la anterior ya no cuentan.
    if (password) merged.authFailures = 0;
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
    // Sin llavero, la contraseña del proxy queda solo en memoria (hasta cerrar la app).
    const proxyWhere = await saveProxyPassword(acc.id, newProxyPassword);
    const x = accounts.get(acc.id);
    if (x) x.acc = acc;
    if (prev && (JSON.stringify(acc.proxy) !== proxyBefore || newProxyPassword !== undefined)) reconnectWithNewProxy((a) => a.id === acc.id);
    return { ...publicAccount(acc), ...(passwordNotSaved ? { passwordNotSaved } : {}), ...(proxyWhere === "memory" ? { proxyPasswordInMemory: true } : {}) };
  });

  handle("account:delete", async (id) => {
    await accounts.get(id)?.disconnect();
    accounts.delete(id);
    store.removeAccount(id);
    sessionProxyPasswords.delete(store.proxySecretKey(id));
    return true;
  });

  // Borrar la cuenta y todos sus datos locales (account-wipe.js). typedJid: el JID que ha escrito el usuario para confirmar.
  // Primero se desconecta (sin reintentos ni temporizadores, y sin poder volver a conectar a medias); después se borra lo
  // de la carpeta de datos. Si algún paso falla, la cuenta se queda en la lista y se dice qué faltó.
  handle("account:wipe", async (id, typedJid) => {
    const acc = store.getAccount(id);
    if (!acc) throw new Error(t("Cuenta no encontrada"));
    if (String(typedJid || "").trim().toLowerCase() !== acc.jid) throw new Error(t("El JID escrito no coincide con el de la cuenta."));
    if (wipingAccounts.has(id)) throw new Error(t("Se están borrando los datos de esta cuenta."));
    wipingAccounts.add(id);
    try {
      const x = accounts.get(id);
      const ownAvatarHash = x?.avatarHash || "";
      // Fuera del mapa antes de esperar al cierre: así nada (reconexión al volver la red, cambio de proxy) la encuentra.
      accounts.delete(id);
      await x?.disconnect();
      const others = store.get().accounts.filter((a) => a.id !== id);
      const result = await wipeAccount({
        userData: userData(),
        logs,
        settings: store.get().settings,
        imported: store.get().imported,
        accountId: id,
        jid: acc.jid,
        otherIds: others.map((a) => a.id),
        ownAvatarHash,
        otherAvatarHashes: others.map((a) => accounts.get(a.id)?.avatarHash).filter(Boolean),
        avatarDir: avatarDir(),
        connLogFiles: [path.join(userData(), "connection.log"), path.join(userData(), "connection.old.log")],
        removeSecrets: async () => {
          await store.setPassword(id, null);
          await store.setPassword(store.proxySecretKey(id), null);
          sessionProxyPasswords.delete(store.proxySecretKey(id));
        },
        removeAccount: () => store.removeAccount(id),
      });
      store.save();
      store.flush();
      send("accounts", store.get().accounts.map(publicAccount));
      return result;
    } finally {
      wipingAccounts.delete(id);
    }
  });

  handle("account:connect", (id, password) => connectAccount(id, password));

  // Contraseña del proxy general: "" la borra.
  handle("proxy:password", async (password) => {
    const where = await saveProxyPassword(store.GLOBAL_PROXY, password ?? "");
    await applyGlobalProxy();
    reconnectWithNewProxy((acc) => acc.proxy?.mode === "global");
    return { hasProxyPassword: hasProxyPassword(store.GLOBAL_PROXY), inMemory: where === "memory" };
  });

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

  // La red ha vuelto (evento «online» de la ventana) o el PC sale de suspensión: cada cuenta lo comprueba o reintenta
  // ya, sin esperar al siguiente ping o reintento.
  const nudgeAccounts = (why) => {
    for (const x of accounts.values()) x.nudge(why);
  };
  handle("network:online", () => nudgeAccounts("window reports network online"));
  powerMonitor.on("resume", () => setTimeout(() => nudgeAccounts("resume from sleep"), 3000)); // margen para que la red se levante

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
  handle("room:services", (id, domain) => getConn(id).listMucServices(domain));
  handle("room:nick", (id, room, nick) => getConn(id).changeNick(room, nick));
  handle("room:subject", (id, room, subject) => getConn(id).setSubject(room, subject));
  handle("room:moderate", (id, room, opts) => getConn(id).moderate(room, opts));
  handle("room:invite", (id, room, jid, reason) => getConn(id).invite(room, jid, reason));
  handle("room:affiliations", (id, room, affiliation) => getConn(id).getAffiliations(room, affiliation));
  handle("room:config-get", (id, room, lang) => getConn(id).getRoomConfig(room, lang));
  handle("room:config-set", (id, room, fields, values) => getConn(id).setRoomConfig(room, fields, values));
  handle("xmpp:ping", (id, target) => getConn(id).pingJid(target));
  handle("msg:attention", (id, to) => getConn(id).sendAttention(to));
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
  // ---- caducidad del historial (retention.js; Preferencias → Privacidad) ----
  // preview: cuánto borrarían unos plazos (la ventana lo enseña para que el usuario confirme antes de guardarlos).
  handle("retention:preview", (retention) => pruneHistory(logs, store.get().accounts, store.get().settings, { dryRun: true, retention }));
  // apply: poda ya con los plazos guardados (solo se guardan después de confirmar).
  handle("retention:apply", () => runRetention("ajustes"));

  registerMediaIpc(handle, { getWin: () => win, getConn, fetchImpl: netFetch });
  registerPidginIpc(handle, { logs, send, publicAccount });
  registerFcIpc(handle, { getConn });
  registerFcShareIpc(handle, { getWin: () => win, getFcMode: () => store.get().settings.fcMode });

  // Burbuja propia, notificación de Windows o ambas, según Preferencias → Notificaciones.
  handle("notify", (data) => {
    // Modo captura: el aviso va sin contenido (ni texto del ping, ni formup, ni sala, ni cuenta, ni hora).
    if (captureOn()) data = captureNotification(data);
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
  handle("capture:toggle", () => setCapture({ enabled: !captureOn() }));
  handle("capture:set", (patch) => setCapture(patch));
  handle("dnd:state", (state) => setTrayDnd(state));
  // Botones propios de la ventana (la barra de título la dibuja la app). Cerrar pasa por win.on("close"):
  // con «cerrar a la bandeja» activado, la ventana solo se oculta.
  handle("window:minimize", () => win?.minimize());
  handle("window:maximize", () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  handle("window:close", () => win?.close());
  handle("window:focus", () => showWindow());
  handle("shell:open", (url) => openExternal(url));
  // En la versión de la Store, la carpeta que ve el Explorador es la redirigida del paquete (si existe).
  handle("shell:openUserData", () => {
    const real = STORE ? storeUserDataDir({ execPath: process.execPath, localAppData: process.env.LOCALAPPDATA, userData: userData() }) : null;
    return shell.openPath(real && fs.existsSync(real) ? real : userData());
  });
  handle("shell:startupSettings", () => (STORE ? shell.openExternal("ms-settings:startupapps") : undefined));
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

// El menú de la bandeja lleva textos traducidos y la casilla de la mini ventana: se rehace cuando cambian.
function refreshTrayMenu() {
  getTray()?.setContextMenu(buildTrayMenu());
}

// Casilla de la bandeja: la mini ventana se abre o se cierra aquí mismo, aunque la ventana principal no esté lista
// (arranque oculto) o ya no exista. Se guarda el ajuste y se avisa a la ventana principal, si la hay.
function toggleMiniWindow() {
  const s = store.get().settings;
  s.mini = { ...s.mini, enabled: !isMiniOpen() };
  store.save();
  applyMini(s);
  refreshTrayMenu();
  send("mini-changed", s.mini);
}

// ---------- modo captura (src/main/capture.js, renderer/js/capture.js) ----------
// El estado está en settings.capture y lo cambia el proceso principal: así vale también desde la bandeja, el atajo
// global o la orden «--toggle-capture», aunque la ventana principal no esté abierta. Se avisa con «capture-changed».
const CAPTURE_ACCELERATOR = "CommandOrControl+Shift+H";
const captureOn = () => !!store.get().settings.capture?.enabled;
let captureShortcut = { requested: false, registered: false, portal: false };

function applyCaptureShortcut(s) {
  const want = !!s.capture?.globalShortcut;
  if (captureShortcut.registered) globalShortcut.unregister(CAPTURE_ACCELERATOR);
  captureShortcut = { requested: want, registered: false, portal: false };
  if (!want) return captureShortcut;
  try {
    captureShortcut.registered = globalShortcut.register(CAPTURE_ACCELERATOR, () => setCapture({ enabled: !captureOn() }));
  } catch {
    captureShortcut.registered = false;
  }
  captureShortcut.portal = captureShortcut.registered && process.platform === "linux" && !!process.env.WAYLAND_DISPLAY;
  return captureShortcut;
}

function setCapture(patch = {}) {
  const s = store.get().settings;
  const before = s.capture || {};
  s.capture = { ...before, ...Object.fromEntries(["enabled", "globalShortcut"].filter((k) => k in patch).map((k) => [k, !!patch[k]])) };
  store.save();
  if (s.capture.globalShortcut !== !!before.globalShortcut) applyCaptureShortcut(s);
  if (s.capture.enabled !== !!before.enabled) {
    resendMini();
    refreshTrayMenu();
  }
  send("capture-changed", s.capture);
  return { capture: s.capture, shortcut: captureShortcut };
}

// Si la ventana se acaba de crear (estaba cerrada), la página aún no escucha: el destino se manda al estar lista.
let pendingNav = null;
function openFromNotification(data) {
  showWindow();
  const nav = { accountId: data.accountId, conv: data.conv, convType: data.convType };
  if (rendererReady) send("nav", nav);
  else pendingNav = nav;
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
  scheduleUpdateChecks(!STORE && !!s.behavior.checkUpdates);
  configurePopups({ corner: s.notifications.popupCorner, duration: s.notifications.popupDuration, pingDuration: s.notifications.pingDuration, pingSticky: s.notifications.pingSticky, display: s.notifications.popupDisplay, displayHint: s.notifications.popupDisplayHint, getWin: () => win, preload: path.join(ROOT, "src", "preload.cjs"), onClick: openFromNotification });
  // Mini ventana para jugar: al abrirla o cerrarla, la casilla de la bandeja cambia.
  configureMini({ preload: path.join(ROOT, "src", "preload-mini.cjs"), onClick: openFromNotification, onShow: showWindow, onChange: refreshTrayMenu, filter: (st) => (captureOn() ? captureMiniState(st) : st) });
  applyMini(s);
  refreshTray();
  try {
    // El portable se descomprime en una carpeta temporal: hay que registrar el .exe original.
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    if (app.isPackaged && process.platform === "linux") setLinuxAutostart(!!s.behavior.startWithWindows);
    else if (app.isPackaged && !STORE) app.setLoginItemSettings({ openAtLogin: !!s.behavior.startWithWindows, path: exe, args: ["--hidden"] });
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

// Poda del historial con los plazos guardados. Nunca para la app: un fallo se apunta y el fichero queda como estaba.
function runRetention(why) {
  try {
    const r = pruneHistory(logs, store.get().accounts, store.get().settings);
    if (r.files) console.log(`[caducidad:${why}] borrados ${r.messages} mensajes y ${r.pings} pings en ${r.files} ficheros`);
    return r;
  } catch (e) {
    console.error(`[caducidad:${why}]`, e);
    return { messages: 0, pings: 0, files: 0, error: String(e?.message || e) };
  }
}

// ---------- arranque ----------

// Otra instancia (doble clic, acceso directo…) trae la ventana. Con «--toggle-capture» solo cambia el modo captura, sin
// mostrar nada: es la orden para asignar a un atajo del escritorio donde el atajo global no funciona (Wayland).
app.on("second-instance", (_e, argv) => {
  if (argv.includes("--toggle-capture")) setCapture({ enabled: !captureOn() });
  else showWindow();
});

app.whenReady().then(async () => {
  store.load();
  setLanguage(store.get().settings.language);
  logs = new Logs(path.join(userData(), "logs"));
  // Lo que ya ha caducado no se vuelve a guardar; la poda se hace al iniciar (al minuto) y una vez al día.
  logs.setRetention(cutoffFor(() => store.get().settings, (id) => store.getAccount(id)));
  setTimeout(() => runRetention("inicio"), 60e3).unref?.();
  setInterval(() => runRetention("diaria"), DAY_MS).unref?.();
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
  miniIpc(handle);
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
  createTray({
    getWin: () => win,
    accounts,
    showWindow,
    send,
    miniOpen: isMiniOpen,
    toggleMini: toggleMiniWindow,
    captureOn,
    toggleCapture: () => setCapture({ enabled: !captureOn() }),
    quit: () => {
      quitting = true;
      app.quit();
    },
  });
  applyCaptureShortcut(store.get().settings);
  if (process.argv.includes("--toggle-capture")) setCapture({ enabled: !captureOn() });
  startIdleWatcher();
  // Linux y macOS: al apagar o reiniciar, cerrar bien antes de que se cierre el escritorio. En Wayland, si el
  // compositor desaparece antes que la app, Chromium se cierra de golpe (SIGTRAP) y Ubuntu muestra «se ha cerrado
  // inesperadamente» al volver a entrar. preventDefault() retrasa el apagado lo justo para desconectar las cuentas.
  powerMonitor.on("shutdown", (e) => {
    e.preventDefault();
    quitting = true;
    app.quit();
  });

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
  globalShortcut.unregisterAll();
  if (accounts.size && !app.__disconnected) {
    e.preventDefault();
    app.__disconnected = true;
    // app.quit() en el siguiente ciclo: si las cuentas ya estaban desconectadas, la promesa se resuelve mientras Electron
    // aún procesa esta salida e ignora la llamada, y la app se quedaba viva sin ventana (en Linux, el apagado la mataba).
    Promise.race([Promise.all([...accounts.values()].map((x) => x.disconnect(true))), new Promise((r) => setTimeout(r, 2500))]).finally(() => setImmediate(() => app.quit()));
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && quitting) app.quit();
});
