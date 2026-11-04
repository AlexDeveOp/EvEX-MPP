// Puente seguro entre la interfaz y el proceso principal. Solo expone canales concretos.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

const CHANNELS = [
  "init", "ready", "settings:set",
  "account:save", "account:delete", "account:connect", "account:disconnect", "account:snapshot", "network:online",
  "proxy:password", "proxy:test",
  "presence:set", "msg:send", "chatstate:send",
  "room:join", "room:leave", "room:list", "room:info", "room:nick", "room:subject", "room:moderate", "room:invite", "room:affiliations", "room:config-get", "room:config-set", "xmpp:ping", "msg:attention", "disco:items",
  "rooms:update", "rooms:pushBookmarks", "rooms:fetchBookmarks",
  "room:services",
  "roster:add", "roster:remove", "roster:update", "roster:answer",
  "logs:tail", "logs:search", "logs:list",
  "pidgin:scan", "pidgin:import", "pidgin:repairLogs", "pidgin:repairStatus", "pidgin:repairOffered", "sounds:pidginScan", "sounds:pidginImport", "gifs:search", "gifs:save", "gifs:remove",
  "file:pick", "image:importPath", "image:importBytes", "image:importUrl", "emoji:import", "theme:export", "theme:import", "avatar:set", "fonts:list",
  "notify", "notify:test", "popup:get", "popup:size", "popup:click", "popup:close", "popup:hover", "window:unread", "window:minimize", "window:maximize", "window:close", "window:focus", "shell:open", "shell:openUserData", "updates:check", "pings:sync", "app:quit",
];
const EVENTS = ["xmpp", "accounts", "nav", "window-focus", "window-maximized", "import-progress", "switch-account", "popup-close", "update-available", "gif-save", "pings-recovered"];

contextBridge.exposeInMainWorld("evex", {
  // Ruta de un archivo arrastrado desde el Explorador (para importarlo como imagen de fondo).
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || "";
    } catch {
      return "";
    }
  },
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
