// Flotas sugeridas: horas de flota que aparecen en los mensajes de las salas («big op on friday at 21:00»). Salen en la
// agenda como pendientes (morado discontinuo, con «Añadir» y «Descartar», en la vista de fleets.js) y nunca entran solas.
// La hora la lee parseFleetTime (formup.js); el almacén y las descartadas son de fleets.js. Se inyectan con
// connectSuggestions() para poder probar esto sin ellos.
import { t } from "./i18n.js";

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
// Solo se buscan horas en mensajes que hablan de una flota: si no, cualquier «a las 21:00» sería una sugerida.
const FLEET_WORDS = /(?<![\p{L}\p{N}_])(fleets?|ops?|stratops?|strat op|cta|form ?ups?|formup|roams?|timers?|undock|pap|flotas?|quedada|operaci[oó]n)(?![\p{L}\p{N}_])/iu;

export function looksLikeFleet(text) {
  return FLEET_WORDS.test(String(text || "").replace(INVISIBLE, ""));
}

// Primera línea con texto, recortada (para el título de la flota). El texto va TAL CUAL, con sus caracteres
// invisibles: algunas alianzas los usan como marca de agua y la app nunca los quita de lo que guarda o enseña. Solo se
// ignoran para decidir si una línea está vacía. El recorte cuenta puntos de código, para no partir un emoji.
// (trim() no vale: también quita U+FEFF, que es uno de esos invisibles.)
const SPACES = /^[ \t\r\f\v]+|[ \t\r\f\v]+$/g;
export function titleFromText(text, max = 80) {
  const line =
    String(text || "")
      .split("\n")
      .map((l) => l.replace(SPACES, ""))
      .find((l) => l.replace(INVISIBLE, "").trim()) || "";
  const chars = Array.from(line);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").replace(SPACES, "")}…` : line;
}

// deps: { parseFleetTime(text, msgTs) → ms | null, addFleet(f), isDismissed(msgKey), allFleets() }.
// Devuelve consider(accountId, room, mensaje, { roomName }) → la flota creada o null.
export function createFleetSuggester(deps, { now = () => Date.now(), maxAhead = 14 * 86400e3, grace = 30 * 60e3 } = {}) {
  const seen = new Set();
  return function consider(accountId, room, m, { roomName = room } = {}) {
    if (!m?.body || !m.key || m.out || m.sys || m.editOf || m.rep) return null;
    if (seen.has(m.key)) return null;
    seen.add(m.key);
    if (seen.size > 5000) seen.clear();
    if (!looksLikeFleet(m.body)) return null;
    if (deps.isDismissed(m.key)) return null;
    if (deps.allFleets().some((f) => f.msgKey === m.key)) return null;
    const at = deps.parseFleetTime(m.body, m.ts);
    if (!Number.isFinite(at)) return null;
    // Ya pasada (con un margen por si el formup va con retraso) o demasiado lejos para ser de verdad la de este mensaje.
    const n = now();
    if (at < n - grace || at > Math.max(n, m.ts) + maxAhead) return null;
    return deps.addFleet({
      at,
      title: `«${titleFromText(m.body, 70)}»`,
      group: "",
      note: t("Sugerida: hora encontrada en un mensaje de {nick} en {room}", { nick: m.nick || "?", room: roomName }),
      source: "message",
      msgKey: m.key,
    });
  };
}

// ---------- conexión con fleets.js ----------

let suggester = null;
export function connectSuggestions(deps, opts) {
  suggester = deps ? createFleetSuggester(deps, opts) : null;
}

// Un mensaje de sala (en directo o del historial). Sin el calendario conectado no hace nada.
export function considerRoomMessage(accountId, room, m, opts) {
  if (!suggester) return null;
  try {
    return suggester(accountId, room, m, opts);
  } catch (e) {
    console.error("fleet-suggest", e);
    return null;
  }
}
