// Puente seguro entre la interfaz y el proceso principal. Solo expone canales concretos.
const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = [
  "init", "ready", "settings:set",
  "account:save", "account:delete", "account:connect", "account:disconnect", "account:snapshot",
  "presence:set", "msg:send", "chatstate:send",
  "room:join", "room:leave", "room:list", "room:info", "room:nick", "room:subject", "room:moderate", "room:invite", "disco:items",
  "rooms:update", "rooms:pushBookmarks", "rooms:fetchBookmarks",
  "roster:add", "roster:remove", "roster:update", "roster:answer",
  "logs:tail", "logs:search", "logs:list",
  "pidgin:scan", "pidgin:import",
  "file:pick", "emoji:import", "theme:export", "theme:import", "avatar:set", "fonts:list",
  "notify", "notify:test", "popup:get", "popup:size", "popup:click", "popup:close", "popup:hover", "window:unread", "window:titlebar", "window:focus", "shell:open", "shell:openUserData", "app:quit",
];
const EVENTS = ["xmpp", "accounts", "nav", "window-focus", "import-progress", "switch-account", "popup-close"];

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
