// Puente de la mini ventana para jugar (src/main/mini-window.js): una ventana siempre encima solo necesita leer sus
// datos, pedir que se abra la app y cambiar su tamaño. Nada de ajustes, archivos, enlaces ni salir.
const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = ["mini:get", "mini:click", "mini:resize"];
const EVENTS = ["mini-state"];

contextBridge.exposeInMainWorld("evex", {
  async call(channel, ...args) {
    if (!CHANNELS.includes(channel)) throw new Error(`Canal no permitido: ${channel}`);
    const r = await ipcRenderer.invoke(channel, ...args);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  },
  on(event, fn) {
    if (!EVENTS.includes(event)) throw new Error(`Evento no permitido: ${event}`);
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
