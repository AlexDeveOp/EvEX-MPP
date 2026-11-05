// Mini ventana para jugar: una ventanita siempre encima (por encima de EVE en ventana sin bordes, como las burbujas)
// con el último ping, la cuenta atrás del próximo formup y los no leídos. No roba el foco ni parpadea: se crea sin
// foco (focusable: false) y se enseña con showInactive. Robar el foco o hacer parpadear la barra de tareas puede
// sacar a EVE de pantalla completa o dejarlo colgado.
// Los datos los prepara la ventana principal (renderer/js/mini-feed.js) y aquí solo se reenvían.
// La posición y el tamaño se guardan por monitor en userData/mini-window.json (no en los ajustes: la ventana
// principal los guarda enteros y pisaría lo que se mueva aquí).
import { BrowserWindow, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { userData } from "./paths.js";
import { placeBounds, rememberBounds, fitBounds, clampOpacity, MINI_MIN, MINI_MAX } from "./mini-bounds.js";

let win = null;
let lastState = null;
let current = { enabled: false, opacity: 0.85, clickThrough: false };
let options = { preload: "", onClick: () => {}, onShow: () => {}, onChange: () => {} };
let saveTimer = null;
let watchingDisplays = false;

const boundsFile = () => path.join(userData(), "mini-window.json");
function loadSaved() {
  try {
    return JSON.parse(fs.readFileSync(boundsFile(), "utf8"));
  } catch {
    return null;
  }
}
function saveBounds() {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const d = screen.getDisplayMatching(b);
  try {
    fs.writeFileSync(boundsFile(), JSON.stringify(rememberBounds(loadSaved(), d.id, b)));
  } catch {}
}

export function configureMini(o) {
  options = { ...options, ...o };
}

export const isMiniOpen = () => !!win && !win.isDestroyed();

function applyLook() {
  if (!isMiniOpen()) return;
  win.setOpacity(clampOpacity(current.opacity));
  // «Dejar pasar los clics»: el ratón llega a lo que haya debajo (EVE). forward: la página sigue viendo el ratón
  // encima, para mostrar que está en ese modo.
  win.setIgnoreMouseEvents(!!current.clickThrough, current.clickThrough ? { forward: true } : undefined);
}

function open() {
  if (!watchingDisplays) {
    watchingDisplays = true;
    screen.on("display-removed", () => refitMini());
  }
  const bounds = placeBounds(loadSaved(), screen.getAllDisplays(), screen.getPrimaryDisplay().id);
  win = new BrowserWindow({
    ...bounds,
    minWidth: MINI_MIN.width,
    minHeight: MINI_MIN.height,
    maxWidth: MINI_MAX.width,
    maxHeight: MINI_MAX.height,
    show: false,
    frame: false,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: "#11151c",
    title: "EvEX-MPP mini",
    webPreferences: { preload: options.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  // «screen-saver» queda por encima de juegos en ventana sin bordes y de la barra de tareas (igual que las burbujas).
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces?.(true);
  const later = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveBounds, 400);
  };
  win.on("moved", later);
  win.on("resized", later);
  win.on("closed", () => {
    clearTimeout(saveTimer);
    win = null;
    options.onChange(false);
  });
  win.loadURL("app://evex/mini.html");
  win.once("ready-to-show", () => {
    applyLook();
    win.showInactive();
  });
  options.onChange(true);
}

function close() {
  if (!isMiniOpen()) return;
  saveBounds();
  win.destroy();
}

// Se llama al arrancar y cada vez que se guardan los ajustes.
export function applyMini(settings) {
  current = { ...current, ...(settings?.mini || {}) };
  if (!current.enabled) return close();
  if (!isMiniOpen()) open();
  else applyLook();
}

// Si se desconecta el monitor en que estaba, vuelve al área visible.
export function refitMini() {
  if (!isMiniOpen()) return;
  const b = win.getBounds();
  win.setBounds(fitBounds(b, screen.getDisplayMatching(b).workArea));
}

export function miniIpc(handle) {
  handle("mini:update", (state) => {
    lastState = state;
    if (isMiniOpen()) win.webContents.send("mini-state", state);
  });
  handle("mini:get", () => lastState);
  handle("mini:click", (target) => {
    if (current.clickThrough) return;
    // { show: true }: solo traer la app (no leídos); menciones o, por defecto, la vista de pings.
    if (target?.show) return options.onShow();
    options.onClick({ accountId: null, conv: "*", convType: target?.convType === "mentions" ? "mentions" : "pings" });
  });
}
