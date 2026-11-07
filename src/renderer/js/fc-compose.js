// Modo FC: lógica de la ventana «Enviar ping» sin DOM (hora del formup, grupos de la barra «Para», la petición para
// fc:send, el modo web y el resumen de resultados). La ventana está en fc-window.js.
//
// El texto del ping va TAL CUAL: aquí no se recorta ni se le quitan los invisibles al texto que se envía.
import { renderTemplate, isConfirmed } from "./fc-send.js";
import { groupRows, groupUsable, learnedGroups, sameGroup } from "./fc-groups.js";
import { trimSpaces, hasVisible } from "./invisible.js";

// ---------- hora del formup (EVE = UTC) ----------

const pad = (n) => String(n).padStart(2, "0");
export const eveHM = (ts) => {
  const d = new Date(ts);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

// «19:00», «19.00», «1900» o «9:5» → { h, m }; si no es una hora, null.
export function parseHM(s) {
  const m = String(s ?? "").trim().match(/^(\d{1,2})(?:[:.h]?(\d{2}))?$/) || String(s ?? "").trim().match(/^(\d{1,2})[:.](\d{1,2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  return h < 24 && min < 60 ? { h, m: min } : null;
}

// La próxima vez que sean esas horas EVE. Si ya han pasado hace más de 15 min, es mañana (un ping a las 23:50 para
// las 00:10 es de mañana; uno a las 19:05 para las 19:00 sigue siendo de hoy, «formup ya»).
export function formupAt(hm, now = Date.now()) {
  const t = typeof hm === "string" ? parseHM(hm) : hm;
  if (!t) return null;
  const d = new Date(now);
  let at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), t.h, t.m);
  if (at < now - 15 * 60e3) at += 86400e3;
  return at;
}

// Botones Ya / +15 / +30 / +1 h: la hora EVE de dentro de N minutos, redondeada al minuto de arriba.
export const QUICK_TIMES = [0, 15, 30, 60];
export const hmIn = (minutes, now = Date.now()) => eveHM(Math.ceil((now + minutes * 60e3) / 60e3) * 60e3);

// ---------- plantilla ----------

// Campo de Preferencias → marcador del formato del texto.
export const FIELD_KEYS = { type: "tipo", fc: "fc", time: "hora", place: "lugar", doctrine: "doctrina", comms: "comms", pap: "pap", notes: "notas" };
export const FLEET_TYPES = ["Strat op", "CTA", "Roam", "Home defense", "Mining op"];

// Valores para renderTemplate: todos los marcadores conocidos, vacíos los de los campos quitados en Preferencias (así
// renderTemplate quita su trozo o su línea). Solo se quitan los espacios normales de los extremos.
export function templateValues(values = {}, enabled = Object.keys(FIELD_KEYS)) {
  const out = {};
  for (const [id, key] of Object.entries(FIELD_KEYS)) out[key] = enabled.includes(id) ? trimSpaces(values[id] ?? "") : "";
  return out;
}

export const templateText = (format, values, enabled) => renderTemplate(format, templateValues(values, enabled));

// ---------- grupos de la barra «Para» ----------

// Los que salen como botón, en el orden de Preferencias.
export function barGroups(fc, pingMessages = []) {
  return groupRows(fc.groups, learnedGroups(pingMessages)).filter((r) => groupUsable(r, fc.groupMode));
}

// Al abrir: el de serie, si sale como botón.
export function initialGroups(groups, defaultGroup) {
  const g = defaultGroup && groups.find((x) => sameGroup(x.name, defaultGroup));
  return g ? [g.name] : [];
}

// ---------- envío ----------

// Cuenta con la que se envía: la del canal del bot; si no hay o ya no existe, la única que haya.
export function sendAccount(fc, accounts = []) {
  const a = accounts.find((x) => x.id === fc.channel?.accountId);
  if (a) return a;
  return accounts.length === 1 ? accounts[0] : null;
}

// Por qué no se puede enviar todavía (una clave; la ventana la traduce), o null si se puede.
// isOnline(accountId): si la cuenta está conectada (en el modo web no hace falta ninguna).
export function sendBlocker(fc, { text, groups, accounts, isOnline = () => true }) {
  if (!hasVisible(text)) return "empty";
  if (!groups.length) return "no-groups";
  if (fc.groupMode === "web") return webUrlOk(fc.webUrl) ? null : "no-url";
  const acc = sendAccount(fc, accounts);
  if (!acc) return "no-account";
  if (fc.groupMode === "line" && !fc.channel?.jid) return "no-channel";
  if (!isOnline(acc.id)) return "offline";
  return null;
}

// Petición para api("fc:send", accountId, req). groups: filas de barGroups elegidas.
export function buildRequest(fc, groups, text) {
  const req = {
    mode: fc.groupMode,
    groups: groups.map((g) => ({ name: g.name, address: g.address || "" })),
    linePrefix: fc.lineFormat,
    botJid: fc.channel?.jid || "",
    botNick: fc.botNick || "",
    channelType: fc.channel?.kind === "groupchat" ? "groupchat" : "chat",
    text,
  };
  if (fc.sentPattern) req.sentPattern = fc.sentPattern;
  if (fc.rejectedPattern) req.rejectedPattern = fc.rejectedPattern;
  return req;
}

// Modo web: no se envía nada; el resultado es «copiado» para cada grupo, nunca «enviado».
export const webResults = (groups) => groups.map((g) => ({ group: g.name, status: "copied", reason: "", reply: null, echo: false }));

// Varios grupos a la vez: un ping por grupo, así que quien esté en varios lo recibe varias veces. Aviso "multi" (por
// Jabber) o "multi-web" (en la web se eligen todos allí); null con uno solo.
export const multiGroupWarning = (mode, n) => (n > 1 ? (mode === "web" ? "multi-web" : "multi") : null);
// ¿Se pide confirmación? Con varios grupos, también si solo está activado «Avisar antes de enviar a más de un grupo».
// Si no la hay, el aviso de varios grupos sale en el resultado.
export const needsConfirm = (fc, n) => !!fc.confirm || (!!fc.confirmMulti && n > 1);

// ---------- resultado ----------

// Tono de cada estado. Lo que no se conoce, como «sin confirmar»: nunca cuenta como enviado.
// "error": la app no ha podido ni intentarlo (p. ej. se ha caído la conexión); lo pone la ventana, no el bot.
export const STATUS_TONES = { sent: "ok", delivered: "ok-soft", accepted: "neutral", rejected: "error", error: "error", unconfirmed: "warn", copied: "info" };
export const statusTone = (status) => STATUS_TONES[status] || "warn";

export function summarize(results = []) {
  const total = results.length;
  const sent = results.filter((r) => isConfirmed(r.status)).length;
  const rejected = results.filter((r) => r.status === "rejected" || r.status === "error").length;
  const copied = results.filter((r) => r.status === "copied").length;
  return { total, sent, rejected, copied, allSent: total > 0 && sent === total };
}

// ---------- caracteres invisibles (solo para marcarlos en el editor) ----------

const INVISIBLE_NAMES = { 0x200b: "ZWSP", 0x200c: "ZWNJ", 0x200d: "ZWJ", 0x2060: "WJ", 0xfeff: "BOM" };
export const invisibleName = (ch) => INVISIBLE_NAMES[ch.codePointAt(0)] || null;

// Trozos del texto: [{ text, inv }]; cada invisible va en su propio trozo con su nombre. Unidos dan el texto exacto.
export function invisibleRuns(text) {
  const out = [];
  let cur = "";
  for (const ch of String(text ?? "")) {
    const name = invisibleName(ch);
    if (!name) {
      cur += ch;
      continue;
    }
    if (cur) out.push({ text: cur, inv: null });
    cur = "";
    out.push({ text: ch, inv: name });
  }
  if (cur) out.push({ text: cur, inv: null });
  return out;
}

export const countInvisible = (text) => invisibleRuns(text).filter((r) => r.inv).length;

// ---------- modo web ----------

// Solo http y https (como safeWebUrl en store.js): la dirección se abre en el navegador.
export function webUrlOk(s) {
  try {
    return ["http:", "https:"].includes(new URL(String(s ?? "").trim()).protocol);
  } catch {
    return false;
  }
}
