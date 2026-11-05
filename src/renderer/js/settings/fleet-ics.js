// Preferencias → Pings de flota → «Exportar calendario»: qué lleva el .ics de las flotas (renderer/js/ics.js).
// Por defecto, lo mínimo («Fleet» + grupo + hora): el calendario puede acabar sincronizado en la nube.
import { S } from "../state.js";
import { h, icon, toggle, field, select } from "../dom.js";
import { t } from "../i18n.js";
import { look, group } from "./common.js";

export const FLEET_ICS_DEFAULTS = { details: false, includeLink: false, alarm: 0 };
export const fleetIcsSettings = () => ({ ...FLEET_ICS_DEFAULTS, ...(S.settings.fleetIcs || {}) });

export function fleetIcsGroup() {
  const cfg = fleetIcsSettings();
  const set = (patch) => look((x) => (x.fleetIcs = { ...FLEET_ICS_DEFAULTS, ...(x.fleetIcs || {}), ...patch }));
  const warning = h("p", { class: "small fleet-ics-warning", hidden: !cfg.details && !cfg.includeLink, style: { color: "var(--warn)" } }, icon("triangle-alert"), " ", t("Cuidado: si importas el calendario en Outlook, Google o un móvil, estos datos pueden acabar en sus servidores y en otros dispositivos. Por defecto el .ics solo lleva «Fleet», el grupo y la hora."));
  const paintWarning = () => {
    const c = fleetIcsSettings();
    warning.hidden = !c.details && !c.includeLink;
  };
  return group(
    t("Exportar calendario"),
    h("p", { class: "muted small" }, t("Con «Exportar .ics» en el calendario de flotas se guarda un fichero que puedes abrir con Outlook, Google Calendar o el calendario de Windows. Se guarda donde tú elijas; no se envía a ningún sitio.")),
    toggle(cfg.details, (v) => (set({ details: v }), paintWarning()), t("Incluir los detalles"), t("Título del ping, FC, formup, doctrina y la nota de la flota.")),
    toggle(cfg.includeLink, (v) => (set({ includeLink: v }), paintWarning()), t("Incluir el enlace de la flota"), t("Por ejemplo, el del calendario de la alianza.")),
    warning,
    field(
      t("Aviso del calendario"),
      select(
        [
          ["0", t("Sin aviso")],
          ["15", t("15 minutos antes")],
          ["30", t("30 minutos antes")],
          ["60", t("1 hora antes")],
        ],
        String(cfg.alarm || 0),
        (v) => set({ alarm: Number(v) }),
      ),
      t("Lo muestra tu programa de calendario; es aparte de los avisos de EvEX-MPP."),
    ),
  );
}
