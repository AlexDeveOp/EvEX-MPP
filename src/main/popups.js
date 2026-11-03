// Notificaciones emergentes propias: ventanitas siempre encima que suben desde la barra de tareas y se apilan.
// En Wayland se usan las notificaciones del sistema en su lugar (ver systemPopups).
import { BrowserWindow, Notification, app, nativeImage, screen } from "electron";
import path from "node:path";
import { renderIcon, renderAlertIcon } from "./icon.js";

const WIDTH = 380;
const MARGIN = 12;
const GAP = 10;
const MAX = 5;

let nextId = 1;
const popups = []; // el primero es el más cercano a la barra de tareas
let options = { corner: "bottom-left", duration: 8, pingSticky: true, preload: "", onClick: () => {} };

export function configurePopups(o) {
  options = { ...options, ...o };
}

function workArea() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
}

// Coloca las notificaciones en la esquina elegida, apiladas hacia arriba (o hacia abajo si es una esquina superior).
function layout() {
  const wa = workArea();
  const left = options.corner.endsWith("left");
  const top = options.corner.startsWith("top");
  let offset = MARGIN;
  for (const p of popups) {
    if (!p.win || p.win.isDestroyed()) continue;
    const x = left ? wa.x + MARGIN : wa.x + wa.width - WIDTH - MARGIN;
    const y = top ? wa.y + offset : wa.y + wa.height - offset - p.height;
    p.win.setBounds({ x: Math.round(x), y: Math.round(y), width: WIDTH, height: p.height });
    offset += p.height + GAP;
  }
}

// ¿Usar las notificaciones del sistema en vez de la burbuja propia?
// En Wayland una aplicación no puede elegir la posición de sus ventanas ni ponerlas por encima de las demás
// (setBounds y setAlwaysOnTop no tienen efecto): la burbuja saldría donde decida el compositor, normalmente
// en el centro y detrás de la ventana activa. Las notificaciones del sistema (org.freedesktop.Notifications)
// sí aparecen en su sitio y por encima, y respetan el «No molestar» del escritorio.
// Electron usa Wayland si hay sesión Wayland (WAYLAND_DISPLAY o XDG_SESSION_TYPE=wayland) salvo que se le fuerce
// X11 con --ozone-platform=x11; en X11 la burbuja propia funciona. EVEX_POPUPS=custom|system lo fuerza (pruebas).
export function systemPopups() {
  const forced = process.env.EVEX_POPUPS;
  if (forced === "custom") return false;
  if (forced !== "system") {
    if (process.platform !== "linux") return false;
    if (app.commandLine.getSwitchValue("ozone-platform") === "x11") return false;
    if (!process.env.WAYLAND_DISPLAY && process.env.XDG_SESSION_TYPE !== "wayland") return false;
  }
  return Notification.isSupported();
}

const systemNotes = new Map(); // id → { note, data }

function showSystemNotification(id, data) {
  const body = [data.text, ...(data.fields || []).map((f) => `${f.key}: ${f.value}`)].filter(Boolean).join("\n");
  const ping = data.kind === "ping";
  const sticky = data.sticky || (ping && options.pingSticky);
  const note = new Notification({
    title: data.title || "EvEX-MPP",
    body: body.slice(0, 400),
    silent: true, // el sonido lo pone la app
    icon: nativeImage.createFromBuffer(ping ? renderAlertIcon(128) : renderIcon(128)),
    urgency: ping ? "critical" : "normal",
    timeoutType: sticky ? "never" : "default",
  });
  note.on("click", () => options.onClick(data));
  note.on("close", () => systemNotes.delete(id));
  systemNotes.set(id, { note, data });
  note.show();
  return id;
}

export function showPopup(data) {
  const id = nextId++;
  if (systemPopups()) return showSystemNotification(id, data);
  const p = { id, data: { ...data, corner: options.corner }, height: 120, win: null, timer: null };
  const win = new BrowserWindow({
    width: WIDTH,
    height: p.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: { preload: options.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  // «screen-saver» queda por encima de juegos en ventana sin bordes y de la barra de tareas.
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces?.(true);
  p.win = win;
  popups.unshift(p);
  while (popups.length > MAX) closePopup(popups[popups.length - 1].id, true);
  win.on("closed", () => {
    const i = popups.indexOf(p);
    if (i >= 0) popups.splice(i, 1);
    clearTimeout(p.timer);
    layout();
  });
  win.loadURL(`app://evex/popup.html?id=${id}`);
  win.once("ready-to-show", () => {
    layout();
    win.showInactive();
  });
  armTimer(p);
  layout();
  return id;
}

function armTimer(p) {
  clearTimeout(p.timer);
  const sticky = p.data.sticky || (p.data.kind === "ping" && options.pingSticky);
  if (!sticky) p.timer = setTimeout(() => closePopup(p.id), Math.max(3, options.duration) * 1000);
}

export function closePopup(id, immediate) {
  const p = popups.find((x) => x.id === id);
  if (!p || p.closing) return;
  p.closing = true;
  clearTimeout(p.timer);
  if (immediate || p.win.isDestroyed()) return p.win.isDestroyed() || p.win.destroy();
  p.win.webContents.send("popup-close");
  setTimeout(() => !p.win.isDestroyed() && p.win.destroy(), 260);
}

export function closeAllPopups(kind) {
  for (const p of [...popups]) if (!kind || p.data.kind === kind) closePopup(p.id);
  for (const [id, { note, data }] of [...systemNotes]) {
    if (kind && data.kind !== kind) continue;
    note.close();
    systemNotes.delete(id);
  }
}

export function popupIpc(handle) {
  handle("popup:get", (id) => popups.find((p) => p.id === Number(id))?.data || null);
  handle("popup:size", (id, height) => {
    const p = popups.find((x) => x.id === Number(id));
    if (!p) return;
    p.height = Math.max(60, Math.min(520, Math.ceil(height)));
    layout();
  });
  handle("popup:click", (id) => {
    const p = popups.find((x) => x.id === Number(id));
    if (!p) return;
    options.onClick(p.data);
    closePopup(p.id);
  });
  handle("popup:close", (id) => closePopup(Number(id)));
  handle("popup:hover", (id, hovering) => {
    const p = popups.find((x) => x.id === Number(id));
    if (!p) return;
    if (hovering) clearTimeout(p.timer);
    else armTimer(p);
  });
}

export const popupPreloadPath = (root) => path.join(root, "src", "preload.cjs");
