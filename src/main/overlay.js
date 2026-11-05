// Ventanas propias que van siempre encima sin coger el foco: las burbujas (popups.js) y la mini ventana para jugar
// (mini-window.js). Robar el foco o hacer parpadear la barra de tareas puede sacar a un juego de pantalla completa.
import { app } from "electron";

export const OVERLAY_WINDOW = {
  show: false,
  frame: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  skipTaskbar: true,
  focusable: false,
  alwaysOnTop: true,
  hasShadow: false,
};

export const overlayWebPreferences = (preload) => ({ preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false });

// «screen-saver» queda por encima de juegos en ventana sin bordes y de la barra de tareas.
export function raiseOverlay(win) {
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces?.(true);
}

// ¿Sesión Wayland? Ahí una aplicación no puede elegir la posición de sus ventanas ni ponerlas por encima de las
// demás. Electron deja en el interruptor ozone-platform la plataforma que eligió («x11» o «wayland»; p. ej. WSLg da
// x11 porque no define XDG_SESSION_TYPE). Si no lo indica, se mira la sesión (WAYLAND_DISPLAY o XDG_SESSION_TYPE).
export function waylandSession() {
  if (process.platform !== "linux") return false;
  const ozone = app.commandLine.getSwitchValue("ozone-platform");
  if (ozone === "x11") return false;
  return ozone === "wayland" || !!process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland";
}
