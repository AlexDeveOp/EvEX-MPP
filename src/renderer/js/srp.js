// SRP (Ship Replacement Program): muchas alianzas reponen en ISK las naves perdidas en sus flotas y piden el ping de
// la flota (y el killmail) para aprobarlo. Aquí se marcan pings, se guarda por cada uno el killmail, una nota y el
// estado, y se copia todo listo para pegar en el formulario de SRP. Se activa en Preferencias → Pings de flota.
// Las marcas se guardan solo en este equipo (settings.srp.marks, por la clave del mensaje), nunca en el servidor.
import { S, saveSettings } from "./state.js";
import { h, icon, toast } from "./dom.js";
import { t, tk } from "./i18n.js";

const DAY = 86400000;
// Fecha y hora EVE (UTC), completas: el formulario de SRP suele pedir cuándo fue la flota.
const eveDateTime = (ts) => new Date(ts).toISOString().slice(0, 16).replace("T", " ");
const INVISIBLE = new RegExp(`[${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200d, 0x2060, 0xfeff)}]`, "g"); // caracteres invisibles de los pings

export const SRP_STATUS = [
  ["pending", tk("Pendiente de pedir")],
  ["requested", tk("Pedido")],
  ["paid", tk("Pagado")],
  ["rejected", tk("Rechazado")],
];

export const srpSettings = () => ({ enabled: false, deadlineDays: 0, marks: {}, ...(S.settings?.srp || {}) });
export const srpEnabled = () => !!srpSettings().enabled;
export const getMark = (key) => (key ? srpSettings().marks[key] || null : null);
export const isMarked = (key) => !!getMark(key);
export const markedCount = (messages) => messages.filter((m) => isMarked(m.key)).length;

function saveMarks(fn) {
  const s = srpSettings();
  const marks = { ...s.marks };
  fn(marks);
  S.settings.srp = { ...s, marks };
  saveSettings();
}

export function toggleMark(m) {
  saveMarks((marks) => {
    if (marks[m.key]) delete marks[m.key];
    else marks[m.key] = { at: Date.now(), ts: m.ts, killmail: "", note: "", status: "pending" };
  });
  return isMarked(m.key);
}

export function updateMark(key, patch) {
  saveMarks((marks) => {
    if (marks[key]) marks[key] = { ...marks[key], ...patch };
  });
}

export function clearMarks() {
  saveMarks((marks) => Object.keys(marks).forEach((k) => delete marks[k]));
}

// Plazo para pedir el SRP: días desde el ping. 0 = sin plazo. Devuelve { at, left, text, state } o null.
// state: "ok" | "soon" (menos de un día) | "late".
export function srpDeadline(ts, days = srpSettings().deadlineDays, now = Date.now()) {
  if (!days || !ts) return null;
  const at = ts + days * DAY;
  const left = at - now;
  if (left <= 0) return { at, left, state: "late", text: t("Plazo de SRP vencido"), short: t("Vencido") };
  const d = Math.floor(left / DAY);
  const hrs = d >= 1 ? Math.floor((left % DAY) / 3600000) : Math.max(1, Math.ceil(left / 3600000));
  const text = d >= 1 ? t("Quedan {d} d {h} h para pedir el SRP", { d, h: hrs }) : t("Quedan {h} h para pedir el SRP", { h: hrs });
  const short = d >= 1 ? t("{d} d {h} h", { d, h: hrs }) : t("{h} h", { h: hrs });
  return { at, left, state: left < DAY ? "soon" : "ok", text, short };
}

// Texto listo para pegar en el formulario de SRP: el ping tal cual y, debajo, el killmail y la nota si los hay.
export function srpText(m, mark = getMark(m.key)) {
  const lines = [String(m.body || "").replace(INVISIBLE, "").trim()];
  const extra = [];
  extra.push(t("Ping: {eve} EVE", { eve: eveDateTime(m.ts) }));
  if (mark?.killmail) extra.push(t("Killmail: {url}", { url: mark.killmail.trim() }));
  if (mark?.note) extra.push(t("Nota: {note}", { note: mark.note.trim() }));
  return [...lines, "", ...extra].join("\n");
}

export function srpTextAll(messages) {
  return messages
    .filter((m) => isMarked(m.key))
    .sort((a, b) => a.ts - b.ts)
    .map((m) => srpText(m))
    .join("\n\n----------\n\n");
}

// Enlace de killmail aceptado: http(s) (zKillboard, ESI o el killboard de la alianza).
export const validKillmail = (url) => !url || /^https?:\/\/\S+$/i.test(url.trim());

async function copy(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg, { kind: "ok", timeout: 2500 });
  } catch (e) {
    toast(e.message, { kind: "error" });
  }
}

// Botón de la bandera en la tarjeta del ping. En la vista «Solo marcados», al quitar la marca la tarjeta se va.
export function flagButton(m, card, { srpOnly } = {}) {
  const btn = h("button", { class: "btn small ghost srp-flag", type: "button" }, icon("flag"));
  const paint = () => {
    const on = isMarked(m.key);
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.title = on ? t("Quitar la marca de SRP") : t("Marcar para SRP");
    card.classList.toggle("srp-marked", on);
  };
  btn.addEventListener("click", () => {
    const on = toggleMark(m);
    paint();
    updateFilterCount();
    if (!on && srpOnly) card.remove();
  });
  paint();
  return btn;
}

// Chip con el tiempo que queda para pedir el SRP (en las tarjetas marcadas, si hay plazo).
export function deadlineChip(m) {
  if (!isMarked(m.key)) return null;
  const d = srpDeadline(m.ts);
  if (!d || getMark(m.key)?.status === "paid") return null;
  return h("span", { class: `srp-deadline ${d.state}`, title: d.text }, icon("hourglass"), d.short);
}

// Panel de SRP de un ping marcado (vista «Solo marcados»): killmail, nota, estado, plazo y copiar.
export function srpPanel(m) {
  const mark = getMark(m.key);
  if (!mark) return null;
  const km = h("input", { class: "input small", type: "url", placeholder: t("Enlace del killmail (zKillboard, ESI…)"), value: mark.killmail || "" });
  km.addEventListener("change", () => {
    const v = km.value.trim();
    km.classList.toggle("invalid", !validKillmail(v));
    if (validKillmail(v)) updateMark(m.key, { killmail: v });
  });
  const note = h("textarea", { class: "input small", rows: 2, placeholder: t("Nota (nave perdida, FC, lo que pida tu alianza…)") });
  note.value = mark.note || "";
  note.addEventListener("change", () => updateMark(m.key, { note: note.value }));
  const status = h("select", { class: "input small" }, SRP_STATUS.map(([v, label]) => h("option", { value: v, selected: v === (mark.status || "pending") }, t(label))));
  status.addEventListener("change", () => updateMark(m.key, { status: status.value }));
  const d = srpDeadline(m.ts);
  return h(
    "div",
    { class: "srp-panel" },
    h("div", { class: "srp-row" }, icon("link"), km),
    h("div", { class: "srp-row" }, icon("sticky-note"), note),
    h(
      "div",
      { class: "srp-row" },
      h("label", { class: "srp-status" }, t("Estado"), status),
      d ? h("span", { class: `srp-deadline ${d.state}` }, icon("hourglass"), d.text) : null,
      h("span", { class: "spacer" }),
      h("button", { class: "btn small primary", type: "button", onclick: () => copy(srpText(m), t("Copiado para el SRP")) }, icon("clipboard-copy"), t("Copiar para SRP")),
    ),
  );
}

function updateFilterCount() {
  for (const el of document.querySelectorAll(".srp-filter .srp-count")) el.textContent = String(Object.keys(srpSettings().marks).length);
}

// Controles de la cabecera de «Pings de flota»: filtro «Solo marcados» y, dentro de él, copiar todos.
// Sin el SRP activado no se muestra nada (y el filtro se desactiva). Devuelve siempre una lista de elementos,
// para expandirla dentro de un append() del DOM.
export function srpHeaderControls(messages, filter, refresh) {
  if (!srpEnabled()) {
    filter.srpOnly = false;
    return [];
  }
  const btn = h(
    "button",
    { class: `btn small ghost srp-filter ${filter.srpOnly ? "on" : ""}`, type: "button", title: t("Ver solo los pings marcados para SRP"), "aria-pressed": String(!!filter.srpOnly) },
    icon("flag"),
    t("Marcados"),
    h("span", { class: "srp-count" }, String(markedCount(messages))),
  );
  btn.addEventListener("click", () => {
    filter.srpOnly = !filter.srpOnly;
    refresh();
  });
  const all = filter.srpOnly
    ? h("button", { class: "btn small ghost", type: "button", title: t("Copiar todos los pings marcados, listos para el SRP"), onclick: () => (markedCount(messages) ? copy(srpTextAll(messages), t("Copiados {n} pings para el SRP", { n: markedCount(messages) })) : toast(t("No hay pings marcados."), { kind: "info" })) }, icon("clipboard-copy"), t("Copiar todos"))
    : null;
  return all ? [btn, all] : [btn];
}
