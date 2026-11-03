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
export class BrowserWindow {}
export const screen = {};
export default { app, safeStorage, Notification, nativeImage, BrowserWindow, screen };
