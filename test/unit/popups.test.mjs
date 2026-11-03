import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { app, Notification, BrowserWindow } from "electron";
import { systemPopups, showPopup, closeAllPopups, configurePopups } from "../../src/main/popups.js";

const saved = { platform: process.platform, env: { ...process.env } };
const setPlatform = (p) => Object.defineProperty(process, "platform", { value: p, configurable: true });

beforeEach(() => {
  for (const k of ["EVEX_POPUPS", "WAYLAND_DISPLAY", "XDG_SESSION_TYPE"]) delete process.env[k];
  delete app.testSwitches;
  Notification.supported = true;
  Notification.created.length = 0;
  BrowserWindow.created.length = 0;
});
afterEach(() => {
  setPlatform(saved.platform);
  process.env = { ...saved.env };
});

test("systemPopups: notificaciones del sistema solo en Linux con Wayland", () => {
  setPlatform("win32");
  process.env.WAYLAND_DISPLAY = "wayland-0";
  assert.equal(systemPopups(), false, "Windows siempre con la burbuja propia");

  setPlatform("linux");
  delete process.env.WAYLAND_DISPLAY;
  assert.equal(systemPopups(), false, "Linux con X11: burbuja propia");
  process.env.XDG_SESSION_TYPE = "x11";
  assert.equal(systemPopups(), false);

  process.env.XDG_SESSION_TYPE = "wayland";
  assert.equal(systemPopups(), true, "sesión Wayland");
  delete process.env.XDG_SESSION_TYPE;
  process.env.WAYLAND_DISPLAY = "wayland-0";
  assert.equal(systemPopups(), true, "WAYLAND_DISPLAY (p. ej. WSLg)");

  app.testSwitches = { "ozone-platform": "x11" };
  assert.equal(systemPopups(), false, "Electron eligió X11 (p. ej. WSLg sin XDG_SESSION_TYPE, o --ozone-platform=x11)");
  delete process.env.WAYLAND_DISPLAY;
  app.testSwitches = { "ozone-platform": "wayland" };
  assert.equal(systemPopups(), true, "Electron eligió Wayland aunque falten las variables");
  delete app.testSwitches;

  Notification.supported = false;
  assert.equal(systemPopups(), false, "sin notificaciones del sistema, la burbuja propia");
});

test("EVEX_POPUPS fuerza un modo para las pruebas", () => {
  setPlatform("win32");
  process.env.EVEX_POPUPS = "system";
  assert.equal(systemPopups(), true);
  setPlatform("linux");
  process.env.WAYLAND_DISPLAY = "wayland-0";
  process.env.EVEX_POPUPS = "custom";
  assert.equal(systemPopups(), false);
});

test("en Wayland, un aviso es una notificación del sistema que abre la conversación y se cierra con los pings", () => {
  setPlatform("linux");
  process.env.WAYLAND_DISPLAY = "wayland-0";
  const clicked = [];
  configurePopups({ pingSticky: true, onClick: (d) => clicked.push(d) });

  const ping = { kind: "ping", title: "Capital fleet up now!!", fields: [{ key: "FC Name", value: "Ejemplo FC" }, { key: "Doctrine", value: "Ferox" }] };
  const msg = { kind: "msg", title: "Ana en general", text: "hola" };
  showPopup(ping);
  showPopup(msg);
  const [pn, mn] = Notification.created;
  assert.equal(pn.shown, true);
  assert.equal(pn.options.title, "Capital fleet up now!!");
  assert.equal(pn.options.body, "FC Name: Ejemplo FC\nDoctrine: Ferox");
  assert.equal(pn.options.urgency, "critical");
  assert.equal(pn.options.timeoutType, "never", "el ping se queda si está marcado como fijo");
  assert.equal(pn.options.silent, true, "el sonido lo pone la app");
  assert.equal(mn.options.urgency, "normal");
  assert.equal(mn.options.timeoutType, "default");

  pn.handlers.click();
  assert.deepEqual(clicked, [ping]);

  closeAllPopups("ping");
  assert.equal(pn.closed, true, "al leer los pings se cierra su notificación");
  assert.ok(!mn.closed, "las de mensajes siguen");
  closeAllPopups();
  assert.equal(mn.closed, true);
});

test("si la notificación del sistema falla (sin servicio de notificaciones), sale la burbuja propia", () => {
  setPlatform("linux");
  process.env.WAYLAND_DISPLAY = "wayland-0";
  configurePopups({ pingSticky: true, onClick: () => {} });
  showPopup({ kind: "ping", title: "Ping" });
  assert.equal(BrowserWindow.created.length, 0, "primero se intenta la notificación del sistema");
  Notification.created.at(-1).handlers.failed();
  Notification.created.at(-1).handlers.failed(); // libnotify puede avisar varias veces
  assert.equal(BrowserWindow.created.length, 1, "y al fallar, la burbuja propia (una sola)");
  assert.match(BrowserWindow.created[0].url, /^app:\/\/evex\/popup\.html\?id=\d+$/);
  closeAllPopups();
});
