// Modo FC: grupos de destino de los pings (all, caps…).
//
// Quién recibe cada grupo lo decide el servidor de la alianza. La app los aprende del pie de los pings que llegan
// («~~~ This was a … broadcast from Bob FC to caps at … ~~~»; lo reconoce parsePing con FOOTER_RE, también con
// caracteres invisibles por medio) y el usuario añade los que falten a mano.
import { parsePing } from "./pings.js";
import { trimSpaces } from "./invisible.js";

const keyOf = (name) => String(name || "").toLowerCase();

// Grupos vistos en los pings, de más a menos usado: [{ name, count }]. Las mayúsculas no cuentan como otro grupo;
// se queda la forma vista primero.
export function learnedGroups(pingMessages = []) {
  const byKey = new Map();
  for (const m of pingMessages) {
    if (!m || m.out || typeof m.body !== "string") continue;
    const to = trimSpaces(parsePing(m.body).footer?.to || "");
    if (!to) continue;
    const g = byKey.get(keyOf(to));
    if (g) g.count++;
    else byKey.set(keyOf(to), { name: to, count: 1 });
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// Filas de Preferencias → Modo FC → Grupos de destino: los guardados (a mano o aprendidos ya tocados) junto con los
// aprendidos que aún no se han tocado. Cada fila: { name, count, manual, address, button, saved }.
// Un aprendido sin tocar sale sin dirección y sin botón.
export function groupRows(saved = [], learned = []) {
  const counts = new Map(learned.map((g) => [keyOf(g.name), g.count]));
  const rows = saved.map((g) => ({ name: g.name, count: counts.get(keyOf(g.name)) || 0, manual: !!g.manual, address: g.address || "", button: g.button !== false, saved: true }));
  const have = new Set(rows.map((r) => keyOf(r.name)));
  for (const g of learned) if (!have.has(keyOf(g.name))) rows.push({ name: g.name, count: g.count, manual: false, address: "", button: false, saved: false });
  // Los más vistos arriba; los añadidos a mano (sin pings) al final, en el orden en que se añadieron.
  return rows.map((r, i) => ({ r, i })).sort((a, b) => b.r.count - a.r.count || a.i - b.i).map((x) => x.r);
}

// ¿Sale como botón en la barra «Para»? En el modo «una dirección por grupo» hace falta la dirección.
export function groupUsable(row, mode) {
  return !!row.button && (mode !== "address" || !!trimSpaces(row.address || ""));
}

// Guarda un cambio de una fila (dirección, botón…) en la lista de grupos guardados y devuelve la lista nueva.
export function upsertGroup(saved = [], name, patch) {
  const k = keyOf(name);
  const i = saved.findIndex((g) => keyOf(g.name) === k);
  if (i < 0) return [...saved, { name, address: "", button: true, manual: false, ...patch }];
  return saved.map((g, j) => (j === i ? { ...g, ...patch } : g));
}

export function removeGroup(saved = [], name) {
  return saved.filter((g) => keyOf(g.name) !== keyOf(name));
}

export const sameGroup = (a, b) => keyOf(a) === keyOf(b);
