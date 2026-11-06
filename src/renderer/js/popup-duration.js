// Cuánto se queda en pantalla un aviso (la burbuja de un ping o el aviso antes del formup). Lo comparten el proceso
// principal (popups.js) y Preferencias; sin dependencias.
// Valores: "sticky" (hasta cerrarlo), "message" (la duración de los avisos de mensajes) o segundos.
export const DURATION_CHOICES = ["sticky", "message", 10, 30, 60, 300];
const SECONDS = new Set([10, 30, 60, 300]);

// Valor guardado → uno de DURATION_CHOICES. Sin valor nuevo, se usa el interruptor viejo («se queda hasta cerrarlo»):
// true → "sticky", false → "message"; sin ninguno de los dos, "sticky" (lo de siempre).
export function normDuration(value, legacySticky) {
  if (value === "sticky" || value === "message") return value;
  const n = Number(value);
  if (value !== null && value !== "" && SECONDS.has(n)) return n;
  return legacySticky === false ? "message" : "sticky";
}

// Milisegundos que dura el aviso, o null si se queda hasta cerrarlo.
// data: lo que se va a enseñar ({ kind, reminder, duration, sticky }). opts: { pingDuration, messageSeconds }.
// - El aviso del formup (reminder) obedece solo a su opción (antes la de los pings la pisaba).
// - Una regla por palabra clave que pide «se queda» (data.sticky sin reminder) se queda.
// - Un ping, según «Cuánto se queda el aviso del ping»; lo demás, como los mensajes.
export function popupTimeout(data, { pingDuration = "sticky", messageSeconds = 8 } = {}) {
  const message = Math.max(3, Number(messageSeconds) || 8) * 1000;
  const toMs = (d) => (d === "sticky" ? null : d === "message" ? message : d * 1000);
  if (data?.reminder) return toMs(normDuration(data.duration, data.sticky));
  if (data?.sticky) return null;
  if (data?.kind === "ping") return toMs(normDuration(pingDuration));
  return message;
}
