// Icono de la bandeja del sistema: menú, contador de mensajes sin leer, aviso de pings (con parpadeo) y la insignia de
// la barra de tareas.
import { Tray, Menu, nativeImage } from "electron";
import * as store from "./store.js";
import { renderIcon, renderAlertIcon } from "./icon.js";
import { closeAllPopups } from "./popups.js";
import { t } from "./i18n.js";

let tray = null;
let unread = 0;
let options = { getWin: () => null, accounts: new Map(), showWindow: () => {}, send: () => {}, quit: () => {} };

// Los iconos se dibujan píxel a píxel: se hace una vez y se reutilizan (el parpadeo de la bandeja los cambia cada 650 ms).
const iconCache = new Map();
function cachedIcon(key, make) {
  if (!iconCache.has(key)) iconCache.set(key, make());
  return iconCache.get(key);
}

function trayImage() {
  const badge = unread > 0;
  return cachedIcon(`tray:${badge}`, () => nativeImage.createFromBuffer(renderIcon(64, { badge })).resize({ width: 16, height: 16, quality: "best" }));
}

export function buildTrayMenu() {
  const setAll = (show, label) => ({
    label,
    click: () => {
      for (const a of options.accounts.values()) if (a.online) a.setPresence(show).catch(() => {});
    },
  });
  return Menu.buildFromTemplate([
    { label: t("Mostrar EvEX-MPP"), click: () => options.showWindow() },
    {
      label: t("Cambiar de cuenta…"),
      click: () => {
        options.showWindow();
        options.send("switch-account");
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
        for (const a of options.accounts.values()) a.disconnect().catch(() => {});
      },
    },
    {
      label: t("Salir"),
      click: () => {
        options.quit();
      },
    },
  ]);
}

export function createTray(o) {
  options = { ...options, ...o };
  tray = new Tray(trayImage());
  tray.setToolTip("EvEX-MPP");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => {
    const win = options.getWin();
    return win?.isVisible() && win.isFocused() ? win.hide() : options.showWindow();
  });
  tray.on("double-click", () => options.showWindow());
  tray.on("balloon-click", () => options.showWindow());
  return tray;
}

// Pings sin leer: la bandeja muestra la sirena sobre un círculo ámbar (parpadeando si está activado) hasta que se abren los pings.
let pingAlert = 0;
let blinkTimer = null;
let blinkOn = false;
const alertImage = () => cachedIcon("alert", () => nativeImage.createFromBuffer(renderAlertIcon(64)).resize({ width: 16, height: 16, quality: "best" }));

export function refreshTray() {
  if (!tray) return;
  const win = options.getWin();
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
    const overlay = pingAlert ? cachedIcon("overlay:alert", () => nativeImage.createFromBuffer(renderAlertIcon(32))) : unread ? cachedIcon("overlay:badge", () => nativeImage.createFromBuffer(renderBadge())) : null;
    win.setOverlayIcon(overlay, pingAlert ? t("Ping de flota") : unread ? t("{unread} sin leer", { unread }) : "");
  }
}

// La interfaz avisa en cada mensaje: los cambios seguidos se juntan en una sola actualización de la bandeja.
let trayRefreshTimer = null;
export function setUnread(count, pings = 0) {
  const changed = count !== unread || pings !== pingAlert;
  unread = count;
  if (pings === 0 && pingAlert) closeAllPopups("ping");
  // El primer ping se ve al momento; el resto de cambios espera un poco por si llegan más.
  const urgent = pings > 0 && !pingAlert;
  pingAlert = pings;
  if (!changed) return;
  clearTimeout(trayRefreshTimer);
  if (urgent) refreshTray();
  else trayRefreshTimer = setTimeout(refreshTray, 150);
}

function renderBadge() {
  return renderIcon(32, { badge: true, accent: "#ef4444", accent2: "#dc2626" });
}
