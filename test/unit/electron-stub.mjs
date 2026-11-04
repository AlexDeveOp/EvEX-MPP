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
export const nativeImage = { createFromBuffer: (buffer) => ({ buffer }) };
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
export const screen = {
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
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
export default { app, safeStorage, Notification, nativeImage, BrowserWindow, screen, session, dialog };
