// Horas de flotas en texto (pings y mensajes de sala), sin depender de la ventana: hora EVE = UTC.
// La usan formup.js (cuenta atrás y avisos), fleets.js (calendario) y las sugerencias desde salas.
// Entiende «19:00», «1930 EVE», «in 20 min», «tomorrow at 17:15», «tonight», «friday 19:00», «at downtime» (11:00 EVE)
// y fechas AAAA-MM-DD. Sin fecha ni día, una hora más de 6 h anterior al mensaje es del día siguiente.

export const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
const DAY_MS = 86400e3;
const DOWNTIME = [11, 0]; // el mantenimiento diario de EVE empieza a las 11:00 EVE

// Campos que dan la hora: «Formup Time», «Time», «When», «Start Time», «Undock», «Formup» (si lleva hora)…
export const TIME_KEY = /^(?:(?:form\s*-?up|fleet|start|undock|op)\s*)?(?:time|at|when)$|^form\s*-?up$|^undock$/i;
const DATE_RE = /\b(\d{4})[-./](\d{1,2})[-./](\d{1,2})\b/;
const HHMM = String.raw`\b([01]?\d|2[0-3]):([0-5]\d)\b|\b([01]\d|2[0-3])([0-5]\d)(?=\s*(?:eve|utc|et)\b)`;
const RELATIVE_RE = /\b(?:in|en|dentro de)\s+(\d{1,3})\s*(m|mins?|minutes?|minutos?|h|hrs?|hours?|horas?)\b/i;
const WEEKDAYS = ["sun(?:day)?", "mon(?:day)?", "tue(?:s|sday)?", "wed(?:nesday)?", "thu(?:rs?|rsday)?", "fri(?:day)?", "sat(?:urday)?"];
const DAY_WORDS = String.raw`today|tonight|tomorrow|tmrw|tmr|${WEEKDAYS.join("|")}`;
const DAY_RE = new RegExp(String.raw`\b(${DAY_WORDS})\b`, "i");
// En texto libre la hora necesita contexto: «formup at 19:00», «undock 1930 EVE», «fleet @ 19:00», «19:00 EVE»,
// «tomorrow 17:15», «friday 19:00».
const CONTEXT_RE = new RegExp(String.raw`(?:\b(?:form\s*-?up|undock|fleet|start|at|on|${DAY_WORDS})\b|@)[^\n\d]{0,24}(?:${HHMM})|(?:${HHMM})\s*(?:eve|utc|et)\b|\b\d{4}[-./]\d{1,2}[-./]\d{1,2}[ T]+(?:${HHMM})`, "i");
const DOWNTIME_RE = /\b(?:at|after|post)\s+(?:down\s*time|dt)\b|\bdown\s*time\b/i;
// El pie de los broadcasts («~~~ This was a … broadcast … at 2026-11-03 18:00:00 EVE ~~~») es la hora de envío.
const FOOTER_RE = /~~~[^~]*~~~/g;

const clean = (s) => String(s ?? "").replace(INVISIBLE, "").replace(FOOTER_RE, " ");

function relative(text, ts) {
  const m = text.match(RELATIVE_RE);
  if (!m) return null;
  return ts + Number(m[1]) * (/^h/i.test(m[2]) ? 3600e3 : 60e3);
}

// Día del texto: { add: n } (hoy, esta noche, mañana) o { weekday: 0–6 }; null si no dice ninguno.
function dayHint(text) {
  const m = text.match(DAY_RE);
  if (!m) return null;
  const w = m[1].toLowerCase();
  if (w === "today" || w === "tonight") return { add: 0 };
  if (w.startsWith("tom") || w.startsWith("tm")) return { add: 1 };
  const i = WEEKDAYS.findIndex((re) => new RegExp(`^(?:${re})$`, "i").test(w));
  return i >= 0 ? { weekday: i } : null;
}

// Hora hh:mm del día que toque: fecha explícita, día del texto o, si no, el del mensaje (o el siguiente si queda más
// de 6 h antes del mensaje: un ping a las 23:30 para un formup a las 00:15).
function onDay(text, ts, hh, mm) {
  const d = text.match(DATE_RE);
  if (d) return Date.UTC(+d[1], +d[2] - 1, +d[3], hh, mm);
  const base = new Date(ts);
  const day = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hh, mm);
  const hint = dayHint(text);
  if (hint?.add !== undefined) return day + hint.add * DAY_MS;
  if (hint?.weekday !== undefined) {
    let add = (hint.weekday - base.getUTCDay() + 7) % 7;
    if (add === 0 && day < ts - 6 * 3600e3) add = 7; // «friday 19:00» dicho el viernes por la noche: el siguiente
    return day + add * DAY_MS;
  }
  return day < ts - 6 * 3600e3 ? day + DAY_MS : day;
}

// La hora sale de `text`; el día, de `dayText` (por defecto el mismo texto).
function absolute(text, ts, re, dayText = text) {
  const m = text.match(re);
  if (m) {
    const [hh, mm] = m.slice(1).filter((x) => x !== undefined).slice(-2).map(Number);
    return onDay(dayText, ts, hh, mm);
  }
  if (DOWNTIME_RE.test(text)) return onDay(dayText, ts, ...DOWNTIME);
  return null;
}

// Valor de un campo de hora («Formup Time: tomorrow 17:15»): la hora no necesita más contexto. `context` (el resto del
// ping) solo puede dar el día («Tomorrow we form… / Formup Time: 17:15»), nunca la hora.
export function parseFieldTime(value, ts, context = "") {
  if (!ts) return null;
  const v = clean(value);
  const day = DAY_RE.test(v) || DATE_RE.test(v) ? v : `${v}\n${clean(context)}`;
  return relative(v, ts) ?? absolute(v, ts, new RegExp(HHMM, "i"), day);
}

// Texto libre (un ping sin campo de hora o un mensaje de sala) → ms UTC o null.
export function parseFleetTime(text, ts) {
  if (!ts) return null;
  const v = clean(text);
  return relative(v, ts) ?? absolute(v, ts, CONTEXT_RE);
}

// p = resultado de parsePing (el pie «This was a broadcast … at …» es la hora de envío, no la del formup).
export function parseFormup(p, ts) {
  if (!p || !ts) return null;
  // Primero un campo de hora («Formup Time: tomorrow 17:15»); si no, el texto (sin el pie, que es la hora de envío).
  // Clave y valor se unen sin espacio: parsePing parte «fight 21:00 EVE» como si fuera un campo «fight 21: 00 EVE».
  // Con un día en otro sitio del ping («Tomorrow we form… Formup Time: 17:15») cuenta también ese día.
  const text = [p.title, ...(p.fields || []).map((f) => `${f.key}:${f.value}`), ...(p.extra || [])].join("\n");
  for (const f of p.fields || []) {
    if (!TIME_KEY.test(f.key.trim())) continue;
    const at = parseFieldTime(f.value, ts, text);
    if (at) return at;
  }
  return parseFleetTime(text, ts);
}
