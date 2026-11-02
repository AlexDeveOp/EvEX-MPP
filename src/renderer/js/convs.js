// Conversaciones abiertas: pestañas, entrada de mensajes, no leídos, menciones, notificaciones y pings.
import { S, api, emit, convKey, account, roomState, displayName, saveSettings, PINGS_KEY, conn } from "./state.js";
import { mentionRegex, fmtTime, fmtEve } from "./format.js";
import { playSound } from "./sounds.js";
import { toast } from "./dom.js";
import { parsePing } from "./pings.js";
import { themeColors } from "./themes.js";
import { replaceShortcodes } from "./emoji.js";

export function getConv(accountId, conv, type) {
  const key = convKey(accountId, conv);
  let c = S.convs.get(key);
  if (!c) {
    c = { key, accountId, conv, type: type || "chat", messages: [], keys: new Set(), unread: 0, mentions: 0, loaded: false, typing: new Map(), draft: "", firstUnreadKey: null, exhausted: false };
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
  if (c.type === "pings") return "Pings de flota";
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
  const fresh = all.filter((m) => !c.keys.has(m.key) && !m.out && !m.editOf);
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
  const c = type === "pings" ? pingsConv() : getConv(accountId, conv, type);
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
        toast(`No se pudo entrar en ${conv}: ${e.message}`, { kind: "error" });
      });
    }
  }
  if (!c.loaded) await loadHistory(c).catch(console.error);
  emit("tabs");
  if (focus) activate(c.key);
  return c;
}

export function activate(key) {
  if (!S.convs.has(key)) return;
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
  if (c.unread || c.mentions) {
    c.unread = 0;
    c.mentions = 0;
    emit("sidebar");
    emit("tabs");
    updateBadge();
  }
}

export function totalUnread() {
  let n = 0;
  for (const c of S.convs.values()) {
    const mode = notifyMode(c);
    if (c.type === "groupchat" && mode !== "all") n += c.mentions;
    else n += c.unread;
  }
  return n;
}

export function updateBadge() {
  api("window:unread", totalUnread(), pingsConv().unread).catch(() => {});
}

// Colores del tema actual para las burbujas de notificación.
function popupColors() {
  const t = themeColors();
  return { surface: t.surface, text: t.text, border: t.border, warn: t.warn, "theme-accent": t.accent };
}

// Horas para la burbuja, respetando qué horas quiere ver el usuario.
function popupTime(ts, seconds) {
  const local = S.settings.showLocalTime !== false ? fmtTime(ts) : null;
  const eve = S.settings.showEveTime !== false ? fmtEve(ts, seconds) : null;
  return local || eve ? { local, eve } : null;
}

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

export function notifyMode(c) {
  if (c.type !== "groupchat") return "all";
  const room = account(c.accountId)?.rooms.find((r) => r.jid === c.conv);
  const m = S.settings.notifications.roomModes[c.key] || (room?.notify !== "default" ? room?.notify : null);
  if (m) return m;
  return S.settings.notifications.allRoomMessages ? "all" : "mentions";
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
  };
  const mre = mentionRegex(mentionWords(c));
  msg.mention = !msg.out && !msg.sys && !!mre && mre.test(msg.body);

  // Los pings van a la pestaña «Pings de flota», no a un chat privado con el bot.
  if (isPingSender(ev.conv) && !msg.out) {
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
      notifyPing(pm);
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
  if (c.messages.length > 3000) c.messages.splice(0, c.messages.length - 2500);
  if (c.typing.delete(msg.nick) || (type === "chat" && c.typing.size)) {
    if (type === "chat") c.typing.clear();
    emit("typing", { key: c.key });
  }
  emit("message", { conv: c, msg });

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
    emit("sidebar");
    emit("tabs");
    updateBadge();
  }
  if (fresh && !visible) maybeNotify(c, msg);
}

function maybeNotify(c, msg) {
  const n = S.settings.notifications;
  if (!n.enabled || n.dnd || conn(c.accountId).show === "dnd") return;
  const mode = notifyMode(c);
  let should = false;
  if (c.type === "chat") should = n.privateMessages;
  else if (mode === "all") should = true;
  else if (mode === "mentions") should = msg.mention && n.mentions;
  if (!should) return;
  playSound(c.type === "chat" ? "private" : msg.mention ? "mention" : "room");
  const title = c.type === "groupchat" ? `${msg.nick} en ${convTitle(c)}` : convTitle(c);
  api("notify", {
    kind: "msg",
    title,
    text: n.showPreview ? replaceShortcodes(msg.body).slice(0, 240) : "Nuevo mensaje",
    accountId: c.accountId,
    conv: c.conv,
    convType: c.type,
    time: popupTime(msg.ts),
    colors: popupColors(),
  }).catch(() => {});
}

function notifyPing(m) {
  const n = S.settings.notifications;
  if (!n.enabled || !n.pings) return;
  playSound("ping");
  // La burbuja muestra el ping ya desglosado: título, campos (FC, formup, doctrina…) y quién lo envía.
  const p = parsePing(m.body);
  const clean = (s) => s.replace(INVISIBLE, "").trim();
  api("notify", {
    kind: "ping",
    title: clean(p.title).slice(0, 120) || "Ping de flota",
    text: p.fields.length ? clean(p.extra.join("\n")).slice(0, 300) : clean(m.body).slice(0, 400),
    fields: p.fields.slice(0, 8).map((f) => ({ key: f.key, value: clean(f.value).slice(0, 140) })),
    footer: p.footer ? `de ${p.footer.from} → ${p.footer.to}` : m.nick,
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
