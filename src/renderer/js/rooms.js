// Explorador de salas del servidor (disco#items) y diálogo para unirse a una sala, con sugerencias mientras se escribe.
import { S, api, account, conn, roomState, saveRooms, updateSettings } from "./state.js";
import { h, icon, iconButton, modal, field, toast, clear, fill, debounce } from "./dom.js";
import { openConv } from "./convs.js";
import { toggleFavorite, toggleAutojoin } from "./chat.js";

import { t } from "./i18n.js";
const isFav = (r) => !!(r && (r.favorite || r.autojoin));
const cache = new Map(); // servidor -> { rooms, at }
const infoCache = new Map();
const servicesCache = new Map(); // dominio -> [{ jid, name }]

const defaultServer = (acc) => acc.conferenceServer || `conference.${acc.jid.split("@")[1]}`;

// Servidores de salas de la cuenta: siempre el suyo y, con «Otros servidores de salas» activado, también los que
// anuncie el dominio (muc., chat.…). El de la cuenta va primero.
export async function mucServers(accountId, force) {
  const acc = account(accountId);
  const own = defaultServer(acc);
  if (!S.settings.behavior.discoverMucServices) return [{ jid: own, name: "" }];
  const domain = acc.jid.split("@")[1];
  if (force || !servicesCache.has(domain)) servicesCache.set(domain, await api("room:services", accountId, domain).catch(() => []));
  const found = servicesCache.get(domain);
  return [found.find((s) => s.jid === own) || { jid: own, name: "" }, ...found.filter((s) => s.jid !== own)];
}

// Salas públicas de un servidor, con caché (la lista puede tener miles y tarda en llegar).
async function roomsOf(accountId, server, force) {
  if (!force && cache.has(server)) return cache.get(server).rooms;
  const rooms = await api("room:list", accountId, server);
  cache.set(server, { rooms, at: Date.now() });
  return rooms;
}

export function openRoomBrowser(accountId) {
  const acc = account(accountId);
  if (conn(accountId).state !== "online") return toast(t("Conéctate primero para explorar las salas."), { kind: "warn" });
  let server = defaultServer(acc);
  let servers = [{ jid: server, name: "" }];
  let all = false; // «Todos»: las salas de todos los servidores encontrados
  let rooms = [];
  let sort = "name";
  let onlyFav = false;
  let selected = null;

  const serverInput = h("input", { class: "input", value: server, placeholder: t("Todos los servidores") });
  const filterInput = h("input", { class: "input", placeholder: t("Filtrar por nombre o dirección…"), autofocus: true });
  const table = h("div", { class: "room-table" });
  const details = h("div", { class: "room-details" }, h("div", { class: "empty-state small" }, icon("compass"), h("p", {}, t("Selecciona una sala para ver sus detalles"))));
  const status = h("span", { class: "muted" });
  const serverBar = h("div", { class: "rb-servers hidden" });

  async function load(force) {
    if (!all) server = serverInput.value.trim().toLowerCase() || ((serverInput.value = defaultServer(acc)), defaultServer(acc));
    renderServers();
    const cached = all ? servers.every((s) => cache.has(s.jid)) : cache.has(server);
    if (force || !cached) {
      status.textContent = t("Cargando lista de salas…");
      clear(table).append(h("div", { class: "loading" }, h("span", { class: "spinner" }), t("Consultando el servidor…")));
    }
    try {
      // En «Todos», un servidor que falle no tapa a los demás.
      rooms = all ? (await Promise.all(servers.map((s) => roomsOf(accountId, s.jid, force).catch(() => [])))).flat() : await roomsOf(accountId, server, force);
      renderServers();
      render();
    } catch (e) {
      clear(table).append(h("div", { class: "empty-state small" }, icon("triangle-alert"), h("p", {}, t("Error: {message}", { message: e.message }))));
      status.textContent = "";
    }
  }

  function render() {
    const q = filterInput.value.trim().toLowerCase();
    const accRooms = new Map(account(accountId).rooms.map((r) => [r.jid, r]));
    let list = rooms.filter((r) => !q || r.name.toLowerCase().includes(q) || r.jid.includes(q));
    if (onlyFav) list = list.filter((r) => isFav(accRooms.get(r.jid)));
    list.sort((a, b) => {
      if (sort === "users") return (infoCache.get(b.jid)?.occupants ?? -1) - (infoCache.get(a.jid)?.occupants ?? -1) || a.name.localeCompare(b.name);
      if (sort === "fav") return (isFav(accRooms.get(b.jid)) ? 1 : 0) - (isFav(accRooms.get(a.jid)) ? 1 : 0) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    status.textContent = all
      ? t("{shown} de {total} salas en {count} servidores", { shown: list.length, total: rooms.length, count: servers.length })
      : t("{shown} de {total} salas en {server}", { shown: list.length, total: rooms.length, server });
    clear(table);
    table.append(
      h(
        "div",
        { class: "room-row head" },
        h("span", { class: "c-name", onclick: () => ((sort = "name"), render()) }, t("Sala"), sort === "name" ? icon("chevron-down") : null),
        h("span", { class: "c-users", onclick: () => ((sort = "users"), render()) }, t("Usuarios"), sort === "users" ? icon("chevron-down") : null),
        h("span", { class: "c-flags", onclick: () => ((sort = "fav"), render()) }, t("Lista"), sort === "fav" ? icon("chevron-down") : null),
      ),
    );
    const frag = document.createDocumentFragment();
    for (const r of list.slice(0, 1500)) {
      const mine = accRooms.get(r.jid);
      const info = infoCache.get(r.jid);
      const live = roomState(accountId, r.jid);
      frag.append(
        h(
          "div",
          {
            class: `room-row ${selected === r.jid ? "selected" : ""} ${live.joined ? "joined" : ""}`,
            onclick: () => select(r),
            ondblclick: () => join(r),
          },
          h("span", { class: "c-name" }, icon(info?.passwordProtected ? "lock" : "hash"), h("b", {}, r.name), h("small", { class: "muted" }, all ? r.jid : r.jid.split("@")[0] !== r.name.toLowerCase() ? r.jid.split("@")[0] : "")),
          h("span", { class: "c-users" }, info?.occupants ?? "·"),
          h(
            "span",
            { class: "c-flags" },
            iconButton("star", (mine?.favorite || mine?.autojoin) ? t("Quitar de favoritas") : t("Añadir a favoritas"), async (e) => (e.stopPropagation(), await toggleFavorite(accountId, r.jid), fixName(r), render()), (mine?.favorite || mine?.autojoin) ? "on star" : ""),
            iconButton("zap", mine?.autojoin ? t("Se abre al iniciar") : t("Abrir al iniciar"), async (e) => (e.stopPropagation(), await toggleAutojoin(accountId, r.jid), fixName(r), render()), mine?.autojoin ? "on zap" : ""),
          ),
        ),
      );
    }
    table.append(frag);
    if (list.length > 1500) table.append(h("div", { class: "muted pad" }, t("Mostrando 1500 de {total}; usa el filtro.", { total: list.length })));
    if (!list.length) table.append(h("div", { class: "empty-state small" }, h("p", {}, t("No hay salas que coincidan."))));
  }

  async function fixName(r) {
    const mine = account(accountId).rooms.find((x) => x.jid === r.jid);
    if (mine && mine.name === r.jid.split("@")[0] && r.name && r.name !== mine.name) {
      mine.name = r.name;
      await saveRooms(accountId);
    }
  }

  async function select(r) {
    selected = r.jid;
    render();
    clear(details).append(h("div", { class: "loading" }, h("span", { class: "spinner" }), t("Cargando información…")));
    let info = infoCache.get(r.jid);
    try {
      if (!info) {
        info = await api("room:info", accountId, r.jid);
        infoCache.set(r.jid, info);
      }
    } catch (e) {
      info = { error: e.message };
    }
    if (selected !== r.jid) return;
    const mine = account(accountId).rooms.find((x) => x.jid === r.jid);
    fill(
      details,
      h("h3", {}, icon("hash"), info.name || r.name),
      h("div", { class: "muted mono" }, r.jid),
      info.error ? h("p", { class: "error-text" }, info.error) : null,
      info.description ? h("p", {}, info.description) : null,
      info.subject ? h("p", { class: "room-subject" }, icon("quote"), info.subject) : null,
      h(
        "div",
        { class: "chips" },
        info.occupants != null ? h("span", { class: "chip" }, icon("users"), `${info.occupants} usuarios`) : null,
        info.passwordProtected ? h("span", { class: "chip warn" }, icon("lock"), t("Con contraseña")) : null,
        info.membersOnly ? h("span", { class: "chip" }, icon("shield"), t("Solo miembros")) : null,
        info.moderated ? h("span", { class: "chip" }, icon("mic-off"), t("Moderada")) : null,
        info.persistent ? h("span", { class: "chip" }, icon("database"), t("Persistente")) : null,
      ),
      h(
        "div",
        { class: "room-detail-actions" },
        h("button", { class: "btn primary", onclick: () => join(r, info) }, icon("log-in"), t("Unirse")),
        h("button", { class: `btn ${(mine?.favorite || mine?.autojoin) ? "active" : ""}`, onclick: async () => (await toggleFavorite(accountId, r.jid), await fixName(r), select(r)) }, icon("star"), (mine?.favorite || mine?.autojoin) ? t("En favoritas") : t("Añadir a favoritas")),
        h("button", { class: `btn ${mine?.autojoin ? "active" : ""}`, onclick: async () => (await toggleAutojoin(accountId, r.jid), await fixName(r), select(r)) }, icon("zap"), mine?.autojoin ? t("Se abre al iniciar") : t("Abrir al iniciar")),
      ),
    );
    render();
  }

  async function join(r, info = infoCache.get(r.jid)) {
    await fixName(r);
    m.close();
    const mine = account(accountId).rooms.find((x) => x.jid === r.jid);
    // Salas con contraseña: pedirla en el diálogo de unirse (salvo que ya esté guardada).
    if (info?.passwordProtected && !mine?.hasPassword) return openJoinRoom(accountId, { room: r.jid });
    openConv(accountId, r.jid, "groupchat");
  }

  async function loadAllInfo() {
    const pending = rooms.filter((r) => !infoCache.has(r.jid));
    let done = 0;
    status.textContent = t("Consultando usuarios… 0/{length}", { length: pending.length });
    const worker = async () => {
      while (pending.length) {
        const r = pending.shift();
        try {
          infoCache.set(r.jid, await api("room:info", accountId, r.jid));
        } catch {
          infoCache.set(r.jid, { occupants: null });
        }
        done++;
        if (done % 10 === 0) status.textContent = t("Consultando usuarios… {done}", { done });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    sort = "users";
    render();
  }

  // Fila de servidores encontrados (solo con «Otros servidores de salas» activado).
  function renderServers() {
    const on = S.settings.behavior.discoverMucServices;
    serverBar.classList.toggle("hidden", !on);
    if (!on) return;
    const count = (jid) => (cache.has(jid) ? cache.get(jid).rooms.length : null);
    const chip = (active, label, title, n, onclick) =>
      h("button", { class: `rb-server ${active ? "active" : ""}`, type: "button", title, onclick }, label, n != null ? h("span", { class: "rb-server-n" }, n) : null);
    const many = servers.length > 1;
    fill(
      serverBar,
      h("span", { class: "rb-servers-label" }, icon("server"), many ? t("Servidores de salas:") : t("No hay otros servidores de salas en {domain}.", { domain: acc.jid.split("@")[1] })),
      many ? servers.map((s) => chip(!all && s.jid === server, s.jid, s.name || s.jid, count(s.jid), () => ((all = false), (serverInput.value = s.jid), load(false)))) : null,
      many ? chip(all, t("Todos"), t("Las salas de todos los servidores"), servers.every((s) => cache.has(s.jid)) ? servers.reduce((n, s) => n + count(s.jid), 0) : null, () => ((all = true), (serverInput.value = ""), load(false))) : null,
    );
  }

  async function loadServers(force) {
    if (S.settings.behavior.discoverMucServices) {
      fill(serverBar, h("span", { class: "rb-servers-label" }, h("span", { class: "spinner" }), t("Buscando servidores de salas…")));
      serverBar.classList.remove("hidden");
    }
    servers = await mucServers(accountId, force);
    if (servers.length < 2) all = false;
    renderServers();
  }

  const discoverToggle = h(
    "label",
    { class: "rb-discover", title: t("Busca también otros servidores de salas del dominio de la cuenta (por ejemplo muc. o chat.)") },
    h(
      "span",
      { class: "switch" },
      h("input", {
        type: "checkbox",
        checked: !!S.settings.behavior.discoverMucServices,
        onchange: async (e) => {
          updateSettings((x) => (x.behavior.discoverMucServices = e.target.checked));
          if (!e.target.checked && all) all = false;
          await loadServers(false);
          load(false);
        },
      }),
      h("span", { class: "slider" }),
    ),
    t("Otros servidores de salas"),
  );

  // «Listar» con el cuadro vacío vuelve a pedir todos los servidores encontrados.
  const relist = () => ((all = !serverInput.value.trim() && servers.length > 1), load(true));
  filterInput.addEventListener("input", debounce(render, 120));
  serverInput.addEventListener("keydown", (e) => e.key === "Enter" && relist());
  const favToggle = h("label", { class: "check" }, h("input", { type: "checkbox", onchange: (e) => ((onlyFav = e.target.checked), render()) }), t("Solo favoritas"));

  const m = modal({
    title: t("Explorar salas"),
    icon: "compass",
    wide: true,
    className: "room-browser",
    body: h(
      "div",
      { class: "rb-layout" },
      h(
        "div",
        { class: "rb-toolbar" },
        h("div", { class: "input-group" }, icon("server"), serverInput, h("button", { class: "btn", onclick: relist }, icon("refresh-cw"), t("Listar"))),
        h("div", { class: "input-group grow" }, icon("search"), filterInput),
        favToggle,
        discoverToggle,
        h("button", { class: "btn ghost", title: t("Consulta cuántos usuarios tiene cada sala (puede tardar)"), onclick: loadAllInfo }, icon("users"), t("Contar usuarios")),
      ),
      serverBar,
      h("div", { class: "rb-main" }, table, details),
      h("div", { class: "rb-status" }, status),
    ),
    actions: [{ label: t("Unirse por nombre…"), icon: "plus", action: (close) => (close(), openJoinRoom(accountId)) }, "spacer", { label: t("Cerrar"), action: (c) => c() }],
  });
  loadServers(false).then(() => load(false));
}

// Sugerencias bajo el campo «Sala» del diálogo de unirse: las salas de los servidores de la cuenta cuyo nombre o
// dirección contienen lo escrito. Flechas para moverse, Intro o clic para elegir, Esc para cerrarlas.
function roomSuggestions(accountId, input) {
  const box = h("div", { class: "room-suggest hidden", role: "listbox" });
  let known = [];
  let shown = [];
  let active = -1;
  let multi = false;
  const hide = () => (box.classList.add("hidden"), (shown = []), (active = -1));
  (async () => {
    if (conn(accountId).state !== "online") return;
    const servers = await mucServers(accountId).catch(() => []);
    multi = servers.length > 1;
    known = (await Promise.all(servers.map((s) => roomsOf(accountId, s.jid).catch(() => [])))).flat();
    if (document.activeElement === input && input.value.trim()) render();
  })();
  function render() {
    const q = input.value.trim().toLowerCase();
    // Si la lista llega del servidor con una sugerencia ya marcada, la marca sigue en la misma sala.
    const marked = shown[active]?.jid;
    active = -1;
    const score = (r) => (r.name.toLowerCase().startsWith(q) || r.jid.startsWith(q) ? 0 : 1);
    shown = q ? known.filter((r) => r.name.toLowerCase().includes(q) || r.jid.includes(q)).sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name)).slice(0, 8) : [];
    if (shown.length === 1 && shown[0].jid === q) shown = [];
    clear(box);
    box.classList.toggle("hidden", !shown.length);
    shown.forEach((r, i) => {
      const joined = roomState(accountId, r.jid).joined;
      const users = infoCache.get(r.jid)?.occupants;
      box.append(
        h(
          "div",
          { class: "rs-item", role: "option", dataset: { i }, onmousedown: (e) => (e.preventDefault(), pick(r)), onmousemove: () => highlight(i) },
          icon(joined ? "check" : "hash"),
          h("span", { class: "rs-name" }, h("b", {}, r.name), h("small", { class: "muted" }, multi || r.jid.split("@")[0] !== r.name.toLowerCase() ? r.jid : "")),
          joined ? h("span", { class: "rs-tag" }, t("Dentro")) : users != null ? h("span", { class: "rs-tag muted" }, icon("users"), users) : null,
        ),
      );
    });
    const keep = shown.findIndex((r) => r.jid === marked);
    if (keep >= 0) highlight(keep);
  }
  function highlight(i) {
    active = i;
    for (const el of box.children) el.classList.toggle("active", Number(el.dataset.i) === i);
  }
  function pick(r) {
    input.value = r.jid;
    hide();
    input.focus();
  }
  input.addEventListener("input", debounce(render, 80));
  input.addEventListener("blur", () => setTimeout(hide, 120));
  input.addEventListener("keydown", (e) => {
    if (!shown.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      highlight((active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length);
    } else if (e.key === "Enter" && active >= 0) {
      // Intro elige la sugerencia marcada; el segundo Intro ya entra en la sala.
      e.preventDefault();
      e.stopImmediatePropagation();
      pick(shown[active]);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      hide();
    }
  });
  return box;
}

export function openJoinRoom(accountId, preset = {}) {
  const acc = account(accountId);
  const roomInput = h("input", { class: "input", placeholder: t("nombre-de-sala o sala@conference.servidor"), value: preset.room || "", autofocus: true, autocomplete: "off" });
  const suggest = roomSuggestions(accountId, roomInput);
  const nickInput = h("input", { class: "input", value: preset.nick || acc.nick });
  const passInput = h("input", { class: "input", type: "password", value: preset.password || "", placeholder: t("Solo si la sala la requiere") });
  const fav = h("input", { type: "checkbox", checked: true });
  const auto = h("input", { type: "checkbox" });
  const doJoin = async (close) => {
    const raw = roomInput.value.trim().toLowerCase();
    if (!raw) return;
    const jid = raw.includes("@") ? raw : `${raw}@${acc.conferenceServer}`;
    const nick = nickInput.value.trim();
    if (fav.checked || auto.checked) {
      const existing = acc.rooms.find((r) => r.jid === jid);
      if (existing) Object.assign(existing, { favorite: fav.checked || existing.favorite, autojoin: auto.checked || existing.autojoin, nick: nick !== acc.nick ? nick : existing.nick });
      else acc.rooms.push({ jid, name: jid.split("@")[0], favorite: true, autojoin: auto.checked, nick: nick !== acc.nick ? nick : "", password: passInput.value || undefined, notify: "default" });
      await saveRooms(accountId);
    }
    close();
    const r = roomState(accountId, jid);
    if (conn(accountId).state !== "online") return toast(t("Sin conexión: la sala se abrirá al conectar."), { kind: "warn" });
    r.joining = true;
    await openConv(accountId, jid, "groupchat", { join: false });
    api("room:join", accountId, jid, nick || null, passInput.value || null).catch((e) => toast(e.message, { kind: "error" }));
  };
  const m = modal({
    title: t("Unirse a una sala"),
    icon: "log-in",
    body: h(
      "div",
      { class: "form" },
      field(t("Sala"), h("div", { class: "room-suggest-wrap" }, roomInput, suggest), t("Servidor por defecto: {conferenceServer}. Al escribir, sugiere las salas del servidor.", { conferenceServer: acc.conferenceServer })),
      field(t("Apodo"), nickInput),
      field(t("Contraseña"), passInput),
      h("label", { class: "check" }, fav, t("Guardar en favoritas")),
      h("label", { class: "check" }, auto, t("Abrir automáticamente al iniciar")),
    ),
    actions: ["spacer", { label: t("Cancelar"), action: (c) => c() }, { label: t("Unirse"), primary: true, icon: "log-in", action: doJoin }],
  });
  roomInput.addEventListener("keydown", (e) => e.key === "Enter" && doJoin(m.close));
  return m;
}
