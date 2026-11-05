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

// ---------- lo que ya está en el calendario ----------
// No se sugiere una flota que ya está en el calendario: una activa (de ping, a mano o aceptada) a ±30 min de la hora
// encontrada. Salvo que el mensaje nombre un grupo distinto del de esa flota (dos ops a la misma hora: caps y subcaps).

export const SAME_FLEET_MS = 30 * 60e3;
// Grupos de destino que se reconocen en un mensaje, y sus otros nombres (también los del pie de los pings).
const GROUPS = {
  caps: ["caps", "capitals?", "capitales?", "allcaps", "dreads?", "dreadnoughts?", "carriers?", "fax(?:es)?"],
  supers: ["supers?", "supercaps?", "supercarriers?", "titans?"],
  subcaps: ["subcaps?", "subcapitals?", "subcapitales?"],
  all: ["all", "everyone", "everybody", "todos"],
};
const GROUP_RES = Object.entries(GROUPS).map(([g, words]) => [g, new RegExp(`^(?:${words.join("|")})$`, "i")]);
const WORD = /[\p{L}\p{N}_]+/gu;

// Nombre de grupo normalizado («Capitales» → caps). Lo que no se reconoce va en minúsculas, tal cual.
export function normGroup(name) {
  const g = String(name || "").replace(INVISIBLE, "").trim().toLowerCase();
  if (!g) return "";
  for (const [canon, re] of GROUP_RES) if (re.test(g)) return canon;
  return g;
}

// El primer grupo conocido que nombra un texto, o "".
export function groupOf(text) {
  for (const w of String(text || "").replace(INVISIBLE, "").match(WORD) || []) {
    for (const [canon, re] of GROUP_RES) if (re.test(w)) return canon;
  }
  return "";
}

// La flota activa que ya cubre esa hora (y ese grupo), o null. Una sin grupo, o un mensaje sin grupo, cuentan como la
// misma op; con los dos grupos conocidos y distintos, son ops distintas.
export function coveringFleet(fleets, at, group = "", { except = "" } = {}) {
  const g = normGroup(group);
  return (
    (fleets || []).find((f) => {
      if (f.id === except || f.status === "pending" || f.status === "dismissed") return false;
      if (Math.abs(f.at - at) > SAME_FLEET_MS) return false;
      const fg = normGroup(f.group);
      return !g || !fg || fg === g;
    }) || null
  );
}

// deps: { parseFleetTime(text, msgTs) → ms | null, addFleet(f), isDismissed(msgKey), allFleets(opts) }.
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
    // También las retiradas solas (ver retireCovered): no vuelven al repasar el historial.
    if (deps.allFleets({ includeDismissed: true }).some((f) => f.msgKey === m.key)) return null;
    const at = deps.parseFleetTime(m.body, m.ts);
    if (!Number.isFinite(at)) return null;
    // Ya pasada (con un margen por si el formup va con retraso) o demasiado lejos para ser de verdad la de este mensaje.
    const n = now();
    if (at < n - grace || at > Math.max(n, m.ts) + maxAhead) return null;
    const group = groupOf(m.body);
    if (coveringFleet(deps.allFleets(), at, group)) return null;
    return deps.addFleet({
      at,
      title: `«${titleFromText(m.body, 70)}»`,
      group,
      note: t("Sugerida: hora encontrada en un mensaje de {nick} en {room}", { nick: m.nick || "?", room: roomName }),
      source: "message",
      msgKey: m.key,
      origin: { accountId, room, nick: m.nick || "" },
    });
  };
}

// Las sugeridas pendientes que ya cubre otra flota (p. ej. llega luego el ping de esa op) se retiran solas: quedan como
// «dismissed» pero sin marcar el mensaje como descartado por el usuario, y no vuelven porque su flota sigue guardada.
// Devuelve cuántas se retiraron.
export function retireCovered(deps) {
  const list = deps.allFleets();
  let n = 0;
  for (const f of list) {
    if (f.status !== "pending" || f.source !== "message") continue;
    if (!coveringFleet(list, f.at, f.group, { except: f.id })) continue;
    deps.updateFleet(f.id, { status: "dismissed" });
    n++;
  }
  return n;
}

// ---------- conexión con fleets.js ----------

let suggester = null;
let stopWatch = null;
let retiring = false;
export function connectSuggestions(deps, opts) {
  stopWatch?.();
  stopWatch = null;
  suggester = deps ? createFleetSuggester(deps, opts) : null;
  // Al cambiar el calendario (llega un ping con hora, se acepta o añade una flota), se retiran las que ya sobran.
  if (deps?.onChange && deps.updateFleet) {
    const check = () => {
      if (retiring) return;
      retiring = true;
      try {
        retireCovered(deps);
      } catch (e) {
        console.error("fleet-suggest", e);
      } finally {
        retiring = false;
      }
    };
    stopWatch = deps.onChange(check) || null;
    check();
  }
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
