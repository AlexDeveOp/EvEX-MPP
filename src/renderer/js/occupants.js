// Panel lateral derecho: participantes de la sala activa, agrupados por rol.
import { S, api, on, roomState, convKey } from "./state.js";
import { h, icon, $, showMenu, toast, prompt, rafThrottle, keepHover, morphChildren } from "./dom.js";
import { openConv } from "./convs.js";
import { avatarEl } from "./chat.js";
import { SHOW_LABEL } from "./state.js";

import { t } from "./i18n.js";
let filter = "";
let reapplyHover = null;

export function initOccupants() {
  reapplyHover = keepHover($("#occ-list"), ".occ-item[data-key]");
  const render = rafThrottle(renderOccupants);
  for (const evt of ["active", "occupants", "settings", "avatar"]) on(evt, render);
  // Los cambios de otras salas no tocan la lista de la sala visible.
  on("room", (e) => (!e?.room || convKey(e.accountId, e.room) === S.active) && render());
  $("#occ-filter").addEventListener("input", (e) => {
    filter = e.target.value.trim().toLowerCase();
    renderOccupants();
  });
  renderOccupants();
}

const ROLE_GROUPS = [
  ["moderator", t("Moderadores")],
  ["participant", t("Participantes")],
  ["visitor", t("Visitantes")],
];
const AFF_ICON = { owner: "crown", admin: "shield", member: null };

// Tras repintar, la fila bajo el ratón sigue señalada (la lista cambia cada vez que alguien entra o sale).
function renderOccupants() {
  drawOccupants();
  reapplyHover?.();
}

function drawOccupants() {
  const c = S.active && S.convs.get(S.active);
  const panel = $("#occupants");
  const list = $("#occ-list");
  const isRoom = c?.type === "groupchat";
  panel.classList.toggle("hidden", !isRoom);
  document.getElementById("app").classList.toggle("no-occupants-panel", !isRoom);
  if (!isRoom) return;
  const r = roomState(c.accountId, c.conv);
  $("#occ-count").textContent = r.occupants.size;
  const scroll = list.scrollTop;
  // Se construye fuera de la página y solo se tocan las filas que cambian.
  const next = document.createElement("div");
  if (!r.joined) {
    next.append(h("div", { class: "sb-empty" }, r.joining ? t("Entrando en la sala…") : t("No estás en la sala")));
    return morphChildren(list, next);
  }
  const occ = [...r.occupants.values()].filter((o) => !filter || o.nick.toLowerCase().includes(filter) || o.jid?.includes(filter));
  for (const [role, title] of ROLE_GROUPS) {
    const items = occ.filter((o) => (o.role === role) || (role === "participant" && !["moderator", "visitor"].includes(o.role)));
    if (!items.length) continue;
    items.sort((a, b) => (a.show ? 1 : 0) - (b.show ? 1 : 0) || a.nick.localeCompare(b.nick, undefined, { sensitivity: "base" }));
    next.append(h("div", { class: "occ-group" }, h("span", {}, title), h("span", { class: "sb-count" }, items.length)));
    for (const o of items) next.append(occupantItem(c, r, o));
  }
  morphChildren(list, next);
  list.scrollTop = scroll;
}

function mention(nick) {
  const ta = document.querySelector(".conv-pane.active .composer-input");
  if (!ta) return;
  ta.value = ta.value.trim() ? `${ta.value.replace(/\s*$/, " ")}${nick} ` : `${nick}: `;
  ta.dispatchEvent(new Event("input"));
  ta.focus();
}

function occupantItem(c, r, o) {
  const typing = c.typing.get(o.nick)?.state === "composing";
  return h(
    "div",
    {
      "data-key": o.nick,
      class: `occ-item ${o.show || "online"} ${o.self ? "self" : ""}`,
      title: t("{nick}{x}\n{x2}{x3}\nRol: {role} · Afiliación: {affiliation}", { nick: o.nick, x: o.jid ? `\n${o.jid}` : "", x2: SHOW_LABEL[o.show || "online"], x3: o.status ? ` — ${o.status}` : "", role: o.role, affiliation: o.affiliation }),
      onclick: () => mention(o.nick),
      ondblclick: () => !o.self && openConv(c.accountId, `${c.conv}/${o.nick}`, "chat"),
      oncontextmenu: (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, occupantMenu(c, r, o));
      },
    },
    avatarEl(`${c.conv}/${o.nick}`, o.nick, "occ-avatar", o.show || "online"),
    h("span", { class: "occ-nick" }, o.nick),
    typing ? h("span", { class: "typing-dots small" }, h("i"), h("i"), h("i")) : null,
    AFF_ICON[o.affiliation] ? icon(AFF_ICON[o.affiliation], `occ-aff ${o.affiliation}`) : null,
  );
}

function occupantMenu(c, r, o) {
  const me = r.occupants.get(r.nick);
  const isMod = me?.role === "moderator";
  const isAdmin = ["admin", "owner"].includes(me?.affiliation);
  const ask = async (title) => prompt({ title, label: t("Motivo (opcional)"), icon: "triangle-alert" });
  const mod = (opts, ok) => api("room:moderate", c.accountId, c.conv, opts).then(() => toast(ok, { kind: "ok" })).catch((e) => toast(e.message, { kind: "error" }));
  return [
    { header: o.nick },
    !o.self ? { label: t("Mensaje privado"), icon: "message-square", action: () => openConv(c.accountId, `${c.conv}/${o.nick}`, "chat") } : null,
    o.jid && !o.self ? { label: t("Abrir chat directo"), icon: "message-circle", action: () => openConv(c.accountId, o.jid, "chat") } : null,
    { label: t("Mencionar"), icon: "at-sign", action: () => mention(o.nick) },
    o.jid ? { label: t("Copiar JID"), icon: "copy", action: () => navigator.clipboard.writeText(o.jid) } : null,
    o.jid && !o.self ? { label: t("Añadir a contactos"), icon: "user-plus", action: () => api("roster:add", c.accountId, o.jid, o.nick, []).then(() => toast(t("Solicitud enviada"), { kind: "ok" })) } : null,
    isMod && !o.self ? "-" : null,
    isMod && !o.self ? { label: t("Expulsar…"), icon: "user-x", danger: true, action: async () => { const reason = await ask(t("Expulsar a {nick}", { nick: o.nick })); if (reason != null) mod({ nick: o.nick, role: "none", reason }, `${o.nick} expulsado`); } } : null,
    isMod && !o.self ? { label: o.role === "visitor" ? t("Dar voz") : t("Quitar voz"), icon: "mic-off", action: () => mod({ nick: o.nick, role: o.role === "visitor" ? "participant" : "visitor" }, t("Hecho")) } : null,
    isAdmin && o.jid && !o.self ? { label: t("Vetar…"), icon: "ban", danger: true, action: async () => { const reason = await ask(t("Vetar a {nick}", { nick: o.nick })); if (reason != null) mod({ jid: o.jid, affiliation: "outcast", reason }, `${o.nick} vetado`); } } : null,
  ];
}

