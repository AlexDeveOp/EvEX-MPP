// Mini ventana para jugar: una ventanita siempre encima (por encima de EVE en ventana sin bordes, como las burbujas)
// con el último ping, la cuenta atrás del próximo formup y los no leídos. No roba el foco ni parpadea: se crea sin
// foco (focusable: false) y se enseña con showInactive (ver overlay.js).
// Los datos los prepara la ventana principal (renderer/js/mini-feed.js) y aquí solo se reenvían. La página tiene su
// propio preload (preload-mini.cjs), con solo lo que necesita.
// La posición y el tamaño se guardan por monitor en userData/mini-window.json (no en los ajustes: la ventana
// principal los guarda enteros y pisaría lo que se mueva aquí).
import { BrowserWindow, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { userData } from "./paths.js";
import { placeBounds, rememberBounds, fitBounds, clampOpacity, MINI_MIN, MINI_MAX } from "./mini-bounds.js";
import { OVERLAY_WINDOW, overlayWebPreferences, raiseOverlay, waylandSession } from "./overlay.js";

let win = null;
let lastState = null;
let current = { enabled: false, opacity: 0.85, clickThrough: false };
let options = { preload: "", onClick: () => {}, onShow: () => {}, onChange: () => {} };
let saveTimer = null;
let watchingDisplays = false;

// En Wayland el escritorio decide dónde van las ventanas: no se puede asegurar que quede encima.
export const miniOnTop = () => !waylandSession();

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
function saveLater() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveBounds, 400);
}

export function configureMini(o) {
  options = { ...options, ...o };
}

export const isMiniOpen = () => !!win && !win.isDestroyed();

function applyLook(w = win) {
  if (!w || w.isDestroyed()) return;
  w.setOpacity(clampOpacity(current.opacity));
  // «Dejar pasar los clics»: el ratón llega a lo que haya debajo (EVE). forward: la página sigue viendo el ratón
  // encima, para mostrar que está en ese modo.
  w.setIgnoreMouseEvents(!!current.clickThrough, current.clickThrough ? { forward: true } : undefined);
}

// Si cambia un monitor (se desconecta, cambia de resolución, de escala o de barra de tareas), vuelve al área visible
// y se guarda la posición corregida.
export function refitMini() {
  if (!isMiniOpen()) return;
  const b = win.getBounds();
  const next = fitBounds(b, screen.getDisplayMatching(b).workArea);
  if (next.x !== b.x || next.y !== b.y || next.width !== b.width || next.height !== b.height) {
    win.setBounds(next);
    saveLater();
  }
}

function open() {
  if (!watchingDisplays) {
    watchingDisplays = true;
    screen.on("display-removed", refitMini);
    screen.on("display-metrics-changed", refitMini);
  }
  const bounds = placeBounds(loadSaved(), screen.getAllDisplays(), screen.getPrimaryDisplay().id);
  const w = new BrowserWindow({
    ...bounds,
    ...OVERLAY_WINDOW,
    minWidth: MINI_MIN.width,
    minHeight: MINI_MIN.height,
    maxWidth: MINI_MAX.width,
    maxHeight: MINI_MAX.height,
    resizable: true,
    movable: true,
    backgroundColor: "#11151c",
    title: "EvEX-MPP mini",
    webPreferences: overlayWebPreferences(options.preload),
  });
  win = w;
  raiseOverlay(w);
  w.on("moved", saveLater);
  w.on("resized", saveLater);
  // Al cerrar y abrir seguido, el «closed» de la ventana vieja puede llegar después de crear la nueva: solo se
  // olvida la ventana si sigue siendo la actual.
  w.on("closed", () => {
    if (win !== w) return;
    clearTimeout(saveTimer);
    win = null;
    lastState = null;
    options.onChange(false);
  });
  // En Wayland (GNOME) «ready-to-show» puede no llegar nunca en una ventana oculta (como en main.js): se muestra
  // con lo primero que llegue, ese evento o la página ya cargada.
  let revealed = false;
  const reveal = () => {
    if (revealed || w.isDestroyed() || win !== w) return;
    revealed = true;
    applyLook(w);
    w.showInactive();
  };
  w.once("ready-to-show", reveal);
  w.webContents.once?.("did-finish-load", () => setTimeout(reveal, 250));
  w.loadURL("app://evex/mini.html");
  options.onChange(true);
}

function close() {
  if (!isMiniOpen()) return;
  saveBounds();
  clearTimeout(saveTimer);
  const w = win;
  win = null;
  // Al volver a abrirla no debe enseñar, ni un momento, los colores y contadores de la vez anterior.
  lastState = null;
  w.destroy();
  options.onChange(false);
}

// Se llama al arrancar y cada vez que se guardan los ajustes.
export function applyMini(settings) {
  current = { ...current, ...(settings?.mini || {}) };
  if (!current.enabled) return close();
  if (!isMiniOpen()) open();
  else applyLook();
}

export function miniIpc(handle) {
  handle("mini:update", (state) => {
    lastState = state;
    if (isMiniOpen()) win.webContents.send("mini-state", state);
  });
  handle("mini:get", () => lastState);
  // Sin marco y sin foco, Windows no da bordes para cambiar el tamaño: la página tiene un asa en la esquina.
  handle("mini:resize", (size) => {
    if (!isMiniOpen() || current.clickThrough) return;
    const b = win.getBounds();
    const next = fitBounds({ x: b.x, y: b.y, width: Number(size?.width) || b.width, height: Number(size?.height) || b.height }, screen.getDisplayMatching(b).workArea);
    win.setBounds(next);
    saveLater();
  });
  handle("mini:click", (target) => {
    if (current.clickThrough) return;
    // { show: true }: solo traer la app (no leídos); menciones o, por defecto, la vista de pings.
    if (target?.show) return options.onShow();
    options.onClick({ accountId: null, conv: "*", convType: target?.convType === "mentions" ? "mentions" : "pings" });
  });
}
