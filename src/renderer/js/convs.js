// Conversaciones abiertas: pestañas, entrada de mensajes, no leídos, menciones, notificaciones y pings.
import { S, api, emit, convKey, account, roomState, displayName, saveSettings, PINGS_KEY, MENTIONS_KEY, conn } from "./state.js";
import { mentionsConv, loadMentions, addMention, markMentionsSeen, markRoomMentionsSeen } from "./mentions.js";
import { considerRoomMessage } from "./fleet-suggest.js";
import { trimSpaces, hasVisible, cutChars } from "./invisible.js";
import { mentionRegex, fmtTime, fmtEve } from "./format.js";
import { playSound, playRuleSound, startPingRepeat } from "./sounds.js";
import { matchRule, ruleLabel } from "./keywords.js";
import { toast } from "./dom.js";
import { parsePing, markPingsSeen } from "./pings.js";
import { themeColors } from "./themes.js";
import { replaceShortcodes } from "./emoji.js";

import { t } from "./i18n.js";
import { speakPing } from "./tts.js";
import { effectiveLevel, shouldAlert, badgeCount } from "./notify-rules.js";
import { dndNow } from "./dnd.js";
export function getConv(accountId, conv, type) {
  const key = convKey(accountId, conv);
  let c = S.convs.get(key);
  if (!c) {
    c = { key, accountId, conv, type: type || "chat", messages: [], keys: new Set(), unread: 0, mentions: 0, mentionHits: 0, loaded: false, typing: new Map(), draft: "", firstUnreadKey: null, exhausted: false };
    S.convs.set(key, c);
  }
  if (type && c.type !== type && type !== "headline") c.type = type;
  return c;
}

export function pingsConv() {
  let c = S.convs.get(PINGS_KEY);
  if (!c) {
    c = { key: PINGS_KEY, accountId: null, conv: "*", type: "pings", messages: [], keys: new Set(), unread: 0, mentions: 0, loaded: false, typing: new Map() };
    S.convs.set(PINGS_KEY, c);
  }
  return c;
}

// Una entrada sin dominio («pingbot») vale para cualquier servidor.
export function isPingSender(jid) {
  const j = String(jid).toLowerCase();
  return S.settings.pingSenders.some((s) => {
    s = s.toLowerCase();
    return s.includes("@") ? s === j : s === j.split("@")[0];
  });
}

export function convTitle(c) {
  if (c.type === "pings") return t("Pings de flota");
  if (c.type === "mentions") return t("Menciones");
  const name = displayName(c.accountId, c.conv);
  // Si la misma sala o contacto está abierto con otra cuenta, se añade el nombre de la cuenta.
  const clash = S.tabs.some((k) => {
    const o = S.convs.get(k);
    return o && o !== c && o.accountId && o.accountId !== c.accountId && o.conv === c.conv;
  });
  return clash ? `${name} · ${account(c.accountId)?.alias || ""}` : name;
}

function persistTabs() {
  S.settings.openTabs = S.tabs
    .map((k) => S.convs.get(k))
    .filter(Boolean)
    .map((c) => ({ accountId: c.accountId, conv: c.conv, type: c.type }));
  saveSettings();
}

export async function loadHistory(c, more = false) {
  if (c.type === "pings") return loadPings(c);
  if (c.type === "mentions") return loadMentions(c);
  if (c.exhausted && more) return 0;
  const before = more && c.messages.length ? c.messages[0].ts : undefined;
  const entries = await api("logs:tail", c.accountId, c.conv, 150, before);
  const msgs = entries.filter((e) => !c.keys.has(e.key)).map((e) => fromLog(c, e));
  for (const m of msgs) c.keys.add(m.key);
  c.messages = mergeSorted(msgs.filter((m) => !m.editOf), c.messages);
  for (const m of msgs.filter((m) => m.editOf)) applyEdit(c, m);
  if (entries.length < 150) c.exhausted = true;
  c.loaded = true;
  emit("history", { conv: c, prepended: more ? msgs.length : 0 });
  return msgs.length;
}

async function loadPings(c) {
  const all = [];
  for (const acc of S.accounts) {
    const convs = (await api("logs:list", acc.id).catch(() => [])).map((x) => x.conv).filter(isPingSender);
    for (const sender of convs) {
      const entries = await api("logs:tail", acc.id, sender, 300).catch(() => []);
      all.push(...entries.map((e) => ({ ...fromLog({ accountId: acc.id, conv: sender, type: "chat" }, e), accountId: acc.id, conv: sender })));
    }
  }
  const fresh = all.filter((m) => !c.keys.has(m.key) && !m.out && !m.editOf && !m.fc);
  for (const m of fresh) c.keys.add(m.key);
  c.messages = mergeSorted(fresh, c.messages);
  c.loaded = true;
  emit("history", { conv: c });
}

function mergeSorted(a, b) {
  return [...a, ...b].sort((x, y) => x.ts - y.ts);
}

function fromLog(c, e) {
  return {
    key: e.key,
    id: e.id || "",
    ts: e.ts,
    nick: e.nick,
    body: e.body,
    out: !!e.out,
    sys: !!e.sys,
    jid: e.jid || "",
    editOf: e.rep || "",
    ...(e.fc ? { fc: true } : {}),
    history: true,
  };
}

function applyEdit(c, m) {
  const target = [...c.messages].reverse().find((x) => x.id === m.editOf && x.nick === m.nick);
  if (!target) return false;
  target.body = m.body;
  target.edited = true;
  return target;
}

export async function openConv(accountId, conv, type, { focus = true, join = true, password } = {}) {
  const c = type === "pings" ? pingsConv() : type === "mentions" ? mentionsConv() : getConv(accountId, conv, type);
  if (!S.tabs.includes(c.key)) {
    S.tabs.push(c.key);
    persistTabs();
  }
  if (c.type === "groupchat" && join) {
    const r = roomState(accountId, conv);
    if (!r.joined && !r.joining && conn(accountId).state === "online") {
      r.joining = true;
      r.error = "";
      api("room:join", accountId, conv, null, password).catch((e) => {
        r.joining = false;
        toast(t("No se pudo entrar en {conv}: {message}", { conv, message: e.message }), { kind: "error" });
      });
    }
  }
  if (!c.loaded) await loadHistory(c).catch(console.error);
  emit("tabs");
  if (focus) activate(c.key);
  return c;
}

// Cerrar la app estando en la vista de pings también cuenta como haberlos visto.
window.addEventListener("beforeunload", () => {
  if (S.active === PINGS_KEY) markPingsSeen();
  if (S.active === MENTIONS_KEY) markMentionsSeen();
});

export function activate(key) {
  if (!S.convs.has(key)) return;
  // Al salir de la vista de pings, los que había ya cuentan como vistos (modo «hasta volver a abrirlos»).
  if (S.active === PINGS_KEY && key !== PINGS_KEY) markPingsSeen();
  // Igual con la bandeja de menciones: al salir, lo que había pasa a visto.
  if (S.active === MENTIONS_KEY && key !== MENTIONS_KEY) markMentionsSeen();
  S.active = key;
  markRead(key);
  emit("active", S.convs.get(key));
  emit("tabs");
}

export function closeConv(key, { leave = true } = {}) {
  const c = S.convs.get(key);
  const i = S.tabs.indexOf(key);
  if (i >= 0) S.tabs.splice(i, 1);
  if (c?.type === "groupchat" && leave) {
    api("room:leave", c.accountId, c.conv).catch(() => {});
    const r = roomState(c.accountId, c.conv);
    r.joined = false;
    r.joining = false;
    r.occupants.clear();
  }
  if (S.active === key) {
    S.active = S.tabs[Math.min(i, S.tabs.length - 1)] || null;
    if (S.active) markRead(S.active);
  }
  persistTabs();
  emit("tabs");
  emit("active", S.active ? S.convs.get(S.active) : null);
  emit("sidebar");
}

export function moveTab(from, to) {
  const [k] = S.tabs.splice(from, 1);
  S.tabs.splice(to, 0, k);
  persistTabs();
  emit("tabs");
}

export function markRead(key) {
  const c = S.convs.get(key);
  if (!c) return;
  // Lo que ya has visto en la sala deja de estar pendiente en la bandeja de menciones.
  if (c.type === "groupchat") markRoomMentionsSeen(c.accountId, c.conv);
  if (c.unread || c.mentions || c.mentionHits) {
    c.unread = 0;
    c.mentions = 0;
    c.mentionHits = 0;
    emit("sidebar");
    emit("tabs");
    updateBadge();
  }
}

// Lo que cuenta en la barra de tareas: cada conversación según su nivel de aviso («Nada» no cuenta).
export function totalUnread() {
  let n = 0;
  for (const c of S.convs.values()) n += convBadge(c).count;
  return n;
}

// Número de la pestaña y de la barra lateral: { count, mention, level }. mention: se pinta en rojo.
// En los chats privados c.mentions cuenta todos los mensajes (cada privado es como una mención); para «solo menciones»
// se usa c.mentionHits, las menciones reales sin leer (tu nombre, una palabra clave o una regla).
export function convBadge(c) {
  const level = notifyMode(c);
  const isChat = c.type === "chat";
  const mentions = isChat && level === "mentions" ? c.mentionHits || 0 : c.mentions;
  const count = badgeCount(level, { unread: c.unread, mentions });
  return { count, mention: level !== "none" && count > 0 && (isChat || mentions > 0), level };
}

export function updateBadge() {
  api("window:unread", totalUnread(), pingsConv().unread).catch(() => {});
}

// Colores del tema actual para las burbujas de notificación.
function popupColors() {
  const c = themeColors();
  return { surface: c.surface, text: c.text, border: c.border, warn: c.warn, "theme-accent": c.accent };
}

// Horas para la burbuja, respetando qué horas quiere ver el usuario.
function popupTime(ts, seconds) {
  const local = S.settings.showLocalTime !== false ? fmtTime(ts) : null;
  const eve = S.settings.showEveTime !== false ? fmtEve(ts, seconds) : null;
  return local || eve ? { local, eve } : null;
}

// Nivel de aviso de una sala o un chat: "all", "mentions" o "none" (notify-rules.js). Se elige por conversación en
// roomModes (clave de la conversación; vale también para los chats privados) o, en las salas, en su marcador.
export function notifyMode(c) {
  const n = S.settings.notifications;
  const room = c.type === "groupchat" ? account(c.accountId)?.rooms.find((r) => r.jid === c.conv) : null;
  return effectiveLevel(c.type, n.roomModes[c.key] || room?.notify, n);
}

export function mentionWords(c) {
  const acc = account(c.accountId);
  const words = [...(S.settings.notifications.keywords || [])];
  if (acc) words.push(acc.nick, acc.alias, acc.jid.split("@")[0]);
  if (c.type === "groupchat") words.push(roomState(c.accountId, c.conv).nick);
  return [...new Set(words.filter(Boolean))];
}

// ---------- entrada de mensajes ----------

export function ingestMessage(ev) {
  const type = ev.convType === "groupchat" ? "groupchat" : "chat";
  const c = getConv(ev.accountId, ev.conv, type);
  const key = ev.key || `${ev.id}|${ev.ts}`;
  if (c.keys.has(key)) return;
  c.keys.add(key);

  if (ev.replaces) {
    const target = applyEdit(c, { editOf: ev.replaces, nick: ev.nick, body: ev.body });
    if (target) {
      emit("message-updated", { conv: c, msg: target });
      return;
    }
  }

  const msg = {
    key,
    id: ev.id,
    ts: ev.ts,
    nick: ev.nick,
    body: ev.body,
    out: !!ev.outgoing,
    sys: !!ev.system,
    jid: ev.fromJid || "",
    delayed: !!ev.delayed,
    oob: ev.oob || "",
    subject: ev.subject || "",
    ...(ev.fcReply ? { fc: true } : {}),
  };
  // La respuesta de un bot de pings a un envío del Modo FC va a su chat privado, como un mensaje normal.
  const asPing = isPingSender(ev.conv) && !ev.fcReply;
  const mre = mentionRegex(mentionWords(c));
  if (mre) mre.lastIndex = 0;
  msg.mention = !msg.out && !msg.sys && !!mre && mre.test(msg.body);
  // Una regla por palabra clave puede contar como mención y decide el sonido y la burbuja del aviso.
  const rule = !msg.out && !msg.sys ? matchRule(msg.body, asPing ? "pings" : type === "chat" ? "private" : "rooms") : null;
  if (rule && rule.notify !== "never" && type === "groupchat") msg.mention = true;

  // Los pings van a la pestaña «Pings de flota», no a un chat privado con el bot.
  if (asPing && !msg.out) {
    c.messages.push(msg);
    emit("message", { conv: c, msg });
    const pc = pingsConv();
    if (pc.keys.has(key)) return;
    pc.keys.add(key);
    const pm = { ...msg, accountId: c.accountId, conv: c.conv };
    pc.messages.push(pm);
    if (!S.tabs.includes(PINGS_KEY)) {
      S.tabs.push(PINGS_KEY);
      persistTabs();
    }
    if (!msg.delayed || Date.now() - msg.ts < 3600e3) {
      if (S.active !== PINGS_KEY || !S.focused) pc.unread++;
      notifyPing(pm, rule);
    }
    emit("message", { conv: pc, msg: pm });
    emit("tabs");
    emit("sidebar");
    updateBadge();
    return;
  }

  if (!c.loaded && !S.tabs.includes(c.key) && type === "chat" && !msg.out) {
    // Primer mensaje de una conversación privada: abrir pestaña sin robar el foco.
    openConv(c.accountId, c.conv, "chat", { focus: !S.active });
  } else if (type === "chat" && !S.tabs.includes(c.key) && !msg.out) {
    S.tabs.push(c.key);
    persistTabs();
    emit("tabs");
  }

  c.messages.push(msg);
  // Tope de memoria por conversación, salvo mientras se están leyendo los antiguos (chat.js marca c.reading).
  if (c.messages.length > 3000 && !c.reading) c.messages.splice(0, c.messages.length - 2500);
  if (c.typing.delete(msg.nick) || (type === "chat" && c.typing.size)) {
    if (type === "chat") c.typing.clear();
    emit("typing", { key: c.key });
  }
  emit("message", { conv: c, msg });
  // Las menciones y palabras clave de las salas también van a la bandeja de menciones.
  if (type === "groupchat") addMention(c.accountId, c.conv, msg, { visible: S.active === c.key && S.focused });
  // Y las horas de flota que se lean en ellos, como sugeridas del calendario (nunca entran solas).
  if (type === "groupchat") considerRoomMessage(c.accountId, c.conv, msg, { roomName: convTitle(c) });

  if (msg.out || msg.sys) {
    if (msg.out && S.active === c.key) markRead(c.key);
    return;
  }
  const visible = S.active === c.key && S.focused;
  const fresh = !msg.delayed || Date.now() - msg.ts < 120e3;
  if (!visible && fresh) {
    if (!c.unread) c.firstUnreadKey = key;
    c.unread++;
    if (msg.mention || type === "chat") c.mentions++;
    // Menciones reales sin leer: también las de una regla por palabra clave en un chat privado.
    if (msg.mention || (rule && rule.notify !== "never")) c.mentionHits = (c.mentionHits || 0) + 1;
    emit("sidebar");
    emit("tabs");
    updateBadge();
  }
  if (fresh && !visible) maybeNotify(c, msg, rule);
}

// Etiqueta, color y permanencia de la burbuja cuando el aviso viene de una regla.
function ruleExtras(rule) {
  return rule && rule.notify !== "never" ? { tag: ruleLabel(rule), accent: rule.color, sticky: rule.sticky } : {};
}

function maybeNotify(c, msg, rule) {
  const n = S.settings.notifications;
  const forced = rule && rule.notify !== "never";
  const should = shouldAlert({ type: c.type, level: notifyMode(c), chosen: n.roomModes[c.key] || "default", mention: msg.mention, rule, n, dnd: dndNow(), presenceDnd: conn(c.accountId).show === "dnd" });
  if (!should) return;
  const kind = c.type === "chat" ? "private" : msg.mention ? "mention" : "room";
  // Si avisa es porque shouldAlert ya lo ha permitido (también con «No molestar» y menciones permitidas).
  if (forced) playRuleSound(rule, kind, { dndOk: true });
  else playSound(kind, { dndOk: true });
  const title = c.type === "groupchat" ? t("{nick} en {room}", { nick: msg.nick, room: convTitle(c) }) : convTitle(c);
  api("notify", {
    ...ruleExtras(rule),
    kind: "msg",
    title,
    text: n.showPreview ? replaceShortcodes(msg.body).slice(0, 240) : t("Nuevo mensaje"),
    accountId: c.accountId,
    conv: c.conv,
    convType: c.type,
    time: popupTime(msg.ts),
    colors: popupColors(),
  }).catch(() => {});
}

// Alguien nos llama la atención (/buzz, XEP-0224): línea en la conversación, sonido de privado y aviso,
// salvo con «No molestar» o las notificaciones desactivadas.
export function notifyAttention(c, nick) {
  systemMessage(c, t("{nick} te está llamando la atención.", { nick }), { icon: "bell-ring" });
  const n = S.settings.notifications;
  if (!n.enabled || dndNow().active || conn(c.accountId).show === "dnd" || notifyMode(c) === "none") return;
  playSound("private");
  api("notify", {
    kind: "msg",
    title: convTitle(c),
    text: t("{nick} te está llamando la atención.", { nick }),
    accountId: c.accountId,
    conv: c.conv,
    convType: c.type,
    time: popupTime(Date.now()),
    colors: popupColors(),
  }).catch(() => {});
}

function notifyPing(m, rule) {
  // La lectura en voz alta tiene sus propios ajustes (Preferencias → Pings de flota): no depende de las notificaciones.
  speakPing(m);
  const n = S.settings.notifications;
  const forced = rule && rule.notify !== "never";
  if (!n.enabled || !(n.pings || (forced && rule.notify === "always"))) return;
  if (forced) playRuleSound(rule, "ping");
  else playSound("ping");
  startPingRepeat();
  // La burbuja muestra el ping ya desglosado: título, campos (FC, formup, doctrina…) y quién lo envía.
  // El texto va tal cual, con sus caracteres invisibles (marcas de agua de algunas alianzas): solo se quitan espacios.
  const p = parsePing(m.body);
  const title = trimSpaces(p.title);
  api("notify", {
    ...ruleExtras(rule),
    kind: "ping",
    title: hasVisible(title) ? cutChars(title, 120) : t("Ping de flota"),
    text: p.fields.length ? cutChars(trimSpaces(p.extra.join("\n")), 300) : cutChars(trimSpaces(m.body), 400),
    fields: p.fields.slice(0, 8).map((f) => ({ key: f.key, value: cutChars(trimSpaces(f.value), 140) })),
    footer: p.footer ? t("de {from} → {to}", { from: p.footer.from, to: p.footer.to }) : m.nick,
    accountId: null,
    conv: "*",
    convType: "pings",
    time: popupTime(m.ts, true),
    colors: popupColors(),
  }).catch(() => {});
}

export function systemMessage(c, body, extra = {}) {
  const msg = { key: `sys|${Date.now()}|${Math.random()}`, ts: Date.now(), nick: "", body, sys: true, local: true, ...extra };
  c.messages.push(msg);
  emit("message", { conv: c, msg });
}
