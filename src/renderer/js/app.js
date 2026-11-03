// Arranque de la interfaz y traducción de eventos XMPP al estado local.
import { S, api, onMain, emit, on, conn, account, contact, rosterOf, roomState, convKey, displayName, PINGS_KEY } from "./state.js";
import { h, icon, $, toast, modal, prompt, clear } from "./dom.js";
import { applyAppearance } from "./themes.js";
import { initChat, markReceipt, focusComposer } from "./chat.js";
import { initSidebar } from "./sidebar.js";
import { initOccupants } from "./occupants.js";
import { ingestMessage, openConv, closeConv, activate, getConv, systemMessage, markRead, updateBadge, pingsConv } from "./convs.js";
import { showRecoveredPings } from "./ping-recovery.js";
import { openSettings } from "./settings.js";
import { openAccounts, openPidginImport, connectWithPrompt, openSwitchAccount } from "./accounts.js";
import { openRoomBrowser, openJoinRoom } from "./rooms.js";
import { openSearch } from "./search.js";
import { showUpdate } from "./updates.js";
import { offerPidginRepair } from "./pidgin-repair.js";
import { playSound, stopPingRepeat } from "./sounds.js";

import { t, setLanguagePreference, translateStatic } from "./i18n.js";
async function boot() {
  const init = await api("init");
  // Si el idioma elegido no es el que se está mostrando (p. ej. primera vez tras cambiarlo), recargar una vez.
  if (setLanguagePreference(init.settings.language)) return location.reload();
  translateStatic();
  // Textos que pone el CSS (content:) también se traducen.
  document.documentElement.style.setProperty("--history-label", JSON.stringify(` · ${t("historial")}`));
  S.accounts = init.accounts;
  S.settings = init.settings;
  S.version = init.version;
  S.focused = init.focused;
  applyAppearance();

  for (const [hash, file] of Object.entries(init.avatars || {})) S.avatars.set(hash, `media://evex/avatars/${file}`);
  for (const [id, snap] of Object.entries(init.states)) applySnapshot(id, snap);

  onMain("xmpp", handleEvent);
  onMain("accounts", (list) => {
    S.accounts = list;
    emit("accounts");
  });
  onMain("nav", ({ accountId, conv, convType }) => {
    if (convType === "pings") openConv(null, "*", "pings");
    else openConv(accountId, conv, convType);
  });
  onMain("switch-account", openSwitchAccount);
  onMain("update-available", showUpdate);
  onMain("pings-recovered", (ev) => showRecoveredPings(ev?.count).catch(console.error));
  onMain("window-focus", (f) => {
    S.focused = f;
    if (f) stopPingRepeat();
    if (f && S.active) markRead(S.active);
  });

  initSidebar();
  initChat();
  initOccupants();
  bindTitlebar();
  renderWelcome();
  on("accounts", renderWelcome);
  on("imported", renderWelcome);
  on("settings", () => applyAppearance());

  await restoreTabs();
  bindShortcuts();
  // A partir de aquí el proceso principal entrega los eventos que llegaron durante la carga.
  await api("ready");
  pingsConv();
  document.getElementById("app").classList.remove("booting");
  setTimeout(() => offerPidginRepair().catch(console.error), 1500);
}

function applySnapshot(id, snap) {
  const st = conn(id);
  Object.assign(st, { state: snap.state, show: snap.show || "", statusText: snap.statusText || "", jid: snap.jid, server: snap.server || null });
  for (const item of snap.roster || []) Object.assign(contact(id, item.jid), item, { inRoster: true });
  for (const p of snap.presences || []) {
    contact(id, p.jid).resources.set(p.resource, { show: p.show, status: p.status, priority: p.priority });
    if (p.avatar) S.avatarOf.set(p.jid, p.avatar);
  }
  if (snap.avatarHash) {
    const acc = account(id);
    if (acc) S.avatarOf.set(acc.jid, snap.avatarHash);
  }
  for (const r of snap.rooms || []) {
    const rs = roomState(id, r.jid);
    Object.assign(rs, { joined: r.joined, nick: r.nick, subject: r.subject });
    rs.occupants = new Map(r.occupants.map((o) => [o.nick, o]));
  }
}

async function restoreTabs() {
  const s = S.settings;
  if (!s.behavior.restoreOpenTabs) return;
  const lastActive = localStorage.getItem("evex.activeTab");
  for (const tab of s.openTabs || []) {
    if (tab.type === "pings") await openConv(null, "*", "pings", { focus: false });
    else if (account(tab.accountId)) {
      // Una sala sin ⚡ no se vuelve a abrir al iniciar, aunque su pestaña quedara abierta.
      if (tab.type === "groupchat" && !account(tab.accountId).rooms.some((r) => r.jid === tab.conv && r.autojoin)) continue;
      await openConv(tab.accountId, tab.conv, tab.type, { focus: false, join: false });
    }
  }
  if (lastActive && S.tabs.includes(lastActive)) activate(lastActive);
  else if (S.tabs.length) activate(S.tabs[0]);
}

on("active", (c) => {
  try {
    if (c) localStorage.setItem("evex.activeTab", c.key);
  } catch {}
});

// ---------- eventos XMPP ----------

function handleEvent(ev) {
  const id = ev.accountId;
  const fn = HANDLERS[ev.type];
  if (fn) fn(id, ev);
}

const HANDLERS = {
  // Qué ofrece el servidor: copias entre clientes (XEP-0280) y archivo de mensajes (XEP-0313).
  "server-info"(id, ev) {
    conn(id).server = { carbons: !!ev.carbons, mam: !!ev.mam };
  },
  status(id, ev) {
    const st = conn(id);
    const was = st.state;
    Object.assign(st, { state: ev.state, error: ev.error, show: ev.show ?? st.show, statusText: ev.statusText ?? st.statusText });
    if (ev.state !== "online") {
      for (const c of rosterOf(id).values()) c.resources.clear();
      for (const [jid, r] of S.rooms[id] || []) {
        if (r.joined || r.joining) {
          r.joined = false;
          r.joining = ev.state === "reconnecting" || ev.state === "connecting";
          r.occupants.clear();
          emit("room", { accountId: id, room: jid });
        }
      }
      emit("presence", { accountId: id });
    }
    // Sonidos de conexión: perdida (caída o error inesperado) y recuperada tras una caída.
    if (was === "online" && (ev.state === "reconnecting" || ev.state === "error")) {
      st.dropped = true;
      playSound("disconnected");
    }
    if (ev.state === "online" && was !== "online") {
      st.onlineAt = Date.now();
      if (st.dropped) playSound("reconnected");
      st.dropped = false;
    }
    if (ev.state === "offline") st.dropped = false;
    if (ev.state === "error" && was !== "error") toast(`${account(id)?.alias}: ${ev.error}`, { kind: "error", timeout: 10000, actions: [{ label: t("Configurar"), action: () => openAccounts(id) }] });
    if (ev.state === "online" && was !== "online") {
      // Al conectar, las salas con pestaña abierta se marcan como "entrando" (el proceso principal se encarga de unirse).
      for (const key of S.tabs) {
        const c = S.convs.get(key);
        if (c?.accountId === id && c.type === "groupchat") roomState(id, c.conv).joining = true;
      }
    }
    emit("conn", { accountId: id });
    emit("room", { accountId: id });
  },
  self(id, ev) {
    conn(id).jid = ev.jid;
  },
  roster(id, ev) {
    const r = rosterOf(id);
    const seen = new Set();
    for (const item of ev.items) {
      Object.assign(contact(id, item.jid), item, { inRoster: true });
      seen.add(item.jid);
    }
    for (const c of r.values()) if (!seen.has(c.jid)) c.inRoster = false;
    emit("roster", { accountId: id });
  },
  "roster-item"(id, ev) {
    Object.assign(contact(id, ev.item.jid), ev.item, { inRoster: true });
    emit("roster", { accountId: id });
  },
  "roster-remove"(id, ev) {
    const c = rosterOf(id).get(ev.jid);
    if (c) c.inRoster = false;
    emit("roster", { accountId: id });
  },
  presence(id, ev) {
    const c = contact(id, ev.jid);
    const wasOnline = c.resources.size > 0;
    if (ev.available) c.resources.set(ev.resource, { show: ev.show, status: ev.status, priority: ev.priority });
    else c.resources.delete(ev.resource);
    // Contacto que se conecta o se desconecta (como en Pidgin). Los primeros segundos tras conectar no suenan:
    // es cuando el servidor manda de golpe la presencia de todos.
    const isOnline = c.resources.size > 0;
    if (c.inRoster && wasOnline !== isOnline && Date.now() - (conn(id).onlineAt || 0) > 8000) playSound(isOnline ? "contactOnline" : "contactOffline");
    if (ev.avatar) S.avatarOf.set(ev.jid, ev.avatar);
    emit("presence", { accountId: id, jid: ev.jid });
  },
  "subscribe-request"(id, ev) {
    playSound("subscribe");
    toast(t("{x} quiere añadirte a sus contactos", { x: ev.nick || ev.jid }), {
      kind: "info",
      timeout: 0,
      icon: "user-plus",
      actions: [
        { label: t("Aceptar"), primary: true, action: () => api("roster:answer", id, ev.jid, true) },
        { label: t("Rechazar"), action: () => api("roster:answer", id, ev.jid, false) },
      ],
    });
  },
  subscription(id, ev) {
    if (ev.type === "subscribed") toast(t("{jid} aceptó tu solicitud", { jid: ev.jid }), { kind: "ok" });
  },
  message(id, ev) {
    ingestMessage({ ...ev, accountId: id });
  },
  "message-error"(id, ev) {
    const c = S.convs.get(convKey(id, ev.conv));
    if (c) systemMessage(c, t("No se pudo entregar un mensaje: {message}", { message: ev.message }), { icon: "triangle-alert" });
  },
  chatstate(id, ev) {
    const c = S.convs.get(convKey(id, ev.conv));
    if (!c) return;
    const nick = ev.nick || displayName(id, ev.conv);
    if (ev.state === "composing" || ev.state === "paused") c.typing.set(nick, { state: ev.state, ts: Date.now() });
    else c.typing.delete(nick);
    emit("typing", { key: c.key });
    if (c.type === "groupchat") emit("occupants");
  },
  "room-joined"(id, ev) {
    const r = roomState(id, ev.room);
    Object.assign(r, { joined: true, joining: false, nick: ev.nick, role: ev.role, affiliation: ev.affiliation, error: "" });
    r.occupants = new Map(ev.occupants.map((o) => [o.nick, o]));
    const c = getConv(id, ev.room, "groupchat");
    if (!S.tabs.includes(c.key)) openConv(id, ev.room, "groupchat", { focus: !S.active, join: false });
    if (ev.created) systemMessage(c, t("Sala creada. Eres el propietario."), { icon: "crown" });
    emit("room", { accountId: id, room: ev.room });
    emit("occupants");
  },
  "room-left"(id, ev) {
    const r = roomState(id, ev.room);
    r.joined = false;
    r.joining = false;
    r.occupants.clear();
    const c = S.convs.get(convKey(id, ev.room));
    if (c && (ev.kicked || ev.banned || ev.shutdown)) {
      const what = ev.banned ? t("Has sido vetado de la sala") : ev.kicked ? t("Has sido expulsado de la sala") : t("La sala se ha cerrado");
      systemMessage(c, `${what}${ev.actor ? ` por ${ev.actor}` : ""}${ev.reason ? `: ${ev.reason}` : ""}`, { icon: "user-x" });
      toast(`${what} ${displayName(id, ev.room)}`, { kind: "warn" });
    }
    emit("room", { accountId: id, room: ev.room });
    emit("occupants");
  },
  "room-error"(id, ev) {
    const r = roomState(id, ev.room);
    r.joining = false;
    r.error = ev.message;
    const c = S.convs.get(convKey(id, ev.room));
    if (c) systemMessage(c, t("No se pudo entrar: {message}", { message: ev.message }), { icon: "triangle-alert" });
    const actions = [];
    if (ev.condition === "conflict") {
      actions.push({
        label: t("Otro apodo"),
        primary: true,
        action: async () => {
          const nick = await prompt({ title: t("Apodo en uso"), label: t("Elige otro apodo para {displayName}", { displayName: displayName(id, ev.room) }), value: `${r.nick || account(id).nick}_`, icon: "user" });
          if (nick) api("room:join", id, ev.room, nick).catch(() => {});
        },
      });
    }
    if (ev.condition === "not-authorized") actions.push({ label: t("Contraseña"), primary: true, action: () => openJoinRoom(id, { room: ev.room }) });
    toast(`${displayName(id, ev.room)}: ${ev.message}`, { kind: "error", timeout: actions.length ? 0 : 8000, actions });
    emit("room", { accountId: id, room: ev.room });
  },
  occupant(id, ev) {
    const r = roomState(id, ev.room);
    const o = ev.occupant;
    const had = r.occupants.has(o.nick);
    const c = S.convs.get(convKey(id, ev.room));
    if (o.available) r.occupants.set(o.nick, o);
    else r.occupants.delete(o.nick);
    if (o.avatar) S.avatarOf.set(`${ev.room}/${o.nick}`, o.avatar);
    if (c && r.joined && !ev.initial) {
      if (ev.kicked || ev.banned) systemMessage(c, `${o.nick} ha sido ${ev.banned ? "vetado" : "expulsado"}`, { icon: "user-x" });
      else if (o.available && !had) systemMessage(c, `${o.nick} ha entrado`, { icon: "log-in", joinLeave: true, kind: "join" });
      else if (!o.available && had) systemMessage(c, `${o.nick} ha salido${o.status ? ` (${o.status})` : ""}`, { icon: "log-out", joinLeave: true, kind: "leave" });
      if (!o.available) c.typing.delete(o.nick);
    }
    emitRoomSoon(id, ev.room);
  },
  "occupant-nick"(id, ev) {
    const r = roomState(id, ev.room);
    const o = r.occupants.get(ev.old);
    r.occupants.delete(ev.old);
    if (o) r.occupants.set(ev.nick, { ...o, nick: ev.nick });
    if (ev.self) r.nick = ev.nick;
    const c = S.convs.get(convKey(id, ev.room));
    if (c) systemMessage(c, ev.self ? t("Ahora eres {nick}", { nick: ev.nick }) : t("{old} ahora es {nick}", { old: ev.old, nick: ev.nick }), { icon: "pencil" });
    emitRoomSoon(id, ev.room);
  },
  subject(id, ev) {
    const r = roomState(id, ev.room);
    const changed = r.joined && r.subject !== ev.subject && !ev.ts;
    r.subject = ev.subject;
    const c = S.convs.get(convKey(id, ev.room));
    if (c && changed && ev.by) systemMessage(c, t("{by} cambió el tema: {subject}", { by: ev.by, subject: ev.subject }), { icon: "quote" });
    emit("room", { accountId: id, room: ev.room });
  },
  invite(id, ev) {
    playSound("invite");
    const text = ev.reason ? t("{from} te invita a {room}: «{reason}»", { from: ev.from, room: ev.room, reason: ev.reason }) : t("{from} te invita a {room}", { from: ev.from, room: ev.room });
    toast(text, {
      timeout: 0,
      icon: "door-open",
      actions: [{ label: t("Unirse"), primary: true, action: () => (ev.password ? openJoinRoom(id, { room: ev.room, password: ev.password }) : openConv(id, ev.room, "groupchat")) }],
    });
  },
  avatar(_id, ev) {
    S.avatars.set(ev.hash, `media://evex/avatars/${ev.file}`);
    emitAvatarSoon();
  },
  "own-avatar"(id, ev) {
    const acc = account(id);
    if (acc) S.avatarOf.set(acc.jid, ev.hash);
    conn(id).avatarHash = ev.hash;
    emitAvatarSoon();
  },
  "bookmarks-readonly"(id) {
    if (conn(id).bookmarksNoticeShown) return;
    conn(id).bookmarksNoticeShown = true;
    toast(t("El servidor no permite guardar la lista de salas, así que tus favoritas se guardan solo en este PC. Las que quites no volverán a aparecer."), { kind: "info", timeout: 9000 });
  },
  receipt(id, ev) {
    markReceipt(id, ev.conv, ev.id);
  },
  error(id, ev) {
    console.warn(`[${account(id)?.alias}]`, ev.message);
  },
};

const pendingRooms = new Set();
let roomTimer = null;
function emitRoomSoon(accountId, room) {
  pendingRooms.add(`${accountId}|${room}`);
  if (roomTimer) return;
  roomTimer = setTimeout(() => {
    roomTimer = null;
    for (const k of pendingRooms) {
      const [a, r] = k.split("|");
      emit("room", { accountId: a, room: r });
    }
    pendingRooms.clear();
    emit("occupants");
  }, 150);
}

let avatarTimer = null;
function emitAvatarSoon() {
  clearTimeout(avatarTimer);
  avatarTimer = setTimeout(() => emit("avatar"), 200);
}

// ---------- barra de título ----------

// Reloj de hora EVE (UTC) en la barra de título.
function startEveClock() {
  const box = $("#tb-eve");
  const out = $("#tb-eve-time");
  const tick = () => {
    box.classList.toggle("hidden", S.settings.showEveClock === false);
    out.textContent = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" });
  };
  tick();
  setInterval(tick, 1000);
}

function bindTitlebar() {
  startEveClock();
  $("#tb-switch").addEventListener("click", openSwitcher);
  $("#tb-rooms").addEventListener("click", () => S.accounts[0] && openRoomBrowser(S.accounts[0].id));
  $("#tb-search").addEventListener("click", () => {
    const c = S.active && S.convs.get(S.active);
    openSearch(c && c.accountId ? { accountId: c.accountId, conv: c.conv } : {});
  });
  $("#tb-settings").addEventListener("click", () => openSettings());
  $("#tb-sidebar").addEventListener("click", () => document.getElementById("app").classList.toggle("sidebar-hidden"));

  // Botones propios de la ventana; el de maximizar cambia a «Restaurar» con la ventana maximizada.
  $("#tb-minimize").addEventListener("click", () => api("window:minimize"));
  $("#tb-maximize").addEventListener("click", () => api("window:maximize"));
  $("#tb-close").addEventListener("click", () => api("window:close"));
  onMain("window-maximized", (max) => {
    const b = $("#tb-maximize");
    b.classList.toggle("maximized", max);
    const label = max ? t("Restaurar") : t("Maximizar");
    b.title = label;
    b.setAttribute("aria-label", label);
  });
}

function renderWelcome() {
  const w = $("#welcome");
  clear(w);
  const hasAccounts = S.accounts.length > 0;
  w.append(
    h("div", { class: "welcome-logo" }, h("img", { src: "assets/logo.svg", alt: "" })),
    h("h1", {}, "EvEX-MPP"),
    h("p", { class: "muted" }, hasAccounts ? t("Elige una sala o un contacto a la izquierda, o:") : t("Cliente XMPP moderno para comunidades de EVE Online. Para empezar:")),
    h(
      "div",
      { class: "welcome-actions" },
      !hasAccounts ? h("button", { class: "btn primary big", onclick: openPidginImport }, icon("import"), t("Importar desde Pidgin")) : null,
      !hasAccounts ? h("button", { class: "btn big", onclick: openSwitchAccount }, icon("user-plus"), t("Añadir cuenta manualmente")) : null,
      hasAccounts ? h("button", { class: "btn big", onclick: () => openRoomBrowser(S.accounts[0].id) }, icon("compass"), t("Explorar salas")) : null,
      hasAccounts ? h("button", { class: "btn big", onclick: () => openConv(null, "*", "pings") }, icon("siren"), t("Pings de flota")) : null,
      hasAccounts ? h("button", { class: "btn big", onclick: () => openSettings() }, icon("palette"), t("Personalizar")) : null,
    ),
    h(
      "div",
      { class: "shortcuts" },
      [
        ["Ctrl+K", t("Saltar a sala o contacto")],
        ["Ctrl+Tab", t("Siguiente pestaña")],
        ["Ctrl+W", t("Cerrar pestaña")],
        ["Ctrl+J", t("Unirse a sala")],
        ["Ctrl+B", t("Explorar salas")],
        ["Ctrl+F", t("Buscar en el historial")],
        ["Ctrl+,", t("Preferencias")],
        ["↑", t("Corregir último mensaje")],
      ].map(([k, d]) => h("div", { class: "shortcut" }, h("kbd", {}, k), h("span", {}, d))),
    ),
  );
}

// ---------- atajos y selector rápido ----------

function bindShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (document.querySelector(".modal-overlay")) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey && k === "k") {
      e.preventDefault();
      openSwitcher();
    } else if (e.ctrlKey && e.key === "Tab") {
      e.preventDefault();
      if (!S.tabs.length) return;
      const i = S.tabs.indexOf(S.active);
      activate(S.tabs[(i + (e.shiftKey ? -1 : 1) + S.tabs.length) % S.tabs.length]);
    } else if (e.ctrlKey && k === "w") {
      e.preventDefault();
      if (S.active) closeConv(S.active);
    } else if (e.ctrlKey && k === "j") {
      e.preventDefault();
      if (S.accounts[0]) openJoinRoom(currentAccount());
    } else if (e.ctrlKey && k === "b") {
      e.preventDefault();
      if (S.accounts[0]) openRoomBrowser(currentAccount());
    } else if (e.ctrlKey && k === "f") {
      e.preventDefault();
      const c = S.active && S.convs.get(S.active);
      openSearch(c?.accountId ? { accountId: c.accountId, conv: c.conv } : {});
    } else if (e.ctrlKey && e.key === ",") {
      e.preventDefault();
      openSettings();
    } else if (e.altKey && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      const key = S.tabs[Number(e.key) - 1];
      if (key) activate(key);
    } else if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1 && !e.target.closest("input, textarea, select, [contenteditable]")) {
      focusComposer();
    }
  });
}

function currentAccount() {
  const c = S.active && S.convs.get(S.active);
  return c?.accountId || S.accounts[0].id;
}

function openSwitcher() {
  const input = h("input", { class: "input big", placeholder: t("Sala, contacto o pestaña…"), autofocus: true });
  const list = h("div", { class: "switcher-list" });
  let items = [];
  let sel = 0;
  const all = () => {
    const out = [{ label: t("Pings de flota"), sub: "broadcasts", icon: "siren", run: () => openConv(null, "*", "pings") }];
    for (const acc of S.accounts) {
      for (const r of acc.rooms) out.push({ label: r.name, sub: r.jid, icon: "hash", run: () => openConv(acc.id, r.jid, "groupchat") });
      for (const c of rosterOf(acc.id).values()) if (c.inRoster) out.push({ label: c.name || c.jid.split("@")[0], sub: c.jid, icon: "user", run: () => openConv(acc.id, c.jid, "chat") });
    }
    for (const key of S.tabs) {
      const c = S.convs.get(key);
      if (c && c.type !== "pings" && !out.some((o) => o.sub === c.conv)) out.push({ label: displayName(c.accountId, c.conv), sub: c.conv, icon: c.type === "groupchat" ? "hash" : "message-square", run: () => activate(key) });
    }
    return out;
  };
  const source = all();
  const render = () => {
    const q = input.value.trim().toLowerCase();
    items = source
      .map((it) => {
        const l = it.label.toLowerCase();
        const score = !q ? 1 : l.startsWith(q) ? 3 : l.includes(q) ? 2 : it.sub.includes(q) ? 1 : 0;
        return { it, score };
      })
      .filter((x) => x.score)
      .sort((a, b) => b.score - a.score || a.it.label.localeCompare(b.it.label))
      .slice(0, 50)
      .map((x) => x.it);
    if (q && q.length > 1 && !items.length && S.accounts[0]) {
      const acc = account(currentAccount());
      const jid = q.includes("@") ? q : `${q}@${acc.conferenceServer}`;
      items.push({ label: t("Unirse a {jid}", { jid }), sub: "sala nueva", icon: "log-in", run: () => openConv(acc.id, jid, "groupchat") });
    }
    sel = Math.min(sel, Math.max(0, items.length - 1));
    clear(list);
    items.forEach((it, i) =>
      list.append(
        h("button", { class: `switcher-item ${i === sel ? "sel" : ""}`, onclick: () => (m.close(), it.run()) }, icon(it.icon), h("span", { class: "sw-label" }, it.label), h("span", { class: "muted small" }, it.sub)),
      ),
    );
  };
  input.addEventListener("input", () => ((sel = 0), render()));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length);
      render();
      list.children[sel]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && items[sel]) {
      m.close();
      items[sel].run();
    }
  });
  const m = modal({ title: t("Ir a…"), icon: "search", className: "switcher", body: h("div", {}, input, list) });
  render();
}

boot().catch((e) => {
  console.error(e);
  document.body.append(h("pre", { class: "fatal" }, t("Error al iniciar: {x}", { x: e.stack || e.message })));
});

export { PINGS_KEY, updateBadge, connectWithPrompt };
