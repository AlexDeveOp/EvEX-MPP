// Sustituto mínimo de "electron" para los tests: solo lo que los módulos usan al cargarse o en las funciones probadas.
// getPath usa app.testUserData si un test lo pone (p. ej. una carpeta temporal para config.json).
export const app = { getLocale: () => "es-ES", getPath: () => app.testUserData || process.cwd(), isPackaged: false };
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
};
export default { app, safeStorage };
