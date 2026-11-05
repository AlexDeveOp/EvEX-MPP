// Guardar un calendario .ics que llega de la ventana (exportar flotas): se valida aquí, en el proceso principal,
// antes de escribir nada, y solo se escribe en la ruta que el usuario elige en el diálogo Guardar.
import path from "node:path";
import { t } from "./i18n.js";

export const ICS_MAX_BYTES = 1024 * 1024;

// El texto debe ser un calendario iCalendar de tamaño razonable.
export function checkIcs(text) {
  if (typeof text !== "string") throw new Error(t("El calendario no es válido."));
  if (Buffer.byteLength(text, "utf8") > ICS_MAX_BYTES) throw new Error(t("El calendario es demasiado grande (máximo 1 MB)."));
  if (!text.startsWith("BEGIN:VCALENDAR\r\n") || !text.trimEnd().endsWith("END:VCALENDAR")) throw new Error(t("El calendario no es válido."));
  return text;
}

// Nombre propuesto para el diálogo: solo el nombre (nada de carpetas), caracteres sencillos y extensión .ics.
export function safeIcsName(name) {
  const base = path.basename(String(name || "").replace(/\\/g, "/"))
    .replace(/\.ics$/i, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 80);
  return `${base || "fleets"}.ics`;
}
