// Vista de conversación: pestañas, cabecera, lista de mensajes, compositor y comandos.
import { S, api, on, emit, account, roomState, contact, bestPresence, avatarUrl, nickColor, initials, updateSettings, saveRooms, conn, SHOW_LABEL } from "./state.js";
import { h, icon, iconButton, $, clear, showMenu, menuFor, toast, prompt, esc, debounce, rafThrottle } from "./dom.js";
import { formatBody, previewHtml, fmtTime, fmtDay, fmtDateTime, fmtEve, fmtTimes } from "./format.js";
import { openPicker, shortcodeSuggestions, emojifyHtml } from "./emoji.js";
import { playSound } from "./sounds.js";
import { openGifPicker } from "./gifs.js";
import { activate, closeConv, openConv, convTitle, markRead, loadHistory, systemMessage, mentionWords, moveTab, notifyMode, getConv } from "./convs.js";
import { applyBackgroundLayer } from "./themes.js";
import { pingCard, pingMatches, pingGroups } from "./pings.js";
import { matchRule, highlightRules } from "./keywords.js";
import { openBackgroundEditor, openSettings } from "./settings.js";
import { stopSpeaking } from "./tts.js";
import { openSearch } from "./search.js";
import { searchMissedPings } from "./ping-recovery.js";
import { canEditTopic, topicLockedReason, canConfigureRoom, openTopicEditor, setTopic, openRoomConfig } from "./room-admin.js";

import { t } from "./i18n.js";
const panes = new Map();

export function initChat() {
  // Las pestañas se pintan como mucho una vez por fotograma (antes, una vez por cada mensaje no leído).
  on("tabs", rafThrottle(renderTabs));
  on("active", showActive);
  on("message", ({ conv, msg }) => appendMessage(conv, msg));
  on("message-updated", ({ conv, msg }) => updateMessage(conv, msg));
  on("history", ({ conv, prepended }) => {
    const p = panes.get(conv.key);
    if (p && !skipHidden(conv, p)) renderAllMessages(conv, p, prepended);
  });
  on("accounts", () => {
    for (const [key, p] of panes) {
      const c = S.convs.get(key);
      if (c) renderHeader(c, p);
    }
  });
  on("room", ({ accountId, room }) => {
    const p = panes.get(`${accountId}|${room}`);
    if (p) renderHeader(S.convs.get(`${accountId}|${room}`), p);
  });
  on("presence", ({ accountId, jid }) => {
    const p = panes.get(`${accountId}|${jid}`);
    if (p) renderHeader(S.convs.get(`${accountId}|${jid}`), p);
  });
  on("typing", ({ key }) => {
    const p = panes.get(key);
    if (p) renderTyping(S.convs.get(key), p);
  });
  on("conv-bg", (key) => {
    const p = panes.get(key);
    if (p) applyConvBackground(S.convs.get(key), p);
  });
  on("settings", () => rerenderAll());
  // Al cambiar un ajuste solo se repinta la pestaña visible; las demás se repintan cuando se abren.
  function rerenderAllNow() {
    for (const [key, p] of panes) {
      const c = S.convs.get(key);
      if (!c) continue;
      if (key !== S.active) {
        p.dirty = true;
        continue;
      }
      applyConvBackground(c, p);
      renderAllMessages(c, p);
      renderHeader(c, p);
    }
    renderTabs();
  }
  const rerenderAll = debounce(rerenderAllNow, 120);
  on("avatar", () => {
    for (const p of panes.values()) {
      for (const img of p.list.querySelectorAll(".avatar[data-avatar-for]")) {
        const url = avatarUrl(img.dataset.avatarFor);
        if (url) setAvatar(img, url);
      }
    }
  });
  setInterval(() => {
    const now = Date.now();
    for (const [key, p] of panes) {
      const c = S.convs.get(key);
      if (!c) continue;
      let changed = false;
      for (const [nick, typing] of c.typing) {
        if (now - typing.ts > 30000) {
          c.typing.delete(nick);
          changed = true;
        }
      }
      if (changed) renderTyping(c, p);
    }
  }, 5000);
  renderTabs();
  showActive();
}

// ---------- pestañas ----------

function renderTabs() {
  const bar = $("#tabs");
  clear(bar);
  S.tabs.forEach((key, i) => {
    const c = S.convs.get(key);
    if (!c) return;
    const r = c.type === "groupchat" ? roomState(c.accountId, c.conv) : null;
    const badge = c.type === "groupchat" && notifyMode(c) !== "all" ? c.mentions : c.unread;
    const tab = h(
      "div",
      {
        class: `tab ${S.active === key ? "active" : ""} ${c.unread ? "unread" : ""} ${c.mentions ? "mentioned" : ""} ${r && !r.joined ? "inactive" : ""}`,
        draggable: "true",
        title: convTitle(c),
        onclick: () => activate(key),
        onauxclick: (e) => e.button === 1 && closeConv(key),
        oncontextmenu: (e) => {
          e.preventDefault();
          showMenu(e.clientX, e.clientY, convMenu(c));
        },
        ondragstart: (e) => e.dataTransfer.setData("text/tab", String(i)),
        ondragover: (e) => e.preventDefault(),
        ondrop: (e) => {
          e.preventDefault();
          const from = Number(e.dataTransfer.getData("text/tab"));
          if (!Number.isNaN(from) && from !== i) moveTab(from, i);
        },
      },
      tabIcon(c),
      h("span", { class: "tab-title" }, convTitle(c)),
      badge ? h("span", { class: `badge ${c.mentions ? "mention" : ""}` }, badge > 99 ? "99+" : badge) : null,
      h(
        "button",
        {
          class: "tab-close",
          title: t("Cerrar"),
          onclick: (e) => {
            e.stopPropagation();
            closeConv(key);
          },
        },
        icon("x"),
      ),
    );
    bar.append(tab);
  });
  bar.classList.toggle("empty", !S.tabs.length);
  // Sin barra de desplazamiento: la rueda recorre las pestañas a lo ancho y la activa queda siempre a la vista.
  if (!bar.dataset.wheel) {
    bar.dataset.wheel = "1";
    bar.addEventListener(
      "wheel",
      (e) => {
        if (bar.scrollWidth <= bar.clientWidth) return;
        bar.scrollLeft += e.deltaY || e.deltaX;
        e.preventDefault();
      },
      { passive: false },
    );
  }
  if (bar.dataset.shown !== (S.active || "")) {
    bar.dataset.shown = S.active || "";
    bar.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function tabIcon(c) {
  if (c.type === "pings") return icon("siren", "tab-icon ping");
  if (c.type === "groupchat") return icon("hash", "tab-icon");
  const p = bestPresence(contact(c.accountId, c.conv.split("/")[0]));
  return h("span", { class: `presence-dot ${p.show}` });
}

export function convMenu(c) {
  if (c.type === "pings") return [{ label: t("Cerrar"), icon: "x", action: () => closeConv(c.key) }];
  const acc = account(c.accountId);
  const room = acc?.rooms.find((r) => r.jid === c.conv);
  const items = [];
  if (c.type === "groupchat") {
    const rs = roomState(c.accountId, c.conv);
    items.push(
      { label: isFavorite(room) ? t("Quitar de favoritas") : t("Añadir a favoritas"), icon: isFavorite(room) ? "star-off" : "star", action: () => toggleFavorite(c.accountId, c.conv) },
      { label: t("Entrar automáticamente"), icon: "zap", checked: !!room?.autojoin, action: () => toggleAutojoin(c.accountId, c.conv) },
      "-",
      { header: t("Notificaciones") },
      ...[
        ["default", t("Por defecto")],
        ["all", t("Todos los mensajes")],
        ["mentions", t("Solo menciones")],
        ["none", t("Silenciada")],
      ].map(([v, l]) => ({ label: l, checked: (S.settings.notifications.roomModes[c.key] || "default") === v, action: () => setRoomNotify(c, v) })),
      "-",
      { label: t("Cambiar el tema…"), icon: "pencil", disabled: !canEditTopic(rs), hint: canEditTopic(rs) ? null : topicLockedReason(rs), action: () => openTopicEditor(c, pane(c)) },
      ...(rs.subject ? [{ label: t("Copiar el tema"), icon: "copy", action: () => navigator.clipboard.writeText(rs.subject) }] : []),
      { label: t("Configuración de la sala…"), icon: "settings", disabled: !canConfigureRoom(rs), hint: canConfigureRoom(rs) ? null : t("Solo los propietarios de la sala"), action: () => openRoomConfig(c) },
      "-",
      { label: t("Cambiar apodo…"), icon: "user-cog", action: () => changeNick(c) },
      { label: t("Invitar a alguien…"), icon: "user-plus", action: () => inviteTo(c) },
      { label: t("Volver a entrar"), icon: "refresh-cw", action: () => rejoin(c) },
    );
  }
  items.push(
    { label: t("Fondo de esta conversación…"), icon: "image", action: () => openBackgroundEditor(c.key) },
    { label: t("Buscar en el historial"), icon: "search", action: () => openSearch({ accountId: c.accountId, conv: c.conv }) },
    { label: t("Copiar dirección"), icon: "copy", action: () => navigator.clipboard.writeText(c.conv) },
    "-",
    { label: c.type === "groupchat" ? t("Salir de la sala") : t("Cerrar"), icon: c.type === "groupchat" ? "door-open" : "x", danger: c.type === "groupchat", action: () => closeConv(c.key) },
  );
  return items;
}

async function rejoin(c) {
  const r = roomState(c.accountId, c.conv);
  await api("room:leave", c.accountId, c.conv).catch(() => {});
  r.joined = false;
  r.joining = true;
  await api("room:join", c.accountId, c.conv, r.nick || null).catch((e) => toast(e.message, { kind: "error" }));
}

function setRoomNotify(c, v) {
  updateSettings((s) => {
    if (v === "default") delete s.notifications.roomModes[c.key];
    else s.notifications.roomModes[c.key] = v;
  });
}

// Reglas: ⚡ (entrar al iniciar) implica ★ (favorita). Quitar la ★ saca la sala de la lista y también quita el ⚡.
const isFavorite = (r) => !!r && (r.favorite || r.autojoin);

export async function toggleFavorite(accountId, jid) {
  const acc = account(accountId);
  const room = acc.rooms.find((r) => r.jid === jid);
  if (isFavorite(room)) {
    const index = acc.rooms.indexOf(room);
    acc.rooms = acc.rooms.filter((r) => r !== room);
    await saveRooms(accountId);
    toast(`${room.name} quitada de favoritas`, {
      kind: "ok",
      timeout: 5000,
      actions: [
        {
          label: t("Deshacer"),
          action: async () => {
            const a = account(accountId);
            if (a.rooms.some((r) => r.jid === jid)) return;
            a.rooms.splice(Math.min(index, a.rooms.length), 0, room);
            await saveRooms(accountId);
          },
        },
      ],
    });
    return;
  }
  if (room) room.favorite = true;
  else acc.rooms.push({ jid, name: jid.split("@")[0], autojoin: false, favorite: true, notify: "default" });
  await saveRooms(accountId);
  toast(t("{x} añadida a favoritas", { x: room?.name || jid.split("@")[0] }), { kind: "ok", timeout: 2500 });
}

export async function toggleAutojoin(accountId, jid) {
  const acc = account(accountId);
  let room = acc.rooms.find((r) => r.jid === jid);
  if (!room) {
    room = { jid, name: jid.split("@")[0], autojoin: true, favorite: true, notify: "default" };
    acc.rooms.push(room);
  } else {
    room.autojoin = !room.autojoin;
    if (room.autojoin) room.favorite = true;
  }
  await saveRooms(accountId);
  toast(room.autojoin ? t("Se entrará en {name} al iniciar", { name: room.name }) : t("{name} ya no se abrirá al iniciar (sigue en favoritas)", { name: room.name }), { kind: "ok", timeout: 2500 });
}

async function changeNick(c) {
  const r = roomState(c.accountId, c.conv);
  const nick = await prompt({ title: t("Cambiar apodo"), label: t("Nuevo apodo en {convTitle}", { convTitle: convTitle(c) }), value: r.nick, icon: "pencil" });
  if (nick && nick !== r.nick) api("room:nick", c.accountId, c.conv, nick).catch((e) => toast(e.message, { kind: "error" }));
}

async function inviteTo(c) {
  const jid = await prompt({ title: t("Invitar a la sala"), label: t("Dirección (usuario@ejemplo.com)"), icon: "user-plus" });
  if (jid) api("room:invite", c.accountId, c.conv, jid.trim(), "").then(() => systemMessage(c, t("Invitación enviada a {jid}", { jid }))).catch((e) => toast(e.message, { kind: "error" }));
}

// ---------- panel de conversación ----------

function pane(c) {
  let p = panes.get(c.key);
  if (p) return p;
  const list = h("div", { class: "msg-list", tabindex: "-1" });
  const scroller = h("div", { class: "msg-scroll" }, list);
  const jump = h("button", { class: "jump-bottom hidden", onclick: () => scrollToBottom(p, true) }, icon("arrow-down"), h("span", { class: "jump-count" }));
  const typing = h("div", { class: "typing-line" });
  const header = h("header", { class: "conv-header" });
  const bg = h("div", { class: "conv-bg" });
  const root = h("section", { class: `conv-pane type-${c.type}`, dataset: { key: c.key } }, bg, header, h("div", { class: "conv-body" }, scroller, jump), typing);
  p = { root, list, scroller, jump, typing, header, bg, newCount: 0 };
  if (c.type === "pings") {
    p.filter = { query: "", group: "" };
  } else {
    p.composer = buildComposer(c, p);
    root.append(p.composer.el);
  }
  scroller.addEventListener("scroll", () => {
    const near = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    p.atBottom = near;
    if (near) {
      p.newCount = 0;
      jump.classList.add("hidden");
    } else jump.classList.remove("hidden");
    // Mientras se lee arriba, la memoria no recorta los mensajes antiguos (convs.js).
    c.reading = !near;
    if (scroller.scrollTop < 40 && !p.loadingMore && c.type !== "pings") {
      if (p.skipped) renderAllMessages(c, p, true);
      else if (!c.exhausted) {
        p.loadingMore = true;
        loadHistory(c, true).finally(() => (p.loadingMore = false));
      }
    }
  });
  list.addEventListener("click", (e) => onListClick(c, e));
  list.addEventListener("contextmenu", (e) => {
    const el = e.target.closest(".msg");
    if (!el || window.getSelection().toString() || e.target.closest("a")) return;
    e.preventDefault();
    const m = c.messages.find((x) => x.key === el.dataset.key);
    if (m) showMenu(e.clientX, e.clientY, messageMenu(c, m));
  });
  panes.set(c.key, p);
  $("#conv-container").append(root);
  applyConvBackground(c, p);
  renderHeader(c, p);
  renderAllMessages(c, p);
  return p;
}

function applyConvBackground(c, p) {
  const bg = S.settings.conversationBackgrounds?.[c.key];
  applyBackgroundLayer(p.bg, bg);
  p.root.classList.toggle("has-conv-bg", !!bg);
}

// Una pestaña oculta no pinta mensajes: se marca y se repinta entera al abrirla.
function skipHidden(c, p) {
  if (c.key === S.active || c.type === "pings") return false;
  p.dirty = true;
  return true;
}

function showActive() {
  const c = S.active ? S.convs.get(S.active) : null;
  for (const [key, p] of panes) {
    if (!S.convs.has(key) || !S.tabs.includes(key)) {
      p.root.remove();
      panes.delete(key);
    }
  }
  $("#welcome").classList.toggle("hidden", !!c);
  for (const p of panes.values()) p.root.classList.remove("active");
  if (!c) return;
  const p = pane(c);
  if (p.dirty) {
    p.dirty = false;
    applyConvBackground(c, p);
    renderAllMessages(c, p);
  }
  p.root.classList.add("active");
  renderHeader(c, p);
  if (c.firstUnreadKey) {
    insertUnreadMarker(c, p);
    c.firstUnreadKey = null;
  }
  if (p.atBottom !== false && c.type !== "pings") scrollToBottom(p);
  p.composer?.focus();
  emit("occupants");
}

export function focusComposer() {
  const c = S.active && S.convs.get(S.active);
  if (c) panes.get(c.key)?.composer?.focus();
}

function scrollToBottom(p, smooth) {
  requestAnimationFrame(() => {
    p.scroller.scrollTo({ top: p.scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    p.atBottom = true;
    p.newCount = 0;
    p.jump.classList.add("hidden");
  });
}

// ---------- cabecera ----------

function renderHeader(c, p) {
  if (!c) return;
  clear(p.header);
  const acc = account(c.accountId);
  if (c.type === "pings") {
    const groups = pingGroups(c.messages);
    p.header.append(
      h("div", { class: "conv-avatar ping" }, icon("siren")),
      h("div", { class: "conv-title" }, h("h1", {}, t("Pings de flota")), h("div", { class: "conv-sub" }, S.settings.pingSenders.length ? t("{length} broadcasts · remitentes: {join}", { length: c.messages.length, join: S.settings.pingSenders.join(", ") }) : t("Sin remitentes configurados: añádelos en Preferencias → Pings de flota"))),
      h("input", {
        class: "input small",
        placeholder: t("Filtrar pings…"),
        value: p.filter.query,
        oninput: (e) => {
          p.filter.query = e.target.value;
          renderAllMessages(c, p);
        },
      }),
      h(
        "select",
        {
          class: "input small",
          onchange: (e) => {
            p.filter.group = e.target.value;
            renderAllMessages(c, p);
          },
        },
        h("option", { value: "" }, t("Todos los grupos")),
        groups.map((g) => h("option", { value: g, selected: g === p.filter.group }, g)),
      ),
      // Busca pings que llegaron con la app cerrada (registros de Pidgin y archivo del servidor), no solo redibuja.
      iconButton("refresh-cw", t("Buscar pings nuevos (en Pidgin y en el servidor)"), (e) => searchMissedPings(e.currentTarget)),
      // Solo se ve mientras se lee un ping en voz alta (clase tts-speaking en body).
      iconButton("volume-x", t("Dejar de leer el ping"), stopSpeaking, "tts-stop"),
      iconButton("settings", t("Configurar los pings de flota"), () => openSettings("pings")),
    );
    return;
  }
  if (c.type === "groupchat") {
    const r = roomState(c.accountId, c.conv);
    const room = acc?.rooms.find((x) => x.jid === c.conv);
    const status = r.joined ? `${r.occupants.size} participantes` : r.joining ? t("Entrando…") : r.error ? t("Error: {error}", { error: r.error }) : conn(c.accountId).state === "online" ? t("No estás en la sala") : t("Sin conexión");
    // Tema de la sala: plegado en una línea por defecto; el botón lo despliega y se recuerda por sala.
    const open = !!r.subject && topicOpen(c.conv);
    const subject = h("div", { class: `conv-sub subject ${open ? "open" : ""}`, title: r.subject || "", html: r.subject ? formatBody(r.subject).html : `<span class="muted">${esc(status)}</span>` });
    // Con permiso para cambiar el tema, una etiqueta pequeña abre el cuadro para editarlo (room-admin.js).
    const editTag = canEditTopic(r)
      ? h("button", { class: "topic-edit-tag", type: "button", title: t("Cambiar el tema de la sala"), onclick: () => openTopicEditor(c, p) }, icon(r.subject ? "pencil" : "plus"), r.subject ? t("editar") : t("añadir tema"))
      : null;
    const topicLabel = (isOpen) => (isOpen ? t("Plegar el tema de la sala") : t("Desplegar el tema de la sala"));
    // Siempre el mismo botón: solo cambian su icono, su texto y su estado.
    const topicBtn = r.subject
      ? iconButton(open ? "chevron-up" : "chevron-down", topicLabel(open), () => {
          const now = !subject.classList.contains("open");
          setTopicOpen(c.conv, now);
          subject.classList.toggle("open", now);
          subject.scrollTop = 0;
          topicBtn.replaceChildren(icon(now ? "chevron-up" : "chevron-down"));
          topicBtn.title = topicLabel(now);
          topicBtn.setAttribute("aria-label", topicLabel(now));
          topicBtn.classList.toggle("on", now);
        }, open ? "on" : "")
      : null;
    p.header.append(
      h("div", { class: `conv-avatar room ${r.joined ? "" : "off"}` }, icon("hash")),
      h(
        "div",
        { class: "conv-title" },
        h("h1", {}, convTitle(c), h("span", { class: "conv-jid" }, c.conv), h("span", { class: "chip" }, r.joined ? `${r.occupants.size}` : status)),
        editTag ? h("div", { class: "subject-row" }, subject, editTag) : subject,
      ),
      h(
        "div",
        { class: "conv-actions" },
        !r.joined && !r.joining ? h("button", { class: "btn small primary", onclick: () => rejoin(c) }, icon("log-in"), t("Entrar")) : null,
        topicBtn,
        iconButton("star", isFavorite(room) ? t("Favorita (clic para quitarla de la lista)") : t("Añadir a favoritas"), () => toggleFavorite(c.accountId, c.conv), isFavorite(room) ? "on star" : ""),
        iconButton("zap", room?.autojoin ? t("Se abre al iniciar (clic para desactivar)") : t("Abrir automáticamente al iniciar"), () => toggleAutojoin(c.accountId, c.conv), room?.autojoin ? "on zap" : ""),
        iconButton(notifyMode(c) === "none" ? "bell-off" : notifyMode(c) === "all" ? "bell-ring" : "bell", t("Notificaciones"), (e) => menuFor(e.currentTarget, convMenu(c).filter((x) => x.checked !== undefined || x.header))),
        iconButton("search", t("Buscar en el historial"), () => openSearch({ accountId: c.accountId, conv: c.conv })),
        iconButton("panel-right", t("Mostrar/ocultar participantes"), () => updateSettings((s) => (s.layout.showOccupants = !s.layout.showOccupants))),
        iconButton("ellipsis-vertical", t("Más opciones"), (e) => menuFor(e.currentTarget, convMenu(c))),
      ),
    );
    return;
  }
  const bare = c.conv.split("/")[0];
  const isMucPm = c.conv.includes("/");
  const ct = contact(c.accountId, bare);
  const pr = isMucPm ? { show: "online", status: "" } : bestPresence(ct);
  p.header.append(
    avatarEl(isMucPm ? c.conv : bare, convTitle(c), "conv-avatar", pr.show),
    h(
      "div",
      { class: "conv-title" },
      h("h1", {}, convTitle(c), h("span", { class: "conv-jid" }, isMucPm ? t("privado en {room}", { room: bare.split("@")[0] }) : bare)),
      h("div", { class: "conv-sub" }, h("span", { class: `presence-dot ${pr.show}` }), ` ${SHOW_LABEL[pr.show] || pr.show}`, pr.status ? h("span", { class: "muted", html: ` — ${formatBody(pr.status).html}` }) : null),
    ),
    h(
      "div",
      { class: "conv-actions" },
      iconButton("search", t("Buscar en el historial"), () => openSearch({ accountId: c.accountId, conv: c.conv })),
      iconButton("ellipsis-vertical", t("Más opciones"), (e) => menuFor(e.currentTarget, convMenu(c))),
    ),
  );
}

export function avatarEl(jid, name, cls = "", show) {
  const url = avatarUrl(jid);
  const el = h("div", { class: `avatar ${cls}`, dataset: { avatarFor: jid }, style: { "--avatar-color": nickColor(name) } });
  if (url) setAvatar(el, url);
  else el.textContent = initials(name);
  if (show) el.append(h("span", { class: `presence-dot ${show}` }));
  return el;
}

function setAvatar(el, url) {
  const dot = el.querySelector(".presence-dot");
  el.textContent = "";
  el.append(h("img", { src: url, alt: "", draggable: "false" }));
  if (dot) el.append(dot);
  el.classList.add("has-img");
}

// ---------- mensajes ----------

function sameGroup(prev, m) {
  if (!prev || prev.sys || m.sys) return false;
  if (prev.nick !== m.nick || !!prev.out !== !!m.out) return false;
  if (new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString()) return false;
  if (isAction(prev.body) || isAction(m.body)) return false;
  return m.ts - prev.ts < S.settings.behavior.groupMessagesMinutes * 60e3;
}

const isAction = (b) => /^\/me\s/.test(b || "");

// c.messages debe ir por orden de hora; si llegaron mensajes antiguos con la pestaña cerrada, se ordena aquí.
function ensureSorted(messages) {
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].ts < messages[i - 1].ts) return messages.sort((a, b) => a.ts - b.ts);
  }
  return messages;
}

// Último índice con ts <= el dado (búsqueda binaria; la lista está ordenada).
function indexAfter(messages, ts, end = messages.length) {
  let lo = 0;
  let hi = end;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (messages[mid].ts <= ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const dayOf = (ts) => new Date(ts).toDateString();
const isShown = (m) => !(m.sys && m.joinLeave && !S.settings.behavior.showJoinLeave);
const msgEl = (p, m) => p.list.querySelector(`.msg[data-key="${CSS.escape(m.key)}"]`);

// Coloca un mensaje antiguo en su sitio, en c.messages y en la lista, con su separador de día y su agrupado.
function insertOlder(c, p, m) {
  const msgs = c.messages;
  const at = msgs.lastIndexOf(m);
  if (at >= 0) msgs.splice(at, 1);
  const i = indexAfter(msgs, m.ts);
  msgs.splice(i, 0, m);
  let prev = null;
  for (let j = i - 1; j >= 0 && !prev; j--) if (isShown(msgs[j]) && msgEl(p, msgs[j])) prev = msgs[j];
  let next = null;
  let nextEl = null;
  for (let j = i + 1; j < msgs.length && !nextEl; j++) {
    if (!isShown(msgs[j])) continue;
    nextEl = msgEl(p, msgs[j]);
    if (nextEl) next = msgs[j];
  }
  if (!nextEl) return renderAllMessages(c, p);
  if (!prev && p.skipped) {
    p.skipped++;
    return;
  }
  p.list.querySelector(".empty-state")?.remove();
  const day = dayOf(m.ts);
  // Mismo día que el siguiente: va justo antes de él (su separador, si lo tiene, ya queda encima).
  // Otro día: va antes del separador del siguiente y lleva el suyo si el anterior es de otro día.
  let anchor = nextEl;
  const parts = [];
  if (day !== dayOf(next.ts)) {
    while (anchor.previousElementSibling?.matches(".day-sep, .unread-marker")) anchor = anchor.previousElementSibling;
    if (!prev || dayOf(prev.ts) !== day) parts.push(h("div", { class: "day-sep" }, h("span", {}, fmtDay(m.ts))));
  }
  parts.push(messageEl(c, m, sameGroup(prev, m)));
  anchor.before(...parts);
  // El siguiente puede pasar a ir agrupado con este (o dejar de estarlo).
  const cont = sameGroup(m, next);
  if (cont !== nextEl.classList.contains("cont")) nextEl.replaceWith(messageEl(c, next, cont));
}

// Mensajes que se pintan como mucho (unos 30 nodos cada uno). Los anteriores siguen en memoria y aparecen al subir.
const MAX_RENDERED = 1500;

function renderAllMessages(c, p, prependedCount) {
  ensureSorted(c.messages);
  const oldHeight = p.scroller.scrollHeight;
  const oldTop = p.scroller.scrollTop;
  clear(p.list);
  if (c.type === "pings") {
    const shown = c.messages.filter((m) => pingMatches(m, p.filter.query, p.filter.group)).slice(-400).reverse();
    if (!shown.length) p.list.append(h("div", { class: "empty-state" }, icon("radio"), h("p", {}, c.loaded ? t("No hay pings que mostrar.") : t("Cargando…"))));
    for (const m of shown) p.list.append(pingCard(m));
    p.lastRendered = null;
    p.scroller.scrollTop = 0;
    return;
  }
  // Al cargar más historial se pinta todo lo que hay en memoria; si no, solo los últimos MAX_RENDERED.
  const start = prependedCount ? 0 : Math.max(0, c.messages.length - MAX_RENDERED);
  p.skipped = start;
  if ((!c.exhausted || start) && c.messages.length) p.list.append(h("div", { class: "history-hint" }, t("Desplázate hacia arriba para cargar más")));
  else if (c.messages.length) p.list.append(h("div", { class: "history-hint" }, icon("history"), t(" Inicio del historial local")));
  if (!c.messages.length) {
    p.list.append(h("div", { class: "empty-state" }, icon(c.type === "groupchat" ? "hash" : "message-circle"), h("p", {}, c.type === "groupchat" ? t("Aún no hay mensajes en esta sala.") : t("Escribe el primer mensaje."))));
  }
  let prev = null;
  const frag = document.createDocumentFragment();
  for (let i = start; i < c.messages.length; i++) {
    const m = c.messages[i];
    if (m.sys && m.joinLeave && !S.settings.behavior.showJoinLeave) continue;
    if (!prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString()) frag.append(h("div", { class: "day-sep" }, h("span", {}, fmtDay(m.ts))));
    frag.append(messageEl(c, m, sameGroup(prev, m)));
    prev = m;
  }
  p.list.append(frag);
  p.lastRendered = prev;
  if (prependedCount) p.scroller.scrollTop = p.scroller.scrollHeight - oldHeight + oldTop;
  else if (p.atBottom !== false) scrollToBottom(p);
}

function appendMessage(c, m) {
  const p = panes.get(c.key);
  if (!p) return;
  if (c.type === "pings") {
    if (pingMatches(m, p.filter.query, p.filter.group)) {
      p.list.querySelector(".empty-state")?.remove();
      p.list.prepend(pingCard(m));
    }
    renderHeader(c, p);
    return;
  }
  if (m.sys && m.joinLeave && !S.settings.behavior.showJoinLeave) return;
  if (p.dirty || skipHidden(c, p)) return;
  // Mensajes de historial que llegan fuera de orden (historial de la sala, archivo del servidor…): se colocan
  // en su sitio. Antes se repintaba la sala entera por cada uno y una tanda podía colgar la ventana.
  if (p.lastRendered && m.ts < p.lastRendered.ts - 1000) return insertOlder(c, p, m);
  p.list.querySelector(".empty-state")?.remove();
  const prev = p.lastRendered;
  if (!prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString()) p.list.append(h("div", { class: "day-sep" }, h("span", {}, fmtDay(m.ts))));
  const el = messageEl(c, m, sameGroup(prev, m));
  if (!m.history && !m.delayed) el.classList.add("new");
  p.list.append(el);
  p.lastRendered = m;
  const visible = S.active === c.key;
  if (p.atBottom !== false || m.out) {
    trimTop(c, p);
    scrollToBottom(p);
  }
  else if (visible && !m.sys) {
    p.newCount++;
    p.jump.querySelector(".jump-count").textContent = t("{n} nuevos", { n: p.newCount });
    p.jump.classList.remove("hidden");
  }
  if (visible && S.focused) markRead(c.key);
}

// Con la lista abajo del todo, quita por arriba lo que pase de MAX_RENDERED (sesiones largas en salas activas).
function trimTop(c, p) {
  const msgs = p.list.querySelectorAll(".msg");
  const extra = msgs.length - MAX_RENDERED;
  if (extra < 100) return;
  const keep = msgs[extra];
  while (keep.previousElementSibling && !keep.previousElementSibling.matches(".history-hint")) keep.previousElementSibling.remove();
  // El primero que queda lleva su separador de día y no va agrupado con uno que ya no se ve.
  const m = c.messages.find((x) => x.key === keep.dataset.key);
  const first = m && keep.classList.contains("cont") ? messageEl(c, m, false) : keep;
  if (first !== keep) keep.replaceWith(first);
  if (m) first.before(h("div", { class: "day-sep" }, h("span", {}, fmtDay(m.ts))));
  p.skipped = m ? c.messages.indexOf(m) : p.skipped;
  const hint = p.list.querySelector(".history-hint");
  if (hint && !hint.querySelector(".icon")) return;
  hint?.replaceWith(h("div", { class: "history-hint" }, t("Desplázate hacia arriba para cargar más")));
}

function updateMessage(c, m) {
  const p = panes.get(c.key);
  if (p?.dirty) return;
  const el = p?.list.querySelector(`.msg[data-key="${CSS.escape(m.key)}"]`);
  if (!el) return;
  el.replaceWith(messageEl(c, m, el.classList.contains("cont")));
}

function insertUnreadMarker(c, p) {
  p.list.querySelector(".unread-marker")?.remove();
  const el = p.list.querySelector(`.msg[data-key="${CSS.escape(c.firstUnreadKey)}"]`);
  if (!el) return;
  el.before(h("div", { class: "unread-marker" }, h("span", {}, t("Mensajes nuevos"))));
  if (p.atBottom !== false) {
    requestAnimationFrame(() => el.scrollIntoView({ block: "center" }));
    p.atBottom = false;
  }
}

function senderJid(c, m) {
  if (c.type === "groupchat") return `${c.conv}/${m.nick}`;
  if (m.out) return account(c.accountId)?.jid;
  return c.conv;
}

function messageEl(c, m, cont) {
  const tip = fmtTimes(m.ts);
  if (m.sys) {
    return h(
      "div",
      { class: `msg sys ${m.kind || ""}`, dataset: { key: m.key } },
      icon(m.icon || "info", "sys-icon"),
      h("span", { class: "sys-text", html: formatBody(m.body).html }),
      localTime(m.ts, "", tip),
      eveTime(m.ts, tip),
    );
  }
  const action = isAction(m.body);
  const body = action ? m.body.replace(/^\/me\s/, "") : m.body;
  const { quote, rest } = splitQuote(body);
  const where = c.type === "chat" ? "private" : "rooms";
  const rule = m.out ? null : matchRule(m.body, where);
  const fb = formatBody(rest, { mentionWords: m.out ? [] : mentionWords(c), rules: m.out ? [] : highlightRules(where) });
  const color = nickColor(m.nick);
  const avatar = avatarEl(senderJid(c, m), m.nick, "msg-avatar");
  const bodyEl = h(
    "div",
    { class: `msg-body ${fb.jumbo ? "jumbo" : ""}` },
    quote ? h("blockquote", { html: formatBody(quote).html }) : null,
    action ? h("span", { class: "action-nick", style: { color } }, `* ${m.nick} `) : null,
    h("span", { class: "msg-text", html: fb.html }),
    m.edited ? h("span", { class: "edited", title: t("Mensaje corregido") }, " (editado)") : null,
  );
  const previews = [...fb.previews];
  if (m.oob && !previews.some((x) => x.url === m.oob)) previews.push({ type: /\.(png|jpe?g|gif|webp)$/i.test(m.oob) ? "image" : "link", url: m.oob });
  const prevEl = previews.length && S.settings.behavior.linkPreviews ? h("div", { class: "msg-previews", html: previews.map(previewHtml).join("") }) : null;

  return h(
    "div",
    {
      class: `msg ${cont ? "cont" : ""} ${m.out ? "out" : "in"} ${m.mention ? "mention" : ""} ${rule ? "kw" : ""} ${action ? "action" : ""} ${m.delayed ? "delayed" : ""}`,
      dataset: { key: m.key, nick: m.nick },
      style: { "--nick": color, ...(rule ? { "--kw": rule.color } : {}) },
    },
    avatar,
    h(
      "div",
      { class: "msg-main" },
      h(
        "div",
        { class: "msg-head" },
        h("span", { class: "msg-nick", dataset: { nick: m.nick } }, m.nick),
        localTime(m.ts, "msg-time", tip),
        eveTime(m.ts, tip),
        m.out && c.type === "chat" ? h("span", { class: `receipt ${m.received ? "ok" : ""}`, title: m.received ? t("Entregado") : t("Enviado") }, icon(m.received ? "check-check" : "check")) : null,
      ),
      bodyEl,
      prevEl,
    ),
    h("time", { class: "msg-time-side", title: tip }, S.settings.showLocalTime !== false ? fmtTime(m.ts) : null, S.settings.showEveTime !== false ? h("span", { class: "eve-side" }, fmtEve(m.ts)) : null),
    h(
      "div",
      { class: "msg-actions" },
      iconButton("reply", t("Citar"), () => quoteMessage(c, m)),
      c.type === "groupchat" && !m.out ? iconButton("at-sign", t("Mencionar"), () => insertMention(c, m.nick)) : null,
      iconButton("copy", t("Copiar"), () => navigator.clipboard.writeText(m.body)),
      m.out && m.id ? iconButton("pencil", t("Corregir"), () => startEdit(c, m)) : null,
    ),
  );
}

// Hora local y hora EVE: cada una se puede ocultar en Preferencias → Mensajes → Hora.
// tip: el texto del tooltip, calculado una vez por mensaje.
function localTime(ts, cls, tip = fmtTimes(ts)) {
  if (S.settings.showLocalTime === false) return null;
  return h("time", { class: cls, title: tip }, fmtTime(ts));
}

// Hora EVE junto a la local, con otro estilo para distinguirlas.
function eveTime(ts, tip = fmtTimes(ts)) {
  if (S.settings.showEveTime === false) return null;
  return h("time", { class: "msg-eve", title: tip }, t("EVE {eve}", { eve: fmtEve(ts) }));
}

function splitQuote(body) {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].startsWith(">")) i++;
  if (!i) return { quote: "", rest: body };
  return { quote: lines.slice(0, i).map((l) => l.replace(/^>\s?/, "")).join("\n"), rest: lines.slice(i).join("\n") };
}

export function markReceipt(accountId, conv, id) {
  const c = S.convs.get(`${accountId}|${conv}`);
  const m = c?.messages.find((x) => x.id === id && x.out);
  if (!m || m.received) return;
  m.received = true;
  updateMessage(c, m);
}

function messageMenu(c, m) {
  return [
    { label: t("Copiar texto"), icon: "copy", action: () => navigator.clipboard.writeText(m.body) },
    { label: t("Citar"), icon: "quote", action: () => quoteMessage(c, m) },
    c.type === "groupchat" && !m.out ? { label: t("Mencionar a {nick}", { nick: m.nick }), icon: "at-sign", action: () => insertMention(c, m.nick) } : null,
    c.type === "groupchat" && !m.out ? { label: t("Mensaje privado"), icon: "message-square", action: () => openConv(c.accountId, `${c.conv}/${m.nick}`, "chat") } : null,
    m.out && m.id ? { label: t("Corregir mensaje"), icon: "pencil", action: () => startEdit(c, m) } : null,
    "-",
    { label: t("Local: {dateTime}", { dateTime: fmtDateTime(m.ts) }), icon: "clock", disabled: true },
    { label: t("EVE: {eve} (UTC)", { eve: fmtEve(m.ts, true) }), icon: "globe", disabled: true },
  ];
}

function onListClick(c, e) {
  const a = e.target.closest("a[href]");
  if (a) {
    e.preventDefault();
    const href = a.getAttribute("href");
    if (href.startsWith("xmpp:")) return handleXmppUri(c.accountId, href);
    api("shell:open", href);
    return;
  }
  const nick = e.target.closest(".msg-nick");
  if (nick && c.type === "groupchat") insertMention(c, nick.dataset.nick);
}

function handleXmppUri(accountId, uri) {
  const m = uri.match(/^xmpp:([^?]+)(\?(\w+))?/);
  if (!m) return;
  const jid = decodeURIComponent(m[1]).toLowerCase();
  if (m[3] === "join" || jid.includes("@conference.")) openConv(accountId, jid, "groupchat");
  else openConv(accountId, jid, "chat");
}

// ---------- escritura ----------

function insertMention(c, nick) {
  const p = panes.get(c.key);
  if (!p?.composer) return;
  const ta = p.composer.ta;
  const prefix = ta.value.trim() ? `${nick} ` : `${nick}: `;
  insertAtCursor(ta, prefix);
}

function quoteMessage(c, m) {
  const p = panes.get(c.key);
  if (!p?.composer) return;
  const quoted = m.body.split("\n").map((l) => `> ${l}`).join("\n");
  const ta = p.composer.ta;
  ta.value = `${quoted}\n${ta.value}`;
  ta.dispatchEvent(new Event("input"));
  ta.focus();
}

function startEdit(c, m) {
  const p = panes.get(c.key);
  if (!p?.composer) return;
  p.composer.setEditing(m);
}

function insertAtCursor(ta, text) {
  const s = ta.selectionStart;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(ta.selectionEnd);
  ta.selectionStart = ta.selectionEnd = s + text.length;
  ta.dispatchEvent(new Event("input"));
  ta.focus();
}

function renderTyping(c, p) {
  const names = [...c.typing.entries()].filter(([, st]) => st.state === "composing").map(([n]) => n);
  p.typing.innerHTML = "";
  if (!names.length) return p.typing.classList.remove("show");
  p.typing.classList.add("show");
  const label = names.length === 1 ? t("{x} está escribiendo", { x: names[0] }) : names.length <= 3 ? t("{join} están escribiendo", { join: names.join(", ") }) : t("Varias personas están escribiendo");
  p.typing.append(h("span", { class: "typing-dots" }, h("i"), h("i"), h("i")), h("span", {}, label));
}

function buildComposer(c, p) {
  const ta = h("textarea", { class: "composer-input", rows: 1, placeholder: placeholderFor(c), spellcheck: S.settings.behavior.spellcheck ? "true" : "false" });
  const suggest = h("div", { class: "suggest hidden" });
  const editBar = h("div", { class: "edit-bar hidden" });
  const emojiBtn = iconButton("smile-plus", t("Emojis"), () => openPicker(emojiBtn, (e) => insertAtCursor(ta, e)), "emoji-toggle");
  // GIF: se envía al momento, con la URL como cuerpo y como adjunto (XEP-0066).
  const gifBtn = h("button", { class: "icon-btn gif-toggle", type: "button", title: t("GIFs") }, "GIF");
  gifBtn.onclick = () =>
    openGifPicker(gifBtn, async (url) => {
      try {
        await api("msg:send", c.accountId, { to: c.conv, body: url, oob: url, type: c.type === "groupchat" ? "groupchat" : "chat" });
        playSound("sent");
      } catch (e) {
        toast(t("No se pudo enviar: {message}", { message: e.message }), { kind: "error" });
      }
    });
  const sendBtn = iconButton("send", t("Enviar (Intro)"), () => submit(), "send-btn");
  const el = h("div", { class: "composer" }, editBar, suggest, h("div", { class: "composer-box" }, emojiBtn, gifBtn, ta, sendBtn));

  let editing = null;
  let typingState = "active";
  let typingTimer = null;
  let completion = null;
  let suggestions = [];
  let selIndex = 0;
  const sentHistory = [];
  let histIndex = -1;

  ta.value = c.draft || "";

  function autosize() {
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 260)}px`;
  }

  function setEditing(m) {
    editing = m;
    if (m) {
      ta.value = m.body;
      editBar.classList.remove("hidden");
      clear(editBar).append(icon("pencil"), h("span", {}, t("Corrigiendo mensaje — Esc para cancelar")), iconButton("x", t("Cancelar"), () => setEditing(null)));
    } else {
      editBar.classList.add("hidden");
      ta.value = "";
    }
    autosize();
    ta.focus();
  }

  function sendTyping(state) {
    if (c.type !== "chat" || !S.settings.behavior.sendTyping || typingState === state) return;
    typingState = state;
    api("chatstate:send", c.accountId, c.conv, state, false).catch(() => {});
  }

  function updateSuggestions() {
    const before = ta.value.slice(0, ta.selectionStart);
    const m = before.match(/(?:^|\s):([a-z0-9_+-]{2,})$/i);
    const cmd = before.match(/^\/([a-z]*)$/i);
    suggestions = cmd ? commandSuggestions(cmd[1], c) : m ? shortcodeSuggestions(m[1]) : [];
    selIndex = 0;
    renderSuggest();
  }

  function renderSuggest() {
    clear(suggest);
    suggest.classList.toggle("hidden", !suggestions.length);
    suggestions.forEach((s, i) => {
      suggest.append(
        h(
          "button",
          { class: `suggest-item ${i === selIndex ? "sel" : ""}`, type: "button", onmousedown: (e) => (e.preventDefault(), applySuggestion(i)) },
          ...(s.command
            ? [h("span", { class: "suggest-cmd" }, s.usage), h("span", { class: "muted" }, s.desc)]
            : [s.custom ? h("img", { class: "emoji custom", src: s.url }) : h("span", { html: emojifyHtml(s.emoji) }), h("span", {}, `:${s.code}:`)]),
        ),
      );
    });
  }

  function applySuggestion(i) {
    const s = suggestions[i];
    if (!s) return;
    const pos = ta.selectionStart;
    const before = s.command ? `/${s.command} ` : ta.value.slice(0, pos).replace(/:([a-z0-9_+-]{2,})$/i, s.custom ? `:${s.code}: ` : `${s.emoji} `);
    ta.value = before + ta.value.slice(pos);
    ta.selectionStart = ta.selectionEnd = before.length;
    suggestions = [];
    renderSuggest();
    ta.dispatchEvent(new Event("input"));
  }

  function completeNick(backwards) {
    if (c.type !== "groupchat") return false;
    const r = roomState(c.accountId, c.conv);
    if (!completion) {
      const pos = ta.selectionStart;
      const before = ta.value.slice(0, pos);
      const m = before.match(/(\S*)$/);
      const word = m[1].replace(/^@/, "");
      if (!word) return false;
      const recent = [...c.messages].reverse().map((x) => x.nick);
      const nicks = [...r.occupants.keys()].filter((n) => n !== r.nick && n.toLowerCase().startsWith(word.toLowerCase()));
      nicks.sort((a, b) => (recent.indexOf(a) === -1 ? 1e9 : recent.indexOf(a)) - (recent.indexOf(b) === -1 ? 1e9 : recent.indexOf(b)) || a.localeCompare(b));
      if (!nicks.length) return true;
      completion = { start: pos - m[1].length, end: pos, nicks, i: -1, atStart: before.length === m[1].length, after: ta.value.slice(pos) };
    }
    completion.i = (completion.i + (backwards ? -1 : 1) + completion.nicks.length) % completion.nicks.length;
    const nick = completion.nicks[completion.i];
    const ins = completion.atStart ? `${nick}: ` : `${nick} `;
    ta.value = ta.value.slice(0, completion.start) + ins + completion.after;
    ta.selectionStart = ta.selectionEnd = completion.start + ins.length;
    autosize();
    return true;
  }

  async function submit() {
    const text = ta.value.replace(/\s+$/, "");
    if (!text.trim()) return;
    if (editing) {
      const m = editing;
      setEditing(null);
      try {
        await api("msg:send", c.accountId, { to: c.conv, body: text, type: c.type === "groupchat" ? "groupchat" : "chat", replaces: m.id });
      } catch (e) {
        toast(t("No se pudo corregir: {message}", { message: e.message }), { kind: "error" });
      }
      return;
    }
    let sayBody = null;
    if (text.startsWith("/") && !text.startsWith("//") && !isAction(text)) {
      const handled = await runCommand(c, text);
      if (handled?.say != null) sayBody = handled.say;
      else if (handled) {
        sentHistory.unshift(text);
        ta.value = "";
        c.draft = "";
        autosize();
        return;
      }
    }
    const body = sayBody ?? (text.startsWith("//") ? text.slice(1) : text);
    if (conn(c.accountId).state !== "online") return toast(t("No hay conexión con el servidor."), { kind: "error" });
    if (c.type === "groupchat" && !roomState(c.accountId, c.conv).joined) return toast(t("No estás dentro de la sala."), { kind: "warn" });
    ta.value = "";
    c.draft = "";
    autosize();
    sentHistory.unshift(body);
    histIndex = -1;
    typingState = "active";
    clearTimeout(typingTimer);
    try {
      await api("msg:send", c.accountId, { to: c.conv, body, type: c.type === "groupchat" ? "groupchat" : "chat" });
      playSound("sent");
    } catch (e) {
      ta.value = body;
      autosize();
      toast(t("No se pudo enviar: {message}", { message: e.message }), { kind: "error" });
    }
  }

  ta.addEventListener("input", () => {
    c.draft = ta.value;
    autosize();
    updateSuggestions();
    if (ta.value) {
      sendTyping("composing");
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => sendTyping("paused"), 5000);
    } else {
      clearTimeout(typingTimer);
      sendTyping("active");
    }
  });

  ta.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") completion = null;
    if (suggestions.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        selIndex = (selIndex + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
        return renderSuggest();
      }
      // Con un comando ya escrito entero, Enter lo envía en vez de completarlo.
      const typedCommand = suggestions[0]?.command && suggestions.some((s) => ta.value.trim().toLowerCase() === `/${s.command}`);
      if (e.key === "Enter" && typedCommand) {
        suggestions = [];
        renderSuggest();
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        return applySuggestion(selIndex);
      }
      if (e.key === "Escape") {
        suggestions = [];
        return renderSuggest();
      }
    }
    if (e.key === "Tab" && !e.ctrlKey) {
      if (completeNick(e.shiftKey)) e.preventDefault();
      return;
    }
    const enterSends = S.settings.behavior.enterToSend ? e.key === "Enter" && !e.shiftKey : e.key === "Enter" && e.ctrlKey;
    if (enterSends && !e.isComposing) {
      e.preventDefault();
      return submit();
    }
    if (e.key === "Escape" && editing) {
      e.preventDefault();
      return setEditing(null);
    }
    if (e.key === "ArrowUp" && !e.shiftKey && (!ta.value || (e.ctrlKey && histIndex >= 0))) {
      // Ctrl+↑ recorre lo enviado; ↑ con el campo vacío corrige el último mensaje propio.
      if (e.ctrlKey) {
        if (!sentHistory.length) return;
        e.preventDefault();
        histIndex = Math.min(histIndex + 1, sentHistory.length - 1);
        ta.value = sentHistory[histIndex];
        autosize();
        return;
      }
      const last = [...c.messages].reverse().find((m) => m.out && m.id && !m.sys);
      if (last) {
        e.preventDefault();
        setEditing(last);
      }
    }
  });

  ta.addEventListener("paste", (e) => {
    if ([...(e.clipboardData?.items || [])].some((i) => i.kind === "file")) {
      e.preventDefault();
      toast(t("Enviar archivos aún no está disponible en este servidor."), { kind: "warn" });
    }
  });

  setTimeout(autosize, 0);
  return { el, ta, focus: () => ta.focus(), setEditing };
}

function placeholderFor(c) {
  if (c.type === "groupchat") return t("Mensaje en #{convTitle} — / para comandos, Tab completa apodos", { convTitle: convTitle(c) });
  return t("Mensaje para {convTitle}", { convTitle: convTitle(c) });
}

// ---------- comandos ----------

// Los de Pidgin para XMPP, con los mismos nombres. where: "room" (solo en salas), "chat" (solo en privados) o "any".
// Se construye al usarse para que siga el idioma elegido.
function commandList() {
  return [
    { name: "me", usage: t("/me <acción>"), desc: t("Mensaje de acción"), where: "any" },
    { name: "say", usage: t("/say <texto>"), desc: t("Enviar el texto tal cual, aunque empiece por /"), where: "any" },
    { name: "nick", usage: t("/nick <apodo>"), desc: t("Cambiar tu apodo en la sala"), where: "room" },
    { name: "topic", usage: t("/topic [tema | -]"), desc: t("Ver el tema, cambiarlo o quitarlo con «-»"), where: "room" },
    { name: "join", usage: t("/join <sala> [contraseña]"), desc: t("Entrar en una sala (se completa @conference)"), where: "any" },
    { name: "part", usage: t("/part [motivo]"), desc: t("Salir de la sala actual"), where: "room" },
    { name: "msg", usage: t("/msg <apodo|jid> <texto>"), desc: t("Mensaje privado"), where: "any" },
    { name: "query", usage: t("/query <apodo|jid>"), desc: t("Abrir conversación privada"), where: "any" },
    { name: "invite", usage: "/invite <jid>", desc: t("Invitar a la sala"), where: "room" },
    { name: "kick", usage: t("/kick <apodo> [motivo]"), desc: t("Expulsar (moderadores)"), where: "room" },
    { name: "ban", usage: t("/ban <apodo|jid> [motivo]"), desc: t("Vetar (administradores)"), where: "room" },
    { name: "unban", usage: "/unban <jid>", desc: t("Quitar un veto (administradores)"), where: "room" },
    { name: "role", usage: t("/role <moderator|participant|visitor|none> <apodo>"), desc: t("Cambiar el rol de alguien en la sala (moderadores)"), where: "room" },
    { name: "affiliate", usage: t("/affiliate <owner|admin|member|outcast|none> <apodo|jid>"), desc: t("Cambiar la afiliación de alguien (administradores)"), where: "room" },
    { name: "config", usage: "/config", desc: t("Configuración de la sala (propietarios)"), where: "room" },
    { name: "ping", usage: t("/ping [apodo|jid]"), desc: t("Comprobar si alguien (o la sala) responde y cuánto tarda"), where: "any" },
    { name: "buzz", usage: t("/buzz [apodo]"), desc: t("Llamar la atención de alguien en privado"), where: "any" },
    { name: "status", usage: t("/status <online|away|dnd|xa> [mensaje]"), desc: t("Cambiar estado"), where: "any" },
    { name: "away", usage: t("/away [mensaje]  ·  /back"), desc: t("Ausente / disponible"), where: "any" },
    { name: "clear", usage: "/clear", desc: t("Limpiar la ventana (no borra el historial)"), where: "any" },
    { name: "help", usage: "/help", desc: t("Esta ayuda"), where: "any" },
  ];
}

const fits = (cmd, c) => cmd.where === "any" || (cmd.where === "room") === (c.type === "groupchat");

// Sugerencias al escribir «/…» en el compositor.
function commandSuggestions(prefix, c) {
  const p = prefix.toLowerCase();
  return commandList()
    .filter((x) => x.name.startsWith(p) && fits(x, c))
    .slice(0, 8)
    .map((x) => ({ command: x.name, usage: x.usage, desc: x.desc }));
}

const ROLES = ["moderator", "participant", "visitor", "none"];
const AFFILIATIONS = ["owner", "admin", "member", "outcast", "none"];
const roleName = (r) => ({ moderator: t("moderador"), participant: t("participante"), visitor: t("visitante"), none: t("sin rol (fuera de la sala)") })[r] || r;
const affiliationName = (a) => ({ owner: t("propietario"), admin: t("administrador"), member: t("miembro"), outcast: t("vetado"), none: t("sin afiliación") })[a] || a;

async function runCommand(c, text) {
  const [cmdRaw, ...restArr] = text.slice(1).split(" ");
  const cmd = cmdRaw.toLowerCase();
  const rest = restArr.join(" ").trim();
  const acc = account(c.accountId);
  const isRoom = c.type === "groupchat";
  const rs = isRoom ? roomState(c.accountId, c.conv) : null;
  const need = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };
  const ok = (msg) => systemMessage(c, msg, { icon: "check" });
  // Un apodo de la sala o una dirección: devuelve { nick, jid } (jid real si se conoce).
  const who = (target) => {
    if (target.includes("@")) return { nick: "", jid: target.toLowerCase() };
    const occ = rs?.occupants.get(target);
    return { nick: target, jid: occ?.jid ? occ.jid.split("/")[0] : "" };
  };
  try {
    switch (cmd) {
      case "help":
        systemMessage(c, commandList().filter((x) => fits(x, c)).map((x) => `${x.usage} — ${x.desc}`).join("\n"), { icon: "keyboard" });
        return true;
      case "clear":
        c.messages = [];
        c.exhausted = false;
        renderAllMessages(c, panes.get(c.key));
        return true;
      case "say":
        need(rest, t("Uso: /say <texto>"));
        return { say: rest };
      case "nick":
        need(isRoom && rest, t("Uso: /nick <apodo> (dentro de una sala)"));
        await api("room:nick", c.accountId, c.conv, rest);
        return true;
      case "topic":
      case "subject":
        need(isRoom, t("Solo en salas"));
        if (!rest) {
          systemMessage(c, t("Tema: {x}", { x: rs.subject || t("(sin tema)") }), { icon: "info" });
          return true;
        }
        need(rs.joined, t("No estás dentro de la sala."));
        // Si ya sabemos que no hay permiso, se avisa sin preguntar al servidor.
        need(canEditTopic(rs), t("No tienes permiso para cambiar el tema de esta sala. Pídeselo a un moderador."));
        await setTopic(c, rest === "-" ? "" : rest);
        return true;
      case "join": {
        need(rest, t("Uso: /join <sala> [contraseña]"));
        const [room, password] = rest.split(" ");
        const jid = room.includes("@") ? room.toLowerCase() : `${room.toLowerCase()}@${acc.conferenceServer}`;
        await openConv(c.accountId, jid, "groupchat", { password });
        return true;
      }
      case "part":
      case "leave":
        need(isRoom, t("Solo en salas"));
        closeConv(c.key);
        return true;
      case "msg":
      case "query": {
        const [target, ...msgArr] = rest.split(" ");
        need(target, t("Uso: /{cmd} <apodo|jid> [texto]", { cmd }));
        const jid = target.includes("@") ? target.toLowerCase() : isRoom ? `${c.conv}/${target}` : `${target.toLowerCase()}@${acc.jid.split("@")[1]}`;
        await openConv(c.accountId, jid, "chat");
        if (msgArr.length) await api("msg:send", c.accountId, { to: jid, body: msgArr.join(" "), type: "chat" });
        return true;
      }
      case "invite":
        need(isRoom && rest, t("Uso: /invite <jid>"));
        await api("room:invite", c.accountId, c.conv, rest, "");
        ok(t("Invitación enviada a {rest}", { rest }));
        return true;
      case "kick": {
        need(isRoom, t("Solo en salas"));
        const [nick, ...reason] = rest.split(" ");
        need(nick, t("Uso: /kick <apodo> [motivo]"));
        need(rs.occupants.has(nick), t("No hay nadie con el apodo «{nick}» en la sala.", { nick }));
        await api("room:moderate", c.accountId, c.conv, { nick, role: "none", reason: reason.join(" ") });
        ok(t("Has expulsado a {nick}.", { nick }));
        return true;
      }
      case "ban": {
        need(isRoom, t("Solo en salas"));
        const [target, ...reason] = rest.split(" ");
        need(target, t("Uso: /ban <apodo|jid> [motivo]"));
        const { jid } = who(target);
        need(jid, t("No se conoce el JID real de ese usuario (sala semi-anónima)."));
        await api("room:moderate", c.accountId, c.conv, { jid, affiliation: "outcast", reason: reason.join(" ") });
        ok(t("Has vetado a {who}.", { who: target }));
        return true;
      }
      case "unban":
        need(isRoom, t("Solo en salas"));
        need(rest.includes("@"), t("Uso: /unban <jid>"));
        await api("room:moderate", c.accountId, c.conv, { jid: rest.split(" ")[0].toLowerCase(), affiliation: "none" });
        ok(t("Se ha quitado el veto a {jid}.", { jid: rest.split(" ")[0] }));
        return true;
      case "role": {
        need(isRoom, t("Solo en salas"));
        const [role, nick, ...reason] = rest.split(" ");
        need(ROLES.includes(role?.toLowerCase()) && nick, t("Uso: /role <moderator|participant|visitor|none> <apodo>"));
        need(rs.occupants.has(nick), t("No hay nadie con el apodo «{nick}» en la sala.", { nick }));
        await api("room:moderate", c.accountId, c.conv, { nick, role: role.toLowerCase(), reason: reason.join(" ") });
        ok(t("{nick} ahora es {role}.", { nick, role: roleName(role.toLowerCase()) }));
        return true;
      }
      case "affiliate":
      case "affiliation": {
        need(isRoom, t("Solo en salas"));
        const [aff, target, ...reason] = rest.split(" ");
        need(AFFILIATIONS.includes(aff?.toLowerCase()) && target, t("Uso: /affiliate <owner|admin|member|outcast|none> <apodo|jid>"));
        const { jid } = who(target);
        need(jid, t("No se conoce el JID real de ese usuario (sala semi-anónima)."));
        await api("room:moderate", c.accountId, c.conv, { jid, affiliation: aff.toLowerCase(), reason: reason.join(" ") });
        ok(t("{who} ahora es {affiliation}.", { who: target, affiliation: affiliationName(aff.toLowerCase()) }));
        return true;
      }
      case "config":
      case "configure":
        need(isRoom, t("Solo en salas"));
        need(canConfigureRoom(rs), t("Solo los propietarios de la sala pueden cambiar su configuración."));
        await openRoomConfig(c);
        return true;
      case "ping": {
        const target = rest.split(" ")[0];
        // Sin nada: la persona del privado o la propia sala. En una sala, un apodo es alguien de la sala.
        const to = !target ? c.conv : target.includes("@") ? target : isRoom ? `${c.conv}/${target}` : `${target.toLowerCase()}@${acc.jid.split("@")[1]}`;
        const label = target || convTitle(c);
        const r = await api("xmpp:ping", c.accountId, to);
        systemMessage(
          c,
          r.supported ? t("{who} responde en {ms} ms.", { who: label, ms: r.ms }) : t("{who} está conectado ({ms} ms), aunque su programa no contesta a los ping.", { who: label, ms: r.ms }),
          { icon: "wifi" },
        );
        return true;
      }
      case "buzz":
      case "attention": {
        const target = rest.split(" ")[0];
        need(!isRoom || target, t("Uso: /buzz <apodo> (en una sala) o /buzz en un privado"));
        const to = isRoom ? `${c.conv}/${target}` : target ? (target.includes("@") ? target : `${target.toLowerCase()}@${acc.jid.split("@")[1]}`) : c.conv;
        await api("msg:attention", c.accountId, to);
        ok(t("Has llamado la atención de {who}.", { who: target || convTitle(c) }));
        return true;
      }
      case "status":
      case "away":
      case "back":
      case "dnd": {
        let show = "";
        let msg = rest;
        if (cmd === "away") show = "away";
        else if (cmd === "dnd") show = "dnd";
        else if (cmd === "status") {
          const [s, ...m] = rest.split(" ");
          show = { online: "", available: "", away: "away", dnd: "dnd", xa: "xa", chat: "chat" }[s?.toLowerCase()] ?? "";
          msg = m.join(" ");
        }
        await api("presence:set", c.accountId, show, msg);
        return true;
      }
      default:
        systemMessage(c, t("Comando desconocido: /{cmd}. Escribe /help para ver la lista, o empieza con // para enviar el texto tal cual.", { cmd }), { icon: "triangle-alert" });
        return true;
    }
  } catch (e) {
    systemMessage(c, e.message, { icon: "triangle-alert" });
    return true;
  }
}

export { getConv };

// Salas con el tema desplegado (preferencia de este equipo).
const TOPIC_KEY = "evex.topicOpen";
function topicOpen(room) {
  try {
    return JSON.parse(localStorage.getItem(TOPIC_KEY) || "[]").includes(room);
  } catch {
    return false;
  }
}
function setTopicOpen(room, open) {
  try {
    const set = new Set(JSON.parse(localStorage.getItem(TOPIC_KEY) || "[]"));
    if (open) set.add(room);
    else set.delete(room);
    localStorage.setItem(TOPIC_KEY, JSON.stringify([...set]));
  } catch {}
}
