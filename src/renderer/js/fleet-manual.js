// Calendario de flotas: añadir o editar una flota a mano («＋ Añadir flota») y «Añadir al calendario» desde un ping o un
// mensaje de sala. El almacén es fleets.js (Sesión A): se conecta con useFleets() para poder probar esto sin él.
import { h, modal, field, toast } from "./dom.js";
import { fmtDateTime } from "./format.js";
import { t } from "./i18n.js";
import { titleFromText, connectSuggestions } from "./fleet-suggest.js";

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

// Desde un ping: lo que saque fleets.js del ping (hora del formup, título, grupo, enlace).
export function prefillFromPing(m) {
  const base = fleets?.fleetFromPing?.(m) || {};
  return { at: base.at ?? null, title: base.title || titleFromText(m.body), group: base.group || "", link: base.link || "", pingKeys: m.key ? [m.key] : [], source: "manual" };
}

// ---------- formulario ----------

// prefill: { id?, at, title, group, note, link, pingKeys, msgKey, source }. groups: sugerencias para el campo «Grupo».
export function openAddFleet(prefill = {}, { groups = [] } = {}) {
  if (!fleets) return toast(t("El calendario de flotas aún no está disponible."), { kind: "warn" });
  const editing = !!prefill.id;
  const start = eveParts(Number.isFinite(prefill.at) ? prefill.at : nextHour());
  const date = h("input", { class: "input", type: "date", value: start.date, required: true });
  const time = h("input", { class: "input", type: "time", value: start.time, required: true, step: 60 });
  const title = h("input", { class: "input", value: prefill.title || "", placeholder: t("p. ej. Roam con la corp"), maxlength: 140, autofocus: true });
  const listId = `fleet-groups-${Date.now().toString(36)}`;
  const group = h("input", { class: "input", value: prefill.group || "", placeholder: t("p. ej. all, caps (opcional)"), maxlength: 60, list: listId });
  const groupList = h("datalist", { id: listId }, [...new Set(groups.filter(Boolean))].map((g) => h("option", { value: g })));
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
    if (editing) fleets.updateFleet(prefill.id, data);
    else fleets.addFleet({ ...data, link: prefill.link || "", source: prefill.source || "manual", ...(prefill.pingKeys?.length ? { pingKeys: prefill.pingKeys } : {}), ...(prefill.msgKey ? { msgKey: prefill.msgKey } : {}) });
    close();
    toast(editing ? t("Flota guardada") : t("Flota añadida al calendario"), { kind: "success" });
  };
  const actions = [
    editing ? { label: t("Borrar"), icon: "trash-2", danger: true, action: (close) => (fleets.removeFleet(prefill.id), close()) } : null,
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

// Elemento de menú «Añadir al calendario» (clic derecho en un mensaje de sala o un ping).
export function calendarMenuItem(getPrefill, opts) {
  return { label: t("Añadir al calendario"), icon: "calendar", disabled: !fleets, action: () => openAddFleet(getPrefill(), opts) };
}
