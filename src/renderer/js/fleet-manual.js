// Calendario de flotas: añadir o editar una flota a mano («＋ Añadir flota») y «Añadir al calendario» desde un ping o un
// mensaje de sala. El almacén es fleets.js (Sesión A): se conecta con useFleets() para poder probar esto sin él.
import { h, icon, modal, field, toast } from "./dom.js";
import { fmtDateTime } from "./format.js";
import { t } from "./i18n.js";
import { titleFromText, connectSuggestions } from "./fleet-suggest.js";
import { parsePing } from "./pings.js";

let fleets = null; // { addFleet, updateFleet, removeFleet, allFleets, isDismissed, fleetFromPing }
let parseTime = null; // parseFleetTime(text, msgTs) de formup.js

export function useFleets(api, { parseFleetTime } = {}) {
  fleets = api || null;
  parseTime = parseFleetTime || null;
  connectSuggestions(api && parseFleetTime ? { parseFleetTime, addFleet: api.addFleet, isDismissed: api.isDismissed, allFleets: api.allFleets } : null);
}
export const fleetsReady = () => !!fleets;

// ---------- horas EVE (UTC) ----------

const pad = (n) => String(n).padStart(2, "0");

// ms → { date: "AAAA-MM-DD", time: "HH:MM" } en hora EVE, para los campos del formulario.
export function eveParts(ts) {
  const d = new Date(ts);
  return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
}

// { date, time } en hora EVE → ms, o null si no es una fecha válida.
export function fromEveParts(date, time) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  const tm = /^(\d{1,2}):(\d{2})$/.exec(String(time || ""));
  if (!dm || !tm) return null;
  const [y, mo, d, hh, mi] = [dm[1], dm[2], dm[3], tm[1], tm[2]].map(Number);
  if (hh > 23 || mi > 59) return null;
  const ts = Date.UTC(y, mo - 1, d, hh, mi);
  const back = new Date(ts);
  return back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? ts : null;
}

// La próxima hora en punto (EVE), para una flota nueva sin hora.
export function nextHour(now = Date.now()) {
  return Math.ceil((now + 1) / 3600e3) * 3600e3;
}

// Comprueba el formulario. Devuelve el texto del error o "".
export function validateFleet({ at, title }, now = Date.now()) {
  if (!String(title || "").trim()) return t("Ponle un título a la flota.");
  if (!Number.isFinite(at)) return t("La fecha o la hora no son válidas.");
  if (at < now - 12 * 3600e3) return t("Esa hora ya ha pasado.");
  return "";
}

// Datos iniciales para «Añadir al calendario» desde un mensaje de sala: la hora que se lea en el texto (si hay) y la
// primera línea como título. Entra como flota normal (la ha añadido el usuario), con la clave del mensaje.
export function prefillFromMessage(m, roomName, parse = parseTime) {
  return {
    at: parse?.(m.body, m.ts) ?? null,
    title: titleFromText(m.body),
    note: t("De {nick} en {room}", { nick: m.nick || "?", room: roomName }),
    msgKey: m.key,
    source: "manual",
  };
}

// Desde un ping. Si el ping ya está en el calendario (fleets.js convierte en flota los pings con hora de formup), se
// abre esa flota para editarla; si no, lo que se saque del ping: hora, título, grupo del pie y enlace.
export function prefillFromPing(m) {
  const existing = m.key && fleets?.allFleets?.().find((f) => (f.pingKeys || []).includes(m.key));
  if (existing) return { ...existing };
  const base = fleets?.fleetFromPing?.(m) || {};
  return { at: base.at ?? null, title: base.title || titleFromText(m.body), group: base.group || parsePing(m.body).footer?.to || "", link: base.link || "", pingKeys: m.key ? [m.key] : [], source: "manual" };
}

// Al añadir a mano un mensaje que ya tenía una sugerida pendiente, se acepta esa (con lo escrito) en vez de duplicarla.
export function pendingFor(msgKey) {
  return (msgKey && fleets?.allFleets?.().find((f) => f.msgKey === msgKey && f.status === "pending")) || null;
}

// ---------- formulario ----------

// prefill: { id?, at, title, group, note, link, pingKeys, msgKey, source }. groups: sugerencias para el campo «Grupo»
// (se añaden los grupos de las flotas que ya hay). onSaved: tras guardar o borrar (p. ej. repintar la agenda).
export function openAddFleet(prefill = {}, { groups = [], onSaved } = {}) {
  if (!fleets) return toast(t("El calendario de flotas aún no está disponible."), { kind: "warn" });
  const editing = !!prefill.id;
  const start = eveParts(Number.isFinite(prefill.at) ? prefill.at : nextHour());
  const date = h("input", { class: "input", type: "date", value: start.date, required: true });
  const time = h("input", { class: "input", type: "time", value: start.time, required: true, step: 60 });
  const title = h("input", { class: "input", value: prefill.title || "", placeholder: t("p. ej. Roam con la corp"), maxlength: 140, autofocus: true });
  const listId = `fleet-groups-${Date.now().toString(36)}`;
  const group = h("input", { class: "input", value: prefill.group || "", placeholder: t("p. ej. all, caps (opcional)"), maxlength: 60, list: listId });
  const known = (fleets.allFleets?.() || []).map((f) => f.group);
  const groupList = h("datalist", { id: listId }, [...new Set([...groups, ...known].filter(Boolean))].map((g) => h("option", { value: g })));
  const note = h("textarea", { class: "input", rows: 2, placeholder: t("Opcional: doctrina, qué llevar…"), maxlength: 500 });
  note.value = prefill.note || "";
  const local = h("div", { class: "fleet-local muted" });
  const error = h("div", { class: "fleet-error" });
  const showLocal = () => {
    const at = fromEveParts(date.value, time.value);
    local.textContent = at ? t("Hora local: {local}", { local: fmtDateTime(at) }) : "";
  };
  date.addEventListener("input", showLocal);
  time.addEventListener("input", showLocal);
  showLocal();

  const save = (close) => {
    const at = fromEveParts(date.value, time.value);
    const data = { at, title: title.value.trim(), group: group.value.trim(), note: note.value.trim() };
    const err = validateFleet(data);
    error.textContent = err;
    if (err) return;
    const pending = !editing && pendingFor(prefill.msgKey);
    if (editing) fleets.updateFleet(prefill.id, data);
    else if (pending) fleets.updateFleet(pending.id, { ...data, status: "active" });
    else fleets.addFleet({ ...data, link: prefill.link || "", source: prefill.source || "manual", ...(prefill.pingKeys?.length ? { pingKeys: prefill.pingKeys } : {}), ...(prefill.msgKey ? { msgKey: prefill.msgKey } : {}) });
    close();
    onSaved?.();
    toast(editing ? t("Flota guardada") : t("Flota añadida al calendario"), { kind: "ok" });
  };
  const actions = [
    editing ? { label: t("Borrar"), icon: "trash-2", danger: true, action: (close) => (fleets.removeFleet(prefill.id), close(), onSaved?.()) } : null,
    "spacer",
    { label: t("Cancelar"), action: (close) => close() },
    { label: editing ? t("Guardar") : t("Añadir"), icon: "calendar", primary: true, action: save },
  ].filter(Boolean);
  const m = modal({
    title: editing ? t("Editar flota") : t("Añadir flota"),
    icon: "calendar",
    className: "fleet-modal",
    body: h(
      "form",
      { class: "fleet-form", onsubmit: (e) => (e.preventDefault(), save(m.close)) },
      h("div", { class: "fleet-when" }, field(t("Fecha (EVE)"), date), field(t("Hora EVE"), time)),
      local,
      field(t("Título"), title),
      field(t("Grupo"), group, t("Para los avisos antes del formup que solo valen para algunos grupos")),
      groupList,
      field(t("Nota"), note),
      error,
      h("button", { type: "submit", hidden: true }),
    ),
    actions,
  });
  return m;
}

// Botones en la vista del calendario (fleet-view.js de la Sesión A): «＋ Añadir flota» en la cabecera y «Editar» en cada
// flota (las sugeridas ya llevan «Añadir» y «Descartar»). view: { addFleetHeaderAction, addFleetRowAction }.
export function registerFleetActions(view) {
  view.addFleetHeaderAction(() => h("button", { class: "btn small primary fleet-add", type: "button", disabled: !fleets, onclick: () => openAddFleet() }, icon("plus"), t("Añadir flota")));
  view.addFleetRowAction((f, { refresh } = {}) => (f.status === "pending" ? null : h("button", { class: "btn small ghost", type: "button", onclick: () => openAddFleet({ ...f }, { onSaved: refresh }) }, t("Editar"))));
}

// Elemento de menú «Añadir al calendario» (clic derecho en un mensaje de sala o un ping). Si lo que se va a abrir ya es
// una flota del calendario (un ping con hora), dice «Editar en el calendario».
export function calendarMenuItem(getPrefill, opts = {}) {
  const prefill = fleets ? getPrefill() : null;
  return { label: prefill?.id ? t("Editar en el calendario") : t("Añadir al calendario"), icon: "calendar", disabled: !fleets, action: () => openAddFleet(prefill || getPrefill(), opts) };
}
