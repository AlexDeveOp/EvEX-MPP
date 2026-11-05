// Barra lateral: cuentas y estado, pings, salas (favoritas / abiertas) y contactos.
import { S, api, on, conn, rosterOf, roomState, bestPresence, convKey, PINGS_KEY, MENTIONS_KEY, SHOW_LABEL, updateSettings, saveRooms, avatarUrl } from "./state.js";
import { mentionsConv } from "./mentions.js";
import { h, icon, iconButton, $, showMenu, menuFor, prompt, confirmDialog, toast, rafThrottle, keepHover, morphChildren } from "./dom.js";
import { openConv, closeConv, notifyMode, pingsConv } from "./convs.js";
import { toggleFavorite, toggleAutojoin, avatarEl } from "./chat.js";
import { openRoomBrowser, openJoinRoom } from "./rooms.js";
import { openAccounts, connectWithPrompt, openSwitchAccount } from "./accounts.js";
import { openBackgroundEditor, openAvatarSettings } from "./settings.js";
import { openSearch } from "./search.js";
import { sidebarSirenTs } from "./pings.js";

import { t } from "./i18n.js";
import { convBadge } from "./convs.js";
import { notifyItems } from "./chat.js";
import { effectiveLevel } from "./notify-rules.js";
import { dndNow, dndLabel, toggleDndNow } from "./dnd.js";
const collapsed = new Set(JSON.parse(localStorage.getItem("evex.collapsed") || "[]"));
let filter = "";
let reapplyHover = null;

export function initSidebar() {
  reapplyHover = keepHover($("#sidebar-content"), ".sb-item[data-key]");
  const render = rafThrottle(renderSidebar);
  for (const evt of ["sidebar", "accounts", "roster", "presence", "room", "conn", "settings", "avatar", "tabs"]) on(evt, render);
  const input = $("#sb-filter");
  input.addEventListener("input", () => {
    filter = input.value.trim().toLowerCase();
    renderSidebar();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      filter = "";
      renderSidebar();
    }
  });
  renderSidebar();
}

function saveCollapsed() {
  localStorage.setItem("evex.collapsed", JSON.stringify([...collapsed]));
}

function section(id, title, count, actions, content) {
  const isCollapsed = collapsed.has(id);
  return h(
    "section",
    { class: `sb-section ${isCollapsed ? "collapsed" : ""}`, dataset: { morph: id } },
    h(
      "header",
      {
        class: "sb-section-head",
        onclick: (e) => {
          if (e.target.closest(".icon-btn")) return;
          isCollapsed ? collapsed.delete(id) : collapsed.add(id);
          saveCollapsed();
          renderSidebar();
        },
      },
      icon(isCollapsed ? "chevron-right" : "chevron-down", "sb-chevron"),
      h("span", { class: "sb-section-title" }, title),
      count != null ? h("span", { class: "sb-count" }, count) : null,
      h("span", { class: "spacer" }),
      actions,
    ),
    isCollapsed ? null : h("div", { class: "sb-items", dataset: { morph: "items" } }, content),
  );
}

const matches = (...texts) => !filter || texts.some((s) => String(s || "").toLowerCase().includes(filter));

function renderSidebar() {
  // Se construye fuera de la página y solo se tocan las filas que cambian (antes se rehacía entera con cada
  // presencia, mensaje no leído o cambio de pestaña).
  const target = $("#sidebar-content");
  const scroll = target.scrollTop;
  const root = document.createElement("div");
  const accounts = document.createElement("div");
  accounts.append(accountCards());
  morphChildren($("#sidebar-accounts"), accounts);

  const pc = pingsConv();
  // La sirena late mientras haya pings nuevos (Preferencias → Pings de flota → Aviso visual), aunque estés en otra conversación.
  const sirenTs = sidebarSirenTs(pc.messages);
  root.append(
    h(
      "div",
      {
        class: `sb-item pings ${S.active === PINGS_KEY ? "active" : ""} ${pc.unread ? "unread" : ""} ${sirenTs ? "fresh" : ""}`,
        "data-key": PINGS_KEY,
        "data-ts": sirenTs ? String(sirenTs) : null,
        onclick: () => openConv(null, "*", "pings"),
      },
      icon("siren", "sb-icon"),
      h("span", { class: "sb-name" }, t("Pings de flota")),
      pc.unread ? h("span", { class: "badge mention" }, pc.unread) : null,
    ),
  );
  // Bandeja de menciones: los mensajes de las salas que te mencionan o coinciden con tus palabras clave.
  const mc = mentionsConv();
  root.append(
    h(
      "div",
      {
        class: `sb-item mentions ${S.active === MENTIONS_KEY ? "active" : ""} ${mc.pending ? "unread" : ""}`,
        "data-key": MENTIONS_KEY,
        title: t("Mensajes de las salas que te mencionan o coinciden con tus palabras clave"),
        onclick: () => openConv(null, "*", "mentions"),
      },
      icon("at-sign", "sb-icon"),
      h("span", { class: "sb-name" }, t("Menciones")),
      mc.pending ? h("span", { class: "badge mention" }, mc.pending > 99 ? "99+" : mc.pending) : null,
    ),
  );

  // Con varias cuentas, solo se listan salas y contactos de las que están en uso.
  const active = S.accounts.filter((a) => conn(a.id).state !== "offline");
  for (const acc of active.length ? active : S.accounts) {
    root.append(roomsSection(acc));
    root.append(contactsSection(acc));
  }
  if (!S.accounts.length) {
    root.append(h("div", { class: "empty-state small" }, icon("user-plus"), h("p", {}, t("No hay cuentas configuradas.")), h("button", { class: "btn primary", onclick: () => openAccounts() }, t("Añadir cuenta"))));
  }
  morphChildren(target, root);
  target.scrollTop = scroll;
  reapplyHover?.();
}

// ---------- cuentas ----------

const STATUS_OPTIONS = [
  ["", t("Disponible"), "online"],
  ["chat", t("Hablador"), "chat"],
  ["away", t("Ausente"), "away"],
  ["xa", t("Ausente (extendido)"), "xa"],
  ["dnd", t("No molestar"), "dnd"],
];

function accountCards() {
  const wrap = h("div", { class: "sb-accounts" });
  for (const acc of S.accounts) {
    const st = conn(acc.id);
    const online = st.state === "online";
    const show = online ? st.show || "online" : st.state === "connecting" || st.state === "reconnecting" ? "connecting" : "offline";
    const label = online ? SHOW_LABEL[st.show || ""] : { connecting: t("Conectando…"), reconnecting: t("Reconectando…"), error: t("Error"), offline: t("Desconectado") }[st.state] || st.state;
    const card = h(
      "div",
      { class: `account-card ${st.state}` },
      // Clic en el círculo: Preferencias → Avatar, donde se cambia el avatar.
      Object.assign(avatarEl(acc.jid, acc.alias, "account-avatar", show), {
        title: t("Cambiar mi avatar"),
        role: "button",
        tabIndex: 0,
        onclick: () => openAvatarSettings(acc.id),
        onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openAvatarSettings(acc.id)),
      }),
      h(
        "div",
        { class: "account-info" },
        h("div", { class: "account-name" }, acc.alias),
        h(
          "button",
          { class: "status-btn", onclick: (e) => menuFor(e.currentTarget, statusMenu(acc)) },
          h("span", { class: `presence-dot ${show}` }),
          h("span", {}, label),
          st.statusText && online ? h("span", { class: "status-text" }, `— ${st.statusText}`) : null,
          icon("chevron-down"),
        ),
        st.state === "error" && st.error ? h("div", { class: "account-error", title: st.error }, st.error) : null,
      ),
      online
        ? iconButton("power", t("Desconectar"), () => api("account:disconnect", acc.id))
        : iconButton("log-in", t("Conectar"), () => connectWithPrompt(acc.id), "accent"),
    );
    wrap.append(card);
  }
  return wrap;
}

function statusMenu(acc) {
  const st = conn(acc.id);
  const online = st.state === "online";
  return [
    ...STATUS_OPTIONS.map(([show, label, cls]) => ({
      label,
      icon: "circle",
      checked: online && (st.show || "") === show,
      action: async () => {
        if (!online) await connectWithPrompt(acc.id);
        api("presence:set", acc.id, show, st.statusText || "").catch((e) => toast(e.message, { kind: "error" }));
      },
      cls,
    })),
    "-",
    {
      label: t("Mensaje de estado…"),
      icon: "square-pen",
      disabled: !online,
      action: async () => {
        const msg = await prompt({ title: t("Mensaje de estado"), label: t("Lo verán tus contactos y las salas"), value: st.statusText || "", icon: "square-pen" });
        if (msg != null) api("presence:set", acc.id, st.show || "", msg);
      },
    },
    { label: t("Cambiar mi avatar…"), icon: "image", action: () => openAvatarSettings(acc.id) },
    "-",
    // «No molestar» de la app (solo avisos; tu estado XMPP no cambia). Los pings de flota siguen sonando.
    { label: dndNow().active ? dndLabel() : t("No molestar en la app (silenciar avisos)"), icon: "bell-off", checked: dndNow().active, hint: t("Solo suenan los pings de flota"), action: toggleDndNow },
    "-",
    online ? { label: t("Desconectar"), icon: "power", action: () => api("account:disconnect", acc.id) } : { label: t("Conectar"), icon: "log-in", action: () => connectWithPrompt(acc.id) },
    { label: t("Cambiar de cuenta…"), icon: "refresh-cw", action: openSwitchAccount },
    { label: t("Configurar cuenta…"), icon: "user-cog", action: () => openAccounts(acc.id) },
  ];
}

// ---------- salas ----------

function roomsSection(acc) {
  const live = S.rooms[acc.id] || new Map();
  const favorites = acc.rooms.filter((r) => r.favorite || r.autojoin);
  // Salas abiertas en esta sesión que no están en favoritas (también las que tengan ambos iconos apagados).
  const others = [];
  for (const [jid, r] of live) {
    if (!(r.joined || r.joining) || favorites.some((x) => x.jid === jid)) continue;
    const saved = acc.rooms.find((x) => x.jid === jid);
    others.push(saved || { jid, name: jid.split("@")[0], favorite: false, autojoin: false, temp: true });
  }
  const sortRooms = (a, b) => (a.name || a.jid).localeCompare(b.name || b.jid);
  const favItems = favorites.sort(sortRooms).filter((r) => matches(r.name, r.jid)).map((r) => roomItem(acc, r));
  const otherItems = others.sort(sortRooms).filter((r) => matches(r.name, r.jid)).map((r) => roomItem(acc, r));
  const items = [...favItems, ...(otherItems.length ? [h("div", { class: "sb-subhead" }, t("Abiertas ahora (no favoritas)")), ...otherItems] : [])];
  return section(
    `rooms:${acc.id}`,
    S.accounts.length > 1 ? t("Salas favoritas · {alias}", { alias: acc.alias }) : t("Salas favoritas"),
    `${[...live.values()].filter((r) => r.joined).length}/${favorites.length}`,
    [
      iconButton("compass", t("Explorar salas del servidor (Ctrl+B)"), () => openRoomBrowser(acc.id), "sb-explore"),
      iconButton("plus", t("Unirse a una sala"), (e) => menuFor(e.currentTarget, joinMenu(acc))),
    ],
    items.length ? items : h("div", { class: "sb-empty" }, filter ? t("Sin resultados") : t("Sin salas. Usa "), !filter ? h("a", { href: "#", onclick: (e) => (e.preventDefault(), openRoomBrowser(acc.id)) }, t("Explorar salas")) : null),
  );
}

// Menú del botón + de las salas: entrar por nombre (con sugerencias) o abrir el explorador del servidor.
function joinMenu(acc) {
  return [
    { label: t("Unirse por nombre…"), icon: "log-in", hint: "Ctrl+J", action: () => openJoinRoom(acc.id) },
    { label: t("Explorar salas del servidor…"), icon: "compass", hint: "Ctrl+B", action: () => openRoomBrowser(acc.id) },
  ];
}

// Nivel de aviso de una fila de la barra lateral, aunque la conversación aún no esté abierta.
function rowLevel(key, type, room) {
  const c = S.convs.get(key);
  return c ? notifyMode(c) : effectiveLevel(type, S.settings.notifications.roomModes[key] || room?.notify, S.settings.notifications);
}
// Campana tachada discreta para las salas y chats en «Nada».
const mutedMark = (level) => (level === "none" ? h("span", { class: "sb-muted", title: t("Avisos: nada") }, icon("bell-off")) : null);

function roomItem(acc, room) {
  const fav = !!(room.favorite || room.autojoin);
  const key = convKey(acc.id, room.jid);
  const c = S.convs.get(key);
  const r = roomState(acc.id, room.jid);
  const mode = rowLevel(key, "groupchat", room);
  const badge = c ? convBadge(c).count : 0;
  const dim = c && !c.mentions && c.unread && mode !== "all";
  return h(
    "div",
    {
      "data-key": key,
      class: `sb-item room ${S.active === key ? "active" : ""} ${r.joined ? "joined" : r.joining ? "joining" : "parted"} ${c?.unread ? "unread" : ""} ${dim ? "quiet-unread" : ""}`,
      title: `${room.jid}${r.subject ? `\n${r.subject}` : ""}`,
      onclick: () => openConv(acc.id, room.jid, "groupchat"),
      oncontextmenu: (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, roomMenu(acc, room));
      },
    },
    icon(r.error ? "triangle-alert" : "hash", "sb-icon"),
    h("span", { class: "sb-name" }, room.name || room.jid.split("@")[0]),
    mutedMark(mode),
    r.joined ? h("span", { class: "sb-meta" }, r.occupants.size) : null,
    badge ? h("span", { class: `badge ${c.mentions ? "mention" : ""}` }, badge > 99 ? "99+" : badge) : null,
    h(
      "span",
      { class: "sb-quick" },
      iconButton("zap", room.autojoin ? t("Se abre al iniciar") : t("Abrir al iniciar"), (e) => (e.stopPropagation(), toggleAutojoin(acc.id, room.jid)), room.autojoin ? "on zap" : ""),
      iconButton("star", fav ? t("Favorita (clic para quitarla)") : t("Añadir a favoritas"), (e) => (e.stopPropagation(), toggleFavorite(acc.id, room.jid)), fav ? "on star" : ""),
    ),
  );
}

function roomMenu(acc, room) {
  const key = convKey(acc.id, room.jid);
  const r = roomState(acc.id, room.jid);
  return [
    { label: r.joined ? t("Abrir") : t("Entrar"), icon: "log-in", action: () => openConv(acc.id, room.jid, "groupchat") },
    r.joined || r.joining ? { label: t("Salir de la sala"), icon: "door-open", action: () => closeConv(key) } : null,
    "-",
    { label: t("Favorita"), icon: "star", checked: !!(room.favorite || room.autojoin), action: () => toggleFavorite(acc.id, room.jid) },
    { label: t("Entrar automáticamente al iniciar"), icon: "zap", checked: !!room.autojoin, action: () => toggleAutojoin(acc.id, room.jid) },
    ...notifyItems(key, "groupchat"),
    "-",
    {
      label: t("Renombrar…"),
      icon: "pencil",
      disabled: room.temp,
      action: async () => {
        const name = await prompt({ title: t("Nombre de la sala"), label: room.jid, value: room.name, icon: "pencil" });
        if (name == null) return;
        acc.rooms.find((x) => x.jid === room.jid).name = name.trim() || room.jid.split("@")[0];
        saveRooms(acc.id);
      },
    },
    {
      label: t("Apodo en esta sala…"),
      icon: "user",
      disabled: room.temp,
      action: async () => {
        const nick = await prompt({ title: t("Apodo para esta sala"), label: t("Vacío = apodo de la cuenta"), value: room.nick || "", icon: "user" });
        if (nick == null) return;
        acc.rooms.find((x) => x.jid === room.jid).nick = nick.trim();
        saveRooms(acc.id);
      },
    },
    { label: t("Fondo personalizado…"), icon: "image", action: () => openBackgroundEditor(key) },
    { label: t("Buscar en el historial"), icon: "search", action: () => openSearch({ accountId: acc.id, conv: room.jid }) },
    { label: t("Copiar dirección"), icon: "copy", action: () => navigator.clipboard.writeText(room.jid) },
    "-",
    !room.temp
      ? {
          label: t("Quitar de la lista"),
          icon: "trash-2",
          danger: true,
          action: async () => {
            if (!(await confirmDialog({ title: t("Quitar sala"), message: t("¿Quitar {name} de tu lista de salas? El historial local se conserva.", { name: room.name }), okLabel: t("Quitar"), danger: true }))) return;
            acc.rooms = acc.rooms.filter((x) => x.jid !== room.jid);
            saveRooms(acc.id);
          },
        }
      : null,
  ];
}

// ---------- contactos ----------

function contactsSection(acc) {
  const roster = [...rosterOf(acc.id).values()].filter((c) => c.inRoster);
  const showOffline = S.settings.behavior.showOffline;
  const groups = new Map();
  let online = 0;
  for (const c of roster) {
    const p = bestPresence(c);
    if (p.show !== "offline") online++;
    if (!showOffline && p.show === "offline" && !S.convs.get(convKey(acc.id, c.jid))?.unread) continue;
    if (!matches(c.name, c.jid)) continue;
    for (const g of c.groups.length ? c.groups : [t("Contactos")]) {
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push({ c, p });
    }
  }
  const RANK = { chat: 0, online: 0, away: 1, xa: 2, dnd: 3, offline: 9 };
  const content = [];
  for (const [g, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort((a, b) => RANK[a.p.show] - RANK[b.p.show] || (a.c.name || a.c.jid).localeCompare(b.c.name || b.c.jid));
    const gid = `group:${acc.id}:${g}`;
    const isCollapsed = collapsed.has(gid);
    content.push(
      h(
        "div",
        {
          class: "sb-group",
          onclick: () => {
            isCollapsed ? collapsed.delete(gid) : collapsed.add(gid);
            saveCollapsed();
            renderSidebar();
          },
        },
        icon(isCollapsed ? "chevron-right" : "chevron-down"),
        h("span", {}, g),
        h("span", { class: "sb-count" }, `${list.filter((x) => x.p.show !== "offline").length}/${list.length}`),
      ),
    );
    if (!isCollapsed) for (const { c, p } of list) content.push(contactItem(acc, c, p));
  }
  if (!content.length) content.push(h("div", { class: "sb-empty" }, conn(acc.id).state === "online" ? (filter ? t("Sin resultados") : t("Nadie conectado")) : t("Sin conexión")));
  return section(
    `contacts:${acc.id}`,
    S.accounts.length > 1 ? t("Contactos · {alias}", { alias: acc.alias }) : t("Contactos"),
    `${online}/${roster.length}`,
    [
      iconButton(showOffline ? "eye" : "eye-off", showOffline ? t("Ocultar desconectados") : t("Mostrar desconectados"), () => updateSettings((s) => (s.behavior.showOffline = !s.behavior.showOffline)), showOffline ? "on" : ""),
      iconButton("user-plus", t("Añadir contacto"), () => addContact(acc)),
    ],
    content,
  );
}

function contactItem(acc, c, p) {
  const key = convKey(acc.id, c.jid);
  const conv = S.convs.get(key);
  const level = rowLevel(key, "chat");
  const badge = conv ? convBadge(conv).count : 0;
  return h(
    "div",
    {
      "data-key": key,
      class: `sb-item contact ${p.show} ${S.active === key ? "active" : ""} ${conv?.unread ? "unread" : ""}`,
      title: `${c.jid}${p.status ? `\n${p.status}` : ""}`,
      onclick: () => openConv(acc.id, c.jid, "chat"),
      oncontextmenu: (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, contactMenu(acc, c));
      },
    },
    avatarEl(c.jid, c.name || c.jid, "sb-avatar", p.show),
    h("span", { class: "sb-name-wrap" }, h("span", { class: "sb-name" }, c.name || c.jid.split("@")[0]), p.status ? h("span", { class: "sb-status" }, p.status) : null),
    mutedMark(level),
    badge ? h("span", { class: "badge mention" }, badge) : null,
  );
}

function contactMenu(acc, c) {
  return [
    { label: t("Enviar mensaje"), icon: "message-square", action: () => openConv(acc.id, c.jid, "chat") },
    { label: t("Buscar en el historial"), icon: "search", action: () => openSearch({ accountId: acc.id, conv: c.jid }) },
    "-",
    ...notifyItems(convKey(acc.id, c.jid), "chat"),
    "-",
    {
      label: t("Renombrar…"),
      icon: "pencil",
      action: async () => {
        const name = await prompt({ title: t("Renombrar contacto"), label: c.jid, value: c.name, icon: "pencil" });
        if (name != null) api("roster:update", acc.id, c.jid, name.trim(), c.groups).catch((e) => toast(e.message, { kind: "error" }));
      },
    },
    {
      label: t("Cambiar grupo…"),
      icon: "folder-open",
      action: async () => {
        const g = await prompt({ title: t("Grupos"), label: t("Separados por comas"), value: c.groups.join(", "), icon: "folder-open" });
        if (g != null) api("roster:update", acc.id, c.jid, c.name, g.split(",").map((x) => x.trim()).filter(Boolean)).catch((e) => toast(e.message, { kind: "error" }));
      },
    },
    { label: t("Fondo personalizado…"), icon: "image", action: () => openBackgroundEditor(convKey(acc.id, c.jid)) },
    { label: t("Copiar dirección"), icon: "copy", action: () => navigator.clipboard.writeText(c.jid) },
    "-",
    {
      label: t("Eliminar contacto"),
      icon: "trash-2",
      danger: true,
      action: async () => {
        if (await confirmDialog({ title: t("Eliminar contacto"), message: t("¿Eliminar a {x} de tu lista?", { x: c.name || c.jid }), okLabel: t("Eliminar"), danger: true })) api("roster:remove", acc.id, c.jid);
      },
    },
  ];
}

async function addContact(acc) {
  const jid = await prompt({ title: t("Añadir contacto"), label: t("Dirección XMPP"), placeholder: `usuario@${acc.jid.split("@")[1]}`, icon: "user-plus" });
  if (!jid) return;
  const full = jid.includes("@") ? jid.trim().toLowerCase() : `${jid.trim().toLowerCase()}@${acc.jid.split("@")[1]}`;
  api("roster:add", acc.id, full, "", []).then(() => toast(t("Solicitud enviada a {full}", { full }), { kind: "ok" })).catch((e) => toast(e.message, { kind: "error" }));
}

export { avatarUrl };
