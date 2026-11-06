// Notificaciones emergentes propias: ventanitas siempre encima que suben desde la barra de tareas y se apilan.
// En Wayland se usan las notificaciones del sistema en su lugar (ver systemPopups).
import { BrowserWindow, Notification, nativeImage, screen } from "electron";
import path from "node:path";
import { renderIcon, renderAlertIcon } from "./icon.js";
import { OVERLAY_WINDOW, overlayWebPreferences, raiseOverlay, keepOnTop, waylandSession } from "./overlay.js";
import { pickDisplay, describeDisplays, isValidChoice } from "./popup-display.js";
import { t } from "./i18n.js";

const WIDTH = 380;
const MARGIN = 12;
const GAP = 10;
const MAX = 5;

let nextId = 1;
const popups = []; // el primero es el más cercano a la barra de tareas
// display: en qué pantalla salen (ver popup-display.js); displayHint: la pista para reencontrar un monitor concreto.
let options = { corner: "bottom-left", duration: 8, pingSticky: true, preload: "", onClick: () => {}, display: "primary", displayHint: null, getWin: () => null };

export function configurePopups(o) {
  options = { ...options, ...o };
  watchDisplays();
}

// ---------- pantalla ----------
// La pantalla se elige al abrir la primera burbuja de la pila y se mantiene mientras haya alguna abierta: un ping fijo
// no salta de monitor al mover el ratón. Si se desconecta, la pila pasa a la principal; si se había elegido un monitor
// concreto y vuelve, la pila vuelve a él.
let stack = null; // { id, fallback, choice }

function screenContext() {
  const win = options.getWin?.();
  const visible = win && !win.isDestroyed?.() && win.isVisible?.() && !win.isMinimized?.();
  return {
    displays: screen.getAllDisplays(),
    primary: screen.getPrimaryDisplay(),
    cursor: screen.getCursorScreenPoint(),
    windowBounds: visible ? win.getBounds() : null,
    hint: options.displayHint,
  };
}

function chooseStack(choice = options.display) {
  const { display, fallback } = pickDisplay(choice, screenContext());
  stack = display ? { id: display.id, fallback, choice } : null;
  return stack;
}

function workArea() {
  if (!stack) chooseStack();
  const displays = screen.getAllDisplays();
  const d = displays.find((x) => x.id === stack?.id) || screen.getPrimaryDisplay();
  return d.workArea;
}

// Monitores conectados, quitados o que cambian de resolución: las burbujas abiertas se recolocan.
let watching = false;
function watchDisplays() {
  if (watching || typeof screen.on !== "function") return;
  watching = true;
  const changed = () => {
    if (!popups.length || !stack) return;
    const present = screen.getAllDisplays().some((d) => d.id === stack.id);
    if (!present || (stack.fallback && String(stack.choice).startsWith("display:"))) chooseStack(stack.choice);
    layout();
  };
  for (const ev of ["display-added", "display-removed", "display-metrics-changed"]) screen.on(ev, changed);
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
// En X11 (también XWayland) la burbuja propia funciona (ver waylandSession en overlay.js). EVEX_POPUPS=custom|system
// lo fuerza.
// Si la notificación falla (no hay servicio de notificaciones), se muestra la burbuja propia como reserva.
export function systemPopups() {
  const forced = process.env.EVEX_POPUPS;
  if (forced === "custom") return false;
  if (forced !== "system" && !waylandSession()) return false;
  return Notification.isSupported();
}

const systemNotes = new Map(); // id → { note, data }

// ¿La burbuja se queda hasta cerrarla? Un ping, si así lo dice «Los pings se quedan en pantalla»; una regla, según la
// suya. Los recordatorios (el aviso antes del formup) solo obedecen a su propia opción: antes la de los pings la pisaba
// y el recordatorio se quedaba fijo aunque se hubiera desactivado.
export function isSticky(data, pingSticky = options.pingSticky) {
  if (data.reminder) return !!data.sticky;
  return !!(data.sticky || (data.kind === "ping" && pingSticky));
}

function showSystemNotification(id, data) {
  const body = [data.text, ...(data.fields || []).map((f) => `${f.key}: ${f.value}`)].filter(Boolean).join("\n");
  const ping = data.kind === "ping";
  const sticky = isSticky(data);
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
  // Sin servicio de notificaciones (p. ej. un escritorio mínimo) no se pierde el aviso: sale la burbuja propia,
  // una sola vez aunque libnotify reintente y avise de varios fallos.
  let fellBack = false;
  note.on("failed", () => {
    if (fellBack) return;
    fellBack = true;
    systemNotes.delete(id);
    showCustomPopup(id, data);
  });
  systemNotes.set(id, { note, data });
  note.show();
  return id;
}

export function showPopup(data) {
  const id = nextId++;
  if (systemPopups()) return showSystemNotification(id, data);
  return showCustomPopup(id, data);
}

function showCustomPopup(id, data) {
  // La de prueba (popup:test) ya trae su pantalla elegida.
  if (!popups.length && !stack?.pinned) chooseStack();
  const p = { id, data: { ...data, corner: options.corner }, height: 120, win: null, timer: null };
  const win = new BrowserWindow({
    width: WIDTH,
    height: p.height,
    ...OVERLAY_WINDOW,
    transparent: true,
    resizable: false,
    movable: false,
    webPreferences: overlayWebPreferences(options.preload),
  });
  raiseOverlay(win);
  // Los pings fijos pueden quedarse mucho rato: que tampoco acaben detrás de otra ventana.
  const stopKeepOnTop = keepOnTop(win);
  p.win = win;
  popups.unshift(p);
  while (popups.length > MAX) closePopup(popups[popups.length - 1].id, true);
  win.on("closed", () => {
    const i = popups.indexOf(p);
    if (i >= 0) popups.splice(i, 1);
    clearTimeout(p.timer);
    stopKeepOnTop();
    // Sin burbujas abiertas, la próxima pila vuelve a elegir pantalla.
    if (!popups.length) stack = null;
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
  const sticky = isSticky(p.data);
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
  // Para Preferencias: las pantallas conectadas y si las burbujas propias se usan (en Wayland no).
  handle("popup:displays", () => ({
    system: systemPopups(),
    displays: describeDisplays(screen.getAllDisplays(), screen.getPrimaryDisplay().id, { screen: (n) => t("Pantalla {n}", { n }), primary: t("principal") }),
  }));
  // Burbuja de prueba en la pantalla que se acaba de elegir. El valor llega de la página: solo se aceptan los conocidos.
  handle("popup:test", (choice, colors) => {
    if (!isValidChoice(choice, screen.getAllDisplays())) throw new Error("popup:test: invalid display");
    if (systemPopups()) return false;
    // Sin ninguna pantalla (no debería pasar) no hay pila que fijar: la burbuja elegirá al abrirse.
    const s = chooseStack(choice);
    if (s) s.pinned = true;
    layout();
    showPopup({ kind: "msg", title: t("Pantalla de las burbujas"), text: t("Las burbujas saldrán en esta pantalla."), colors: colors && typeof colors === "object" ? colors : undefined });
    return true;
  });
  handle("popup:hover", (id, hovering) => {
    const p = popups.find((x) => x.id === Number(id));
    if (!p) return;
    if (hovering) clearTimeout(p.timer);
    else armTimer(p);
  });
}

export const popupPreloadPath = (root) => path.join(root, "src", "preload.cjs");
