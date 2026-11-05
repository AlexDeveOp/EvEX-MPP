// Icono de la bandeja del sistema: menú, contador de mensajes sin leer, aviso de pings (con parpadeo) y la insignia de
// la barra de tareas.
import { Tray, Menu, nativeImage } from "electron";
import * as store from "./store.js";
import { renderIcon, renderAlertIcon } from "./icon.js";
import { closeAllPopups } from "./popups.js";
import { t } from "./i18n.js";

let tray = null;
let unread = 0;
// «No molestar» de la app, tal como lo calcula la ventana (manual o por horario): { active, label }.
let dnd = { active: false, label: "" };
let options = { getWin: () => null, accounts: new Map(), showWindow: () => {}, send: () => {}, quit: () => {} };

// Los iconos se dibujan píxel a píxel: se hace una vez y se reutilizan (el parpadeo de la bandeja los cambia cada 650 ms).
const iconCache = new Map();
function cachedIcon(key, make) {
  if (!iconCache.has(key)) iconCache.set(key, make());
  return iconCache.get(key);
}

// Qué enseña la bandeja: el icono (normal o la sirena de pings), el punto rojo de sin leer, la campana tachada de
// «No molestar» (abajo a la derecha, compatible con los otros dos) y el texto al pasar el ratón.
export function trayLook({ unread: n = 0, pings = 0, dnd: d = { active: false, label: "" } } = {}) {
  const muted = !!d.active;
  const base = pings ? t("¡{pingAlert} ping{x} de flota sin leer!", { pingAlert: pings, x: pings > 1 ? "s" : "" }) : n ? t("EvEX-MPP — {unread} sin leer", { unread: n }) : "EvEX-MPP";
  return { kind: pings ? "alert" : "normal", badge: n > 0, muted, tooltip: muted ? `${base} · ${d.label || t("No molestar")}` : base };
}

function trayImage() {
  const { badge, muted } = trayLook({ unread, dnd });
  return cachedIcon(`tray:${badge}:${muted}`, () => nativeImage.createFromBuffer(renderIcon(64, { badge, muted })).resize({ width: 16, height: 16, quality: "best" }));
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
    // Silencia los avisos de la app sin cambiar el estado XMPP; los pings de flota siguen sonando.
    {
      label: dnd.active ? dnd.label : t("No molestar en la app (silenciar avisos)"),
      type: "checkbox",
      checked: dnd.active,
      // El menú marca la casilla solo al pulsarla: se rehace con el estado real hasta que la ventana lo confirme con
      // setTrayDnd (si aún no ha arrancado, el clic no cambia nada y la casilla no debe quedar marcada).
      click: () => {
        options.send("dnd-toggle");
        getTray()?.setContextMenu(buildTrayMenu());
      },
    },
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

function makeTray() {
  const t = new Tray(trayImage());
  t.setToolTip("EvEX-MPP");
  t.setContextMenu(buildTrayMenu());
  t.on("click", () => {
    const win = options.getWin();
    return win?.isVisible() && win.isFocused() ? win.hide() : options.showWindow();
  });
  t.on("double-click", () => options.showWindow());
  t.on("balloon-click", () => options.showWindow());
  return t;
}

export function createTray(o) {
  options = { ...options, ...o };
  tray = makeTray();
  // Linux (GNOME, extensión AppIndicator): Chromium registra el icono antes de publicar IconName/IconThemePath. Si
  // la extensión pide las propiedades (GetAll) en ese hueco, no ve el icono y no lo vuelve a pedir nunca: se queda
  // con «cargando» («…»). Pasa sobre todo con la app aún ocupada arrancando (AppImage). Recrear la bandeja con la app
  // ya libre la registra de nuevo y la extensión vuelve a leerlo todo.
  if (process.platform === "linux") {
    setTimeout(() => {
      if (!tray || tray.isDestroyed()) return;
      tray.destroy();
      tray = makeTray();
      refreshTray();
    }, 3000);
  }
  return tray;
}

// La ventana avisa cuando «No molestar» cambia (también al empezar o acabar el horario): se rehace el menú.
export function setTrayDnd(state) {
  dnd = { active: !!state?.active, label: String(state?.label || "") };
  getTray()?.setContextMenu(buildTrayMenu());
  // El icono lleva la campana tachada mientras está activo, y el texto al pasar el ratón dice hasta cuándo.
  refreshTray();
}

// El objeto de la bandeja puede cambiar (ver createTray): quien lo use debe pedirlo aquí cada vez.
export const getTray = () => (tray && !tray.isDestroyed() ? tray : null);

// Pings sin leer: la bandeja muestra la sirena sobre un círculo ámbar (parpadeando si está activado) hasta que se abren los pings.
let pingAlert = 0;
let blinkTimer = null;
let blinkOn = false;
const alertImage = () => {
  const muted = !!dnd.active;
  return cachedIcon(`alert:${muted}`, () => nativeImage.createFromBuffer(renderAlertIcon(64, undefined, undefined, { muted })).resize({ width: 16, height: 16, quality: "best" }));
};

export function refreshTray() {
  if (!tray) return;
  const win = options.getWin();
  if (process.env.EVEX_DEBUG) console.log(`[bandeja] sin leer=${unread} pings=${pingAlert}`);
  clearInterval(blinkTimer);
  blinkTimer = null;
  const look = trayLook({ unread, pings: pingAlert, dnd });
  if (pingAlert) {
    tray.setImage(alertImage());
    tray.setToolTip(look.tooltip);
    if (store.get().settings.notifications.trayBlink) {
      blinkOn = true;
      blinkTimer = setInterval(() => {
        blinkOn = !blinkOn;
        tray.setImage(blinkOn ? alertImage() : trayImage());
      }, 650);
    }
  } else {
    tray.setImage(trayImage());
    tray.setToolTip(look.tooltip);
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
