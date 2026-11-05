import { EventEmitter } from "node:events";

// Sustituto mínimo de "electron" para los tests: solo lo que los módulos usan al cargarse o en las funciones probadas.
// getPath usa app.testUserData si un test lo pone (p. ej. una carpeta temporal para config.json).
// app.commandLine.getSwitchValue lee app.testSwitches (p. ej. { "ozone-platform": "x11" }).
export const app = {
  getLocale: () => "es-ES",
  getPath: () => app.testUserData || process.cwd(),
  isPackaged: false,
  commandLine: { getSwitchValue: (k) => app.testSwitches?.[k] || "" },
};
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
};
// Notificaciones del sistema: guarda las creadas en Notification.created para que los tests las revisen.
export class Notification {
  static supported = true;
  static created = [];
  static isSupported() {
    return Notification.supported;
  }
  constructor(options) {
    this.options = options;
    this.handlers = {};
    Notification.created.push(this);
  }
  on(event, fn) {
    this.handlers[event] = fn;
  }
  show() {
    this.shown = true;
  }
  close() {
    this.closed = true;
    this.handlers.close?.();
  }
}
// Las imágenes recuerdan de qué bytes salen y a qué tamaño se pidieron; las de varias escalas (la bandeja) guardan
// cada representación que se les añade.
export const nativeImage = {
  createFromBuffer: (buffer) => ({ buffer, resize: (size) => ({ buffer, size }) }),
  createEmpty: () => ({
    representations: [],
    addRepresentation(rep) {
      this.representations.push(rep);
    },
    getScaleFactors() {
      return this.representations.map((r) => r.scaleFactor);
    },
  }),
};
// Bandeja: guarda lo que se le pide (Tray.created) y deja disparar sus eventos con emit().
export class Tray {
  static created = [];
  constructor(image) {
    this.image = image;
    this.images = [image];
    this.handlers = {};
    this.destroyed = false;
    Tray.created.push(this);
  }
  setImage(image) {
    this.image = image;
    this.images.push(image);
  }
  setToolTip(text) {
    this.tooltip = text;
  }
  setContextMenu(menu) {
    this.menu = menu;
  }
  displayBalloon(opts) {
    this.balloon = opts;
  }
  on(event, fn) {
    this.handlers[event] = fn;
  }
  emit(event) {
    return this.handlers[event]?.();
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
  }
}
export const Menu = { buildFromTemplate: (items) => ({ items }) };
// Ventanas sin pantalla: guardan lo que se les pide para que los tests lo revisen (BrowserWindow.created).
export class BrowserWindow {
  static created = [];
  constructor(options) {
    this.options = options;
    this.handlers = {};
    this.destroyed = false;
    // executeJavaScript responde con BrowserWindow.executeResult(código) si un test lo pone.
    this.webContents = { send: () => {}, executeJavaScript: async (code) => BrowserWindow.executeResult?.(code) };
    BrowserWindow.created.push(this);
  }
  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
  setBounds(b) {
    this.bounds = b;
  }
  on(event, fn) {
    this.handlers[event] = fn;
  }
  once(event, fn) {
    this.handlers[event] = fn;
  }
  loadURL(url) {
    this.url = url;
  }
  showInactive() {
    this.shown = true;
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
    this.handlers.closed?.();
  }
}
// Pantallas: una de 1920×1080 salvo que un test ponga screen.testDisplays (la principal lleva primary: true) y
// screen.testCursor. screen.emit(evento) dispara display-added/removed/metrics-changed.
const ONE_DISPLAY = [{ id: 1, primary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 }];
export const screen = {
  testDisplays: null,
  testCursor: null,
  listeners: {},
  displays: () => screen.testDisplays || ONE_DISPLAY,
  getAllDisplays: () => screen.displays(),
  getPrimaryDisplay: () => screen.displays().find((d) => d.primary) || screen.displays()[0],
  getCursorScreenPoint: () => screen.testCursor || { x: 0, y: 0 },
  getDisplayNearestPoint: () => screen.getPrimaryDisplay(),
  on(event, fn) {
    (screen.listeners[event] ||= []).push(fn);
  },
  emit(event) {
    for (const fn of screen.listeners[event] || []) fn();
  },
};
// Sesiones: guardan el filtro de webRequest.onBeforeRequest para que los tests comprueben qué se deja pasar.
const partitions = new Map();
export const session = {
  fromPartition: (name) => {
    if (!partitions.has(name)) partitions.set(name, { name, webRequest: { onBeforeRequest(fn) { this.filter = fn; } } });
    return partitions.get(name);
  },
};
export const dialog = {};
// Red de Chromium: cada net.request se guarda en net.requests y, al terminarla (end), la contesta net.onRequest(req)
// si un test lo pone. La respuesta la simula el test emitiendo «response», «login» o «error».
class ClientRequest extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.headers = {};
    this.aborted = false;
  }
  setHeader(name, value) {
    this.headers[name] = value;
  }
  abort() {
    this.aborted = true;
  }
  end() {
    this.ended = true;
    queueMicrotask(() => net.onRequest?.(this));
  }
}
export const net = {
  requests: [],
  onRequest: null,
  request(options) {
    const req = new ClientRequest(options);
    net.requests.push(req);
    return req;
  },
};
export default { app, safeStorage, Notification, nativeImage, Tray, Menu, BrowserWindow, screen, session, dialog, net };
