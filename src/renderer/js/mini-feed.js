// Datos de la mini ventana para jugar (src/main/mini-window.js): se calculan aquí, en la ventana principal, y se
// mandan al proceso principal solo si cambian. Por opsec, del ping solo van el título y el grupo, nunca el texto
// entero; el título va tal cual llega (con sus caracteres invisibles, sin tocarlos).
import { S, api, on, onMain, updateSettings } from "./state.js";
import { pingsConv, totalUnread } from "./convs.js";
import { mentionsConv } from "./mentions.js";
import { parsePing } from "./pings.js";
import { nextFormup } from "./formup.js";
import { fmtEve, fmtEveDateTime, fmtTime } from "./format.js";
import { themeColors } from "./themes.js";

const TITLE_MAX = 120;

function latest(messages) {
  let last = null;
  for (const m of messages) if (!last || m.ts >= last.ts) last = m;
  return last;
}

export function miniState(now = Date.now()) {
  const pc = pingsConv();
  const last = latest(pc.messages);
  const p = last ? parsePing(last.body) : null;
  const f = nextFormup(pc.messages, now);
  const c = themeColors();
  return {
    ping: last ? { title: String(p.title || "").slice(0, TITLE_MAX), group: p.footer?.to || "", ts: last.ts } : null,
    formup: f ? { at: f.at, title: String(parsePing(f.m.body).title || "").slice(0, TITLE_MAX), eve: fmtEve(f.at), eveDateTime: fmtEveDateTime(f.at), local: S.settings.showLocalTime !== false ? fmtTime(f.at) : null } : null,
    unread: Math.max(0, totalUnread() - pc.unread),
    pings: pc.unread,
    mentions: mentionsConv().pending || 0,
    clickThrough: !!S.settings.mini?.clickThrough,
    colors: { surface: c.surface, text: c.text, text2: c.text2, border: c.border, warn: c.warn, accent: c.accent, danger: c.danger },
  };
}

export const miniEnabled = () => !!S.settings?.mini?.enabled;

export function setMini(patch) {
  updateSettings((s) => (s.mini = { ...s.mini, ...patch }));
}
export const toggleMini = () => setMini({ enabled: !miniEnabled() });

let lastJson = "";
function push() {
  if (!miniEnabled()) return void (lastJson = "");
  const state = miniState();
  const json = JSON.stringify(state);
  if (json === lastJson) return;
  lastJson = json;
  api("mini:update", state).catch(() => {});
}

// Se llama al arrancar. La bandeja pide abrir o cerrar con «mini-toggle»: el ajuste se cambia aquí, como desde
// Preferencias, y el proceso principal abre o cierra la ventana al guardarlo.
export function initMiniFeed() {
  onMain("mini-toggle", toggleMini);
  on("message", () => setTimeout(push, 50));
  on("settings", () => {
    lastJson = "";
    setTimeout(push, 400);
  });
  setInterval(push, 2000);
  push();
}
