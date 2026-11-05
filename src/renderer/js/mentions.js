// Bandeja de menciones: los mensajes de cualquier sala que te nombran (tu nick, alias o palabras de aviso) o que
// coinciden con una regla por palabra clave. Se llena con el historial local y se actualiza con cada mensaje.
import { S, api, emit, account, roomState, roomsOf, displayName, nickColor, MENTIONS_KEY } from "./state.js";
import { h, icon, iconButton } from "./dom.js";
import { mentionRegex, formatBody, fmtDateTime, fmtEve, fmtTimes, timeAgo } from "./format.js";
import { matchRule, highlightRules, ruleLabel } from "./keywords.js";
import { t } from "./i18n.js";
import { considerRoomMessage } from "./fleet-suggest.js";

// Límites del historial que se repasa al abrir la app: las salas con actividad reciente y sus últimos mensajes.
// Las salas grandes (600+ mensajes) solo se leen desde el final del fichero (logs:tail).
export const HISTORY_DAYS = 30;
export const HISTORY_ROOMS = 40;
export const HISTORY_PER_ROOM = 1000;
// Entradas que se guardan en memoria y que se pintan con un filtro.
export const MAX_ITEMS = 600;
export const MAX_SHOWN = 300;

export function mentionsConv() {
  let c = S.convs.get(MENTIONS_KEY);
  if (!c) {
    c = { key: MENTIONS_KEY, accountId: null, conv: "*", type: "mentions", messages: [], keys: new Set(), unread: 0, mentions: 0, pending: 0, loaded: false, typing: new Map() };
    S.convs.set(MENTIONS_KEY, c);
  }
  return c;
}

// Palabras que cuentan como mención en una sala: las de aviso de Preferencias, el nick, alias y usuario de la cuenta y
// el nick con el que estás en la sala (también el guardado en favoritas, para el historial de salas en las que no estás).
export function mentionWordsFor(accountId, room, type = "groupchat") {
  const acc = account(accountId);
  const words = [...(S.settings?.notifications?.keywords || [])];
  if (acc) words.push(acc.nick, acc.alias, acc.jid.split("@")[0]);
  if (type === "groupchat") {
    words.push(roomState(accountId, room).nick);
    words.push(acc?.rooms?.find((r) => r.jid === room)?.nick);
  }
  return [...new Set(words.filter(Boolean))];
}

function ownNick(accountId, room) {
  const acc = account(accountId);
  return String(roomState(accountId, room).nick || acc?.rooms?.find((r) => r.jid === room)?.nick || acc?.nick || "").toLowerCase();
}

// ¿Va a la bandeja este mensaje de una sala? Devuelve { mention, rule } o null. Tus propios mensajes, los del sistema
// y las correcciones no cuentan.
export function mentionMatch(accountId, room, m) {
  if (!m?.body || m.out || m.sys || m.editOf || m.rep) return null;
  if (m.nick && m.nick.toLowerCase() === ownNick(accountId, room)) return null;
  const re = mentionRegex(mentionWordsFor(accountId, room));
  let mention = false;
  if (re) {
    re.lastIndex = 0;
    mention = re.test(m.body);
  }
  const rule = matchRule(m.body, "rooms");
  return mention || rule ? { mention, rule } : null;
}

function toItem(accountId, room, m, match) {
  return {
    key: m.key,
    accountId,
    room,
    ts: m.ts,
    nick: m.nick || "",
    body: m.body,
    mention: match.mention,
    ruleId: match.rule?.id || "",
  };
}

// ---------- vistas ----------
// «Vistas» como en los pings: lo anterior a la última vez que se salió de la bandeja (o se pulsó «Marcar todo como
// visto») ya no cuenta, y tampoco lo que ya leíste en su sala. Las claves sueltas se guardan para el reinicio.

const SEEN_AT = "evex.mentionsSeenAt";
const SEEN_KEYS = "evex.mentionsSeen";
let seenAt = 0;
let seenKeys = null;

function loadSeen() {
  if (seenKeys) return;
  seenKeys = new Set();
  try {
    seenAt = Number(localStorage.getItem(SEEN_AT)) || 0;
    for (const k of JSON.parse(localStorage.getItem(SEEN_KEYS) || "[]")) seenKeys.add(k);
  } catch {}
  // Perfil nuevo: lo de antes no cuenta como nuevo (si no, la primera vez saldría todo el historial sin leer).
  if (!seenAt) saveSeenAt(Date.now());
}

function saveSeenAt(ts) {
  seenAt = ts;
  try {
    localStorage.setItem(SEEN_AT, String(ts));
  } catch {}
}

function saveSeenKeys() {
  try {
    localStorage.setItem(SEEN_KEYS, JSON.stringify([...seenKeys].slice(-500)));
  } catch {}
}

export function isUnseen(item) {
  loadSeen();
  return item.ts > seenAt && !seenKeys.has(item.key);
}

function recount(c = mentionsConv()) {
  let n = 0;
  for (const it of c.messages) if (isUnseen(it)) n++;
  if (n === c.pending) return false;
  c.pending = n;
  emit("sidebar");
  emit("tabs");
  return true;
}

// Todo lo que hay en la bandeja pasa a visto: al salir de ella, con «Marcar todo como visto» o al cerrar la app.
export function markMentionsSeen(ts = Date.now()) {
  loadSeen();
  saveSeenAt(Math.max(ts, seenAt));
  seenKeys.clear();
  saveSeenKeys();
  return recount();
}

// Lo que ya se ha visto en su sala no queda pendiente en la bandeja.
export function markRoomMentionsSeen(accountId, room) {
  const c = S.convs.get(MENTIONS_KEY);
  if (!c?.messages.length) return false;
  loadSeen();
  let changed = false;
  for (const it of c.messages) {
    if (it.accountId === accountId && it.room === room && isUnseen(it)) {
      seenKeys.add(it.key);
      changed = true;
    }
  }
  if (!changed) return false;
  saveSeenKeys();
  return recount(c);
}

// ---------- entrada ----------

function insert(c, items) {
  const fresh = items.filter((it) => it.key && !c.keys.has(it.key));
  if (!fresh.length) return [];
  for (const it of fresh) c.keys.add(it.key);
  c.messages.push(...fresh);
  c.messages.sort((a, b) => a.ts - b.ts);
  if (c.messages.length > MAX_ITEMS) {
    for (const old of c.messages.splice(0, c.messages.length - MAX_ITEMS)) c.keys.delete(old.key);
  }
  return fresh.filter((it) => c.keys.has(it.key));
}

// Un mensaje nuevo de una sala (convs.js). visible: la sala está delante y la ventana tiene el foco, así que ya se ha visto.
export function addMention(accountId, room, m, { visible = false } = {}) {
  const match = mentionMatch(accountId, room, m);
  if (!match) return null;
  const c = mentionsConv();
  const [item] = insert(c, [toItem(accountId, room, m, match)]);
  if (!item) return null;
  if (visible) {
    loadSeen();
    seenKeys.add(item.key);
    saveSeenKeys();
  }
  recount(c);
  emit("message", { conv: c, msg: item });
  return item;
}

// Salas con historial guardado: las favoritas, las abiertas y las que parecen salas por su dirección.
export function isRoomLog(accountId, conv) {
  if (!conv || conv.includes("/")) return false;
  if (account(accountId)?.rooms?.some((r) => r.jid === conv)) return true;
  if (roomsOf(accountId).has(conv)) return true;
  return /@(conference|muc|chat|rooms?)\./i.test(conv);
}

let loading = null;
// Repasa el historial local. Se llama al iniciar (para el contador) y al abrir la bandeja; solo se hace una vez.
export function loadMentions(c = mentionsConv()) {
  if (c.loaded) return Promise.resolve(0);
  loading ||= scanHistory(c).finally(() => (loading = null));
  return loading;
}

async function scanHistory(c, now = Date.now()) {
  const found = [];
  for (const acc of S.accounts) {
    const files = (await api("logs:list", acc.id).catch(() => [])) || [];
    const rooms = files
      .filter((f) => now - (f.mtime || 0) < HISTORY_DAYS * 86400e3 && isRoomLog(acc.id, f.conv))
      .slice(0, HISTORY_ROOMS)
      .map((f) => f.conv);
    // De pocas en pocas, para no llenar el proceso principal de lecturas a la vez.
    for (let i = 0; i < rooms.length; i += 6) {
      const batch = await Promise.all(rooms.slice(i, i + 6).map((room) => api("logs:tail", acc.id, room, HISTORY_PER_ROOM).then((entries) => ({ room, entries }), () => ({ room, entries: [] }))));
      for (const { room, entries } of batch) {
        for (const e of entries || []) {
          const m = { key: e.key, ts: e.ts, nick: e.nick, body: e.body, out: !!e.out, sys: !!e.sys, rep: e.rep };
          const match = mentionMatch(acc.id, room, m);
          if (match) found.push(toItem(acc.id, room, m, match));
          // Mismo repaso para las flotas sugeridas del calendario: así no se leen dos veces los mismos ficheros.
          considerRoomMessage(acc.id, room, m, { roomName: displayName(acc.id, room) });
        }
      }
    }
  }
  const added = insert(c, found);
  c.loaded = true;
  recount(c);
  emit("history", { conv: c });
  return added.length;
}

// ¿Se ve la entrada «Menciones» en la barra lateral? Oculta por defecto: sale con menciones sin ver, mientras su
// pestaña esté abierta y siempre si se activa «Mostrar siempre la bandeja de menciones». La recogida sigue igual.
export function showMentionsEntry({ always = S.settings?.notifications?.alwaysShowMentions, pending = mentionsConv().pending, open = S.tabs.includes(MENTIONS_KEY), active = S.active === MENTIONS_KEY } = {}) {
  return !!(always || pending > 0 || open || active);
}

// ---------- filtro ----------

export function mentionRooms(items) {
  const seen = new Map();
  for (const it of items) seen.set(`${it.accountId}|${it.room}`, { accountId: it.accountId, room: it.room });
  return [...seen.values()].sort((a, b) => displayName(a.accountId, a.room).localeCompare(displayName(b.accountId, b.room)));
}

// filter: { query, room } — room es «cuenta|sala» o "" para todas.
export function mentionFilterMatches(it, filter = {}) {
  if (filter.room && `${it.accountId}|${it.room}` !== filter.room) return false;
  const q = String(filter.query || "").trim().toLowerCase();
  if (!q) return true;
  return it.body.toLowerCase().includes(q) || it.nick.toLowerCase().includes(q) || displayName(it.accountId, it.room).toLowerCase().includes(q);
}

// De la más reciente a la más antigua.
export function visibleMentions(items, filter, limit = MAX_SHOWN) {
  const out = [];
  for (let i = items.length - 1; i >= 0 && out.length < limit; i--) if (mentionFilterMatches(items[i], filter)) out.push(items[i]);
  return out;
}

// ---------- tarjetas y cabecera ----------

function ruleOf(it) {
  if (!it.ruleId) return null;
  return matchRule(it.body, "rooms");
}

// onOpen(item): saltar al mensaje en su sala (lo pone chat.js).
export function mentionCard(it, onOpen) {
  const rule = ruleOf(it);
  const multi = S.accounts.length > 1;
  const words = mentionWordsFor(it.accountId, it.room);
  const card = h(
    "article",
    {
      class: `mention-card ${isUnseen(it) ? "unseen" : ""} ${rule ? "kw" : ""}`,
      dataset: { key: it.key, ts: String(it.ts) },
      style: rule ? { "--kw": rule.color } : null,
      tabindex: "0",
      role: "button",
      title: t("Ir al mensaje en {room}", { room: displayName(it.accountId, it.room) }),
      onclick: (e) => {
        if (e.target.closest("a, button")) return;
        onOpen(it);
      },
      onkeydown: (e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onOpen(it);
      },
    },
    h(
      "header",
      { class: "mention-head" },
      icon("hash", "mention-icon"),
      h("span", { class: "mention-room" }, displayName(it.accountId, it.room)),
      multi ? h("span", { class: "mention-acc muted" }, account(it.accountId)?.alias || "") : null,
      h("span", { class: "mention-nick", style: { color: nickColor(it.nick) } }, it.nick),
      rule ? h("span", { class: "kw-tag", title: t("Regla por palabra clave") }, ruleLabel(rule)) : null,
      h("time", { class: "mention-ago", title: fmtTimes(it.ts) }, timeAgo(it.ts)),
    ),
    h("div", { class: "mention-body msg-body", html: formatBody(it.body, { mentionWords: words, rules: highlightRules("rooms") }).html }),
    h(
      "footer",
      { class: "mention-foot" },
      S.settings.showLocalTime !== false ? h("span", { class: "muted" }, t("{time} local", { time: fmtDateTime(it.ts) })) : null,
      S.settings.showEveTime !== false ? h("span", { class: "eve" }, t("{eve} EVE", { eve: fmtEve(it.ts) })) : null,
      h("span", { class: "mention-go" }, icon("chevron-right"), t("Ir al mensaje")),
    ),
  );
  return card;
}

// Controles de la cabecera de la bandeja. rerender() repinta la lista con el filtro nuevo.
export function mentionsHeader(c, filter, rerender) {
  const rooms = mentionRooms(c.messages);
  return [
    h("div", { class: "conv-avatar mentions" }, icon("at-sign")),
    h(
      "div",
      { class: "conv-title" },
      h("h1", {}, t("Menciones")),
      h("div", { class: "conv-sub" }, !c.loaded ? t("Buscando en el historial…") : t("{n} mensajes que te mencionan o coinciden con tus palabras clave · {rooms} salas", { n: c.messages.length, rooms: rooms.length })),
    ),
    h("input", {
      class: "input small",
      placeholder: t("Filtrar menciones…"),
      value: filter.query,
      oninput: (e) => {
        filter.query = e.target.value;
        rerender(false);
      },
    }),
    h(
      "select",
      {
        class: "input small",
        onchange: (e) => {
          filter.room = e.target.value;
          rerender(false);
        },
      },
      h("option", { value: "" }, t("Todas las salas")),
      rooms.map((r) => {
        const v = `${r.accountId}|${r.room}`;
        const name = displayName(r.accountId, r.room) + (S.accounts.length > 1 ? ` · ${account(r.accountId)?.alias || ""}` : "");
        return h("option", { value: v, selected: v === filter.room }, name);
      }),
    ),
    iconButton(
      "check-check",
      c.pending ? t("Marcar todo como visto ({n})", { n: c.pending }) : t("Marcar todo como visto"),
      () => {
        markMentionsSeen();
        rerender(true);
      },
      c.pending ? "on" : "",
    ),
  ];
}
