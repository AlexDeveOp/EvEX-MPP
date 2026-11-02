// Sustituto mínimo de "electron" para los tests: solo lo que los módulos usan al cargarse o en las funciones probadas.
export const app = { getLocale: () => "es-ES", getPath: () => process.cwd(), isPackaged: false };
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
};
export default { app, safeStorage };
