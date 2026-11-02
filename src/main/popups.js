// Notificaciones emergentes propias: ventanitas siempre encima que suben desde la barra de tareas y se apilan.
import { BrowserWindow, screen } from "electron";
import path from "node:path";

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

export function showPopup(data) {
  const id = nextId++;
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
  const sticky = p.data.kind === "ping" && options.pingSticky;
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
