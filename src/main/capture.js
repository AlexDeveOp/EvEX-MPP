// Modo captura (para compartir pantalla o retransmitir): lo que sale de la ventana principal va sin contenido.
// Funciones puras: el proceso principal las aplica a cada aviso (burbuja y notificación del sistema) y a los datos de la
// mini ventana mientras el modo está activo. El texto original no se toca: se manda otro objeto en su lugar.
import { t } from "./i18n.js";

// Solo lo que hace falta para que el aviso funcione: abrir la conversación al pulsarlo, colores, cuánto se queda
// (sticky; duration y reminder en los avisos del formup, ver popup-duration.js). Nada de eso es contenido.
const KEEP = ["kind", "sticky", "duration", "reminder", "accountId", "conv", "convType", "colors"];

export function captureNotification(data = {}) {
  const out = {};
  for (const k of KEEP) if (data[k] !== undefined) out[k] = data[k];
  out.title = data.kind === "ping" ? t("Nuevo ping de flota") : t("Nuevo mensaje");
  out.text = "";
  out.fields = [];
  return out;
}

// settings.capture solo lo cambia el proceso principal (capture:set, bandeja, atajo, --toggle-capture). Cuando la
// ventana guarda todos sus ajustes, su copia puede ser de antes de un cambio hecho desde la bandeja: se conserva el del
// proceso principal para no deshacerlo.
export function keepCapture(incoming, current) {
  return { ...incoming, capture: current?.capture ?? incoming?.capture };
}

// Mini ventana: solo los contadores. Ni el último ping ni las próximas flotas (la hora del formup también es de la op).
// Lista blanca: si algún día la mini enseña algo nuevo, no se cuela en modo captura sin pensarlo.
const MINI_KEEP = ["unread", "pings", "mentions", "clickThrough", "lang", "colors"];
export function captureMiniState(state) {
  if (!state) return state;
  const out = { ping: null, fleets: [], countdown: false, capture: true };
  for (const k of MINI_KEEP) if (state[k] !== undefined) out[k] = state[k];
  return out;
}
