// Se carga antes de los tests (node --import): permite importar los módulos de la app fuera de Electron.
// - "electron" se resuelve a un módulo simulado (test/unit/electron-stub.mjs).
// - Los módulos de la interfaz solo tocan document, localStorage y navigator al cargarse; aquí se simulan esos mínimos.
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      const stub = ${JSON.stringify(new URL("./electron-stub.mjs", import.meta.url).href)};
      export async function resolve(specifier, context, next) {
        if (specifier === "electron") return { url: stub, shortCircuit: true };
        return next(specifier, context);
      }
    `),
);

const noop = () => {};
globalThis.window ??= { addEventListener: noop, evex: { call: async () => null, on: noop } };
globalThis.document ??= {
  documentElement: { lang: "", style: { setProperty: noop } },
  addEventListener: noop,
  createElement: () => ({ style: {}, append: noop, setAttribute: noop, classList: { add: noop } }),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};
// Se reemplaza siempre: Node 25 trae un localStorage propio que no funciona sin --localstorage-file.
const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
});
// Los textos originales están en español: los tests usan ese idioma salvo que pidan otro.
localStorage.setItem("evex.lang", "es");
