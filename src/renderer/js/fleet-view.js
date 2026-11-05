// Vistas del calendario de flotas dentro de «Pings de flota»: Próximas (agenda por días) y Mes. Los datos salen de
// fleets.js. Las horas van en EVE (UTC) y, al lado, en hora local. Nada sale de la app: el enlace al calendario de la
// alianza solo se copia, no se abre.
//
// Otras partes de la app pueden añadir botones sin tocar este fichero:
// - addFleetHeaderAction(build): build() → elemento para el contenedor .fleet-actions de la cabecera («＋ Añadir
//   flota», «Exportar .ics»…).
// - addFleetRowAction(build): build(fleet, { refresh }) → elemento o null para las acciones de cada flota (Editar,
//   Exportar…).
import { S } from "./state.js";
import { h, icon, toast } from "./dom.js";
import { fmtEve, fmtTime } from "./format.js";
import { fleetCountdown } from "./countdown.js";
import { t, locale } from "./i18n.js";
import { upcoming, fleetsBetween, fleetDetails, acceptFleet, dismissFleet } from "./fleets.js";

export const FLEET_VIEWS = ["list", "upcoming", "month"];
const DAY = 86400e3;

const headerActions = [];
const rowActions = [];
export function addFleetHeaderAction(build) {
  headerActions.push(build);
}
export function addFleetRowAction(build) {
  rowActions.push(build);
}

// Contenedor de la cabecera con las acciones que hayan añadido otras partes de la app.
export function fleetHeaderActions() {
  const box = h("div", { class: "fleet-actions" });
  for (const build of headerActions) {
    try {
      const el = build();
      if (el) box.append(el);
    } catch (e) {
      console.error(e);
    }
  }
  return box;
}

// Selector Lista | Próximas (n) | Mes.
const upcomingLabel = (now) => {
  const n = upcoming({ now }).length;
  return n ? t("Próximas · {n}", { n }) : t("Próximas");
};
export function fleetViewSwitch(view, onChange, now = Date.now()) {
  const btn = (v, label) =>
    h("button", { class: `seg seg-${v} ${view === v ? "on" : ""}`, type: "button", "aria-pressed": String(view === v), onclick: () => view !== v && onChange(v) }, label);
  return h("div", { class: "seg-group fleet-view-switch", role: "group", "aria-label": t("Vista") }, btn("list", t("Lista")), btn("upcoming", upcomingLabel(now)), btn("month", t("Mes")));
}

// Solo el número de «Próximas · n» (sin rehacer la cabecera: el filtro o el desplegable de grupos perderían el foco).
export function updateFleetCount(root, now = Date.now()) {
  const b = root?.querySelector(".fleet-view-switch .seg-upcoming");
  const label = upcomingLabel(now);
  if (b && b.textContent !== label) b.textContent = label;
}

// Tic de la vista abierta: cuentas atrás y «Hoy/Mañana» al día. Devuelve true si alguna flota ya ha pasado (hay que
// repintar la agenda).
export function tickFleetView(root, now = Date.now()) {
  let expired = false;
  for (const chip of root.querySelectorAll(".fleet-cd[data-at]")) {
    const text = fleetCountdown(Number(chip.dataset.at), now);
    if (!text) expired = true;
    const label = chip.querySelector(".fleet-cd-text");
    if (label && label.textContent !== text) label.textContent = text;
  }
  for (const d of root.querySelectorAll(".fleet-day[data-day]")) {
    const text = dayLabel(Number(d.dataset.day), now);
    if (d.textContent !== text) d.textContent = text;
  }
  return expired;
}

// ---------- textos de tiempo ----------

const eveHM = (at) => fmtEve(at, false);
const dayStart = (ts) => {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

function dayLabel(start, now) {
  const today = dayStart(now);
  const name = new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(start);
  if (start === today) return t("Hoy · {day}", { day: name });
  if (start === today + DAY) return t("Mañana · {day}", { day: name });
  return name;
}

// ---------- Próximas ----------

function sourceText(f) {
  if (f.source === "message") return f.status === "pending" ? t("Sugerida: hora encontrada en un mensaje de una sala") : t("Desde un mensaje de una sala");
  if (f.source === "manual") return f.note ? t("Añadida a mano · nota: {note}", { note: f.note }) : t("Añadida a mano");
  const d = fleetDetails(f);
  const parts = [d.fc && `FC ${d.fc}`, d.formup && t("Formup {where}", { where: d.formup }), d.doctrine && t("Doctrina {d}", { d: d.doctrine })].filter(Boolean);
  if (f.note) parts.push(t("nota: {note}", { note: f.note }));
  if (f.pingKeys.length > 1) parts.push(t("{n} pings", { n: f.pingKeys.length }));
  return parts.join(" · ");
}

async function copyLink(link) {
  try {
    await navigator.clipboard.writeText(link);
    toast(t("Enlace copiado. Ábrelo tú en el navegador si quieres: EvEX-MPP no lo abre."), { kind: "ok", timeout: 4000 });
  } catch (e) {
    toast(e.message, { kind: "error" });
  }
}

function fleetRow(f, now, { onShowPing, refresh }) {
  const local = S.settings.showLocalTime !== false ? t("EVE · {time} local", { time: fmtTime(f.at) }) : "EVE";
  const chips = h("div", { class: "fleet-chips" });
  const cd = fleetCountdown(f.at, now);
  if (cd) chips.append(h("span", { class: "chip fleet-cd", dataset: { at: String(f.at) } }, icon("clock"), h("span", { class: "fleet-cd-text" }, cd)));
  if (f.status === "pending") chips.append(h("span", { class: "chip fleet-pending" }, t("¿Es una flota?")));
  if (f.group) chips.append(h("span", { class: "chip fleet-group" }, f.group));
  if (f.source === "manual") chips.append(h("span", { class: "chip fleet-manual" }, t("a mano")));
  if (f.link) chips.append(h("button", { class: "chip fleet-link", type: "button", title: t("Copiar el enlace: {link}", { link: f.link }), onclick: () => copyLink(f.link) }, icon("link"), t("Calendario de la alianza")));

  const actions = h("div", { class: "fleet-row-actions" });
  if (f.status === "pending") {
    actions.append(
      h("button", { class: "btn small primary", type: "button", onclick: () => (acceptFleet(f.id), refresh()) }, t("Añadir")),
      h("button", { class: "btn small ghost", type: "button", onclick: () => (dismissFleet(f.id), refresh()) }, t("Descartar")),
    );
  }
  for (const build of rowActions) {
    try {
      const el = build(f, { refresh });
      if (el) actions.append(el);
    } catch (e) {
      console.error(e);
    }
  }
  if (f.source === "ping" && f.pingKeys.length) actions.append(h("button", { class: "btn small ghost", type: "button", onclick: () => onShowPing(f.pingKeys.at(-1)) }, t("Ver ping")));

  return h(
    "div",
    { class: `fleet-row src-${f.source} st-${f.status}`, dataset: { id: f.id } },
    h("div", { class: "fleet-time" }, h("div", { class: "fleet-eve" }, eveHM(f.at)), h("div", { class: "fleet-local" }, local)),
    h("div", { class: "fleet-main" }, h("div", { class: "fleet-title" }, f.title || t("(flota sin título)")), h("div", { class: "fleet-sub" }, sourceText(f))),
    chips,
    actions,
  );
}

function renderUpcoming(root, now, opts) {
  const list = upcoming({ now });
  if (!list.length) {
    root.append(h("div", { class: "empty-state" }, icon("calendar"), h("p", {}, t("No hay flotas a la vista. Salen de los pings con hora de formup y de las que añadas a mano."))));
    return;
  }
  let day = null;
  for (const f of list) {
    const d = dayStart(f.at);
    if (d !== day) {
      day = d;
      root.append(h("div", { class: "fleet-day", dataset: { day: String(d) } }, dayLabel(d, now)));
    }
    root.append(fleetRow(f, now, opts));
  }
  root.append(h("p", { class: "muted small fleet-legend" }, t("Ámbar = sacada de un ping · Morado discontinuo = sugerida, tú decides · Azul = añadida a mano. Los avisos antes del formup valen para todas las activas.")));
}

// ---------- Mes ----------

// Primer día del mes (EVE) desplazado `offset` meses desde el de `now`.
function monthStart(now, offset) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1);
}

function renderMonth(root, now, opts) {
  const start = monthStart(now, opts.monthOffset || 0);
  const first = new Date(start);
  const end = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1);
  const fleets = fleetsBetween(start, end);
  const raw = new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric", timeZone: "UTC" }).format(start);
  const title = raw.charAt(0).toUpperCase() + raw.slice(1);
  root.append(
    h(
      "div",
      { class: "fleet-month-head" },
      h("button", { class: "btn small ghost", type: "button", title: t("Mes anterior"), onclick: () => opts.setMonth((opts.monthOffset || 0) - 1) }, "‹"),
      h("strong", {}, title),
      h("button", { class: "btn small ghost", type: "button", title: t("Mes siguiente"), onclick: () => opts.setMonth((opts.monthOffset || 0) + 1) }, "›"),
      opts.monthOffset ? h("button", { class: "btn small ghost", type: "button", onclick: () => opts.setMonth(0) }, t("Hoy")) : null,
      h("span", { class: "muted small" }, t("horas EVE")),
    ),
  );
  const grid = h("div", { class: "fleet-month" });
  // Semana de lunes a domingo, con los nombres en el idioma de la app.
  const wd = new Intl.DateTimeFormat(locale(), { weekday: "short", timeZone: "UTC" });
  for (let i = 0; i < 7; i++) grid.append(h("div", { class: "fleet-wd" }, wd.format(Date.UTC(2024, 0, 1 + i))));
  const lead = (first.getUTCDay() + 6) % 7;
  const today = dayStart(now);
  for (let cell = 0, day = start - lead * DAY; day < end || cell % 7; cell++, day += DAY) {
    const inMonth = day >= start && day < end;
    const items = inMonth ? fleets.filter((f) => f.at >= day && f.at < day + DAY) : [];
    grid.append(
      h(
        "div",
        { class: `fleet-cell ${inMonth ? "" : "out"} ${day === today ? "today" : ""} ${day < today ? "past" : ""}` },
        h("div", { class: "fleet-cell-day" }, day === today ? t("{d} · hoy", { d: new Date(day).getUTCDate() }) : String(new Date(day).getUTCDate())),
        ...items.slice(0, 4).map((f) =>
          h(
            "button",
            { class: `fleet-pill src-${f.source} st-${f.status}`, type: "button", title: `${eveHM(f.at)} EVE · ${f.title}${f.group ? ` · ${f.group}` : ""}`, onclick: () => (f.source === "ping" ? opts.onShowPing(f.pingKeys.at(-1)) : opts.setView("upcoming")) },
            `${eveHM(f.at)} ${f.title || t("(flota sin título)")}`,
          ),
        ),
        items.length > 4 ? h("div", { class: "muted small" }, t("y {n} más", { n: items.length - 4 })) : null,
      ),
    );
  }
  root.append(grid);
}

// Pinta la vista elegida dentro de `root` (la lista de la vista de pings).
// opts: { onShowPing(pingKey), setView(view), setMonth(offset), monthOffset, refresh() }
export function renderFleetView(root, view, opts, now = Date.now()) {
  const box = h("div", { class: `fleet-view view-${view}` });
  if (view === "month") renderMonth(box, now, opts);
  else renderUpcoming(box, now, opts);
  root.append(box);
}
