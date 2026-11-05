// «Exportar .ics»: una flota o todas las próximas a un fichero de calendario que el usuario guarda donde quiera
// (diálogo Guardar del proceso principal, «fleets:saveIcs»). Nunca se envía a ningún servicio.
// infoOf(fleet) → { fc, formup, doctrine }: fleetDetails de fleets.js (solo se usa con «Incluir los detalles»).
import { api } from "./state.js";
import { toast } from "./dom.js";
import { t } from "./i18n.js";
import { fleetsCalendar, exportableFleets, suggestedFileName } from "./ics.js";
import { fleetIcsSettings } from "./settings/fleet-ics.js";

// Opciones del .ics según Preferencias → Pings de flota → «Exportar calendario».
export function icsOptions(cfg = fleetIcsSettings(), infoOf = () => ({})) {
  return { details: !!cfg.details, includeLink: !!cfg.includeLink, alarmMinutes: cfg.alarm ? Number(cfg.alarm) : null, infoOf };
}

// Devuelve el nombre del fichero guardado, o null si no había nada que exportar o se canceló.
export async function exportFleetsIcs(fleets, { infoOf } = {}) {
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
