// Ventanas propias que van siempre encima sin coger el foco: las burbujas (popups.js) y la mini ventana para jugar
// (mini-window.js). Robar el foco o hacer parpadear la barra de tareas puede sacar a un juego de pantalla completa.
import { app, powerMonitor, screen } from "electron";

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

// En Windows, una ventana «siempre encima» puede dejar de estarlo: Windows le quita el bit en algunos casos (al
// reanudar, al desbloquear, al cambiar las pantallas…) y otra ventana «siempre encima» que se sube después queda por
// encima. keepOnTop vuelve a ponerla arriba en esos eventos y, por si acaso, cada KEEP_ON_TOP_MS. setAlwaysOnTop hace
// SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE): no coge el foco ni hace parpadear la barra de tareas. Un intervalo de
// segundos evita un tira y afloja con otra ventana que también se suba sola (el Administrador de tareas). Solo en
// Windows (en Wayland no se puede y en X11 no se ha visto el problema) y solo con la ventana visible.
// Devuelve la función que lo para (llamarla al cerrar la ventana); si se olvida, se para sola en cuanto ve la ventana
// destruida.
export const KEEP_ON_TOP_MS = 10e3;
const KEEP_EVENTS = [
  [powerMonitor, "resume"],
  [powerMonitor, "unlock-screen"],
  [screen, "display-added"],
  [screen, "display-removed"],
  [screen, "display-metrics-changed"],
];
export function keepOnTop(win, { interval = KEEP_ON_TOP_MS } = {}) {
  if (!win || process.platform !== "win32" || waylandSession()) return () => {};
  let stop = () => {};
  const reassert = () => {
    if (win.isDestroyed()) return stop();
    if (!win.isVisible()) return;
    raiseOverlay(win);
  };
  const timer = setInterval(reassert, interval);
  timer.unref?.();
  for (const [source, event] of KEEP_EVENTS) source?.on?.(event, reassert);
  let stopped = false;
  stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    for (const [source, event] of KEEP_EVENTS) source?.removeListener?.(event, reassert);
  };
  return stop;
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
