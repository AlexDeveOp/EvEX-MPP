// Textos de tiempo sin dependencias de la ventana principal: los usan la app (formup.js, format.js) y la mini ventana.
import { t } from "./i18n.js";

// Texto del chip: «Formup en 12:34», «Formup en 1:05:00», «¡Formup ahora!», «Formup hace 12 min».
// fmt.eveDateTime y fmt.eve dan la fecha y la hora EVE ya formateadas (dependen de los ajustes de la app).
export function countdownText(at, now = Date.now(), fmt = {}) {
  const diff = at - now;
  const pad = (n) => String(n).padStart(2, "0");
  if (diff > 0) {
    const s = Math.ceil(diff / 1000);
    const h = Math.floor(s / 3600);
    const clock = h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    return { state: h >= 24 ? "later" : "soon", text: h >= 24 ? t("Formup el {date} EVE", { date: fmt.eveDateTime?.(at) ?? "" }) : t("Formup en {time}", { time: clock }) };
  }
  if (diff > -15 * 60e3) return { state: "now", text: t("¡Formup ahora!") };
  if (diff > -2 * 3600e3) return { state: "past", text: t("Formup hace {n} min", { n: Math.floor(-diff / 60e3) }) };
  return { state: "old", text: t("Formup a las {time} EVE", { time: fmt.eve?.(at) ?? "" }) };
}

export function timeAgo(ts, now = Date.now()) {
  const s = Math.round((now - ts) / 1000);
  if (s < 60) return t("ahora");
  if (s < 3600) return t("hace {n} min", { n: Math.floor(s / 60) });
  if (s < 86400) return t("hace {n} h", { n: Math.floor(s / 3600) });
  return t("hace {n} d", { n: Math.floor(s / 86400) });
}
