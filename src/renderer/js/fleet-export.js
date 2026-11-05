// «Exportar .ics»: una flota o todas las próximas a un fichero de calendario que el usuario guarda donde quiera
// (diálogo Guardar del proceso principal, «fleets:saveIcs»). Nunca se envía a ningún servicio.
// FC/formup/doctrina salen de fleetDetails (fleets.js) y solo se usan con «Incluir los detalles».
import { api } from "./state.js";
import { h, icon, toast } from "./dom.js";
import { t } from "./i18n.js";
import { fleetsCalendar, exportableFleets, suggestedFileName } from "./ics.js";
import { fleetIcsSettings } from "./settings/fleet-ics.js";
import { fleetDetails, getFleet, upcoming } from "./fleets.js";
import { addFleetHeaderAction, addFleetRowAction } from "./fleet-view.js";

// Opciones del .ics según Preferencias → Pings de flota → «Exportar calendario».
export function icsOptions(cfg = fleetIcsSettings(), infoOf = fleetDetails) {
  return { details: !!cfg.details, includeLink: !!cfg.includeLink, alarmMinutes: cfg.alarm ? Number(cfg.alarm) : null, infoOf };
}

// Devuelve el nombre del fichero guardado, o null si no había nada que exportar o se canceló.
export async function exportFleetsIcs(fleets, { infoOf = fleetDetails } = {}) {
  const list = exportableFleets(fleets);
  if (!list.length) {
    toast(t("No hay flotas activas que exportar."), { kind: "warn" });
    return null;
  }
  const text = fleetsCalendar(list, icsOptions(fleetIcsSettings(), infoOf));
  try {
    const saved = await api("fleets:saveIcs", text, suggestedFileName(list[0].at, { many: list.length > 1 }));
    if (saved) toast(list.length > 1 ? t("Calendario guardado: {n} flotas en {file}", { n: list.length, file: saved }) : t("Calendario guardado: {file}", { file: saved }), { kind: "ok" });
    return saved || null;
  } catch (e) {
    toast(e.message, { kind: "error" });
    return null;
  }
}

// Botones de la vista de flotas: una flota (por su id) o todas las próximas activas.
export const exportFleetIcs = (id) => exportFleetsIcs([getFleet(id)].filter(Boolean));
export const exportUpcomingIcs = (now = Date.now()) => exportFleetsIcs(upcoming({ now, includePending: false }));

// Botones en la vista de flotas (fleet-view.js): «Exportar .ics» en la cabecera (todas las próximas activas) y
// «.ics» en cada flota activa. Se registran una vez al arrancar (app.js).
let registered = false;
export function initFleetExport() {
  if (registered) return;
  registered = true;
  addFleetHeaderAction(() =>
    h("button", { class: "btn small ghost fleet-export-all", type: "button", title: t("Guardar las próximas flotas en un calendario (.ics) para Outlook, Google o Windows"), onclick: () => exportUpcomingIcs() }, icon("calendar"), t("Exportar .ics")),
  );
  addFleetRowAction((fleet) =>
    fleet.status === "active" ? h("button", { class: "btn small ghost fleet-export-one", type: "button", title: t("Guardar esta flota en un calendario (.ics)"), onclick: () => exportFleetIcs(fleet.id) }, icon("download"), ".ics") : null,
  );
}
