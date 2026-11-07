// Modo FC: pings rápidos guardados (S.settings.fcMode.saved) y la sugerencia de grupo de «Pegar texto». Sin DOM.
//
// Un guardado de la plantilla guarda sus campos SIN la hora (se elige cada vez); uno de texto pegado guarda el texto
// TAL CUAL, con sus invisibles, y se envía igual. Ninguno guarda «Añadir a mi calendario». La forma válida la asegura
// normalizeFcMode (src/main/store.js); los topes de aquí son los mismos.
import { templateText } from "./fc-compose.js";
import { parsePing } from "./pings.js";
import { withoutInvisible, trimSpaces } from "./invisible.js";

export const SAVED_MAX = 50;
export const SAVED_TEXT_MAX = 4000;
export const SAVED_ORDERS = ["used", "alpha", "manual"];
const VALUE_KEYS = ["type", "fc", "place", "doctrine", "comms", "pap", "notes"];

const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
export const newId = (now = Date.now()) => `q-${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Solo los campos que se guardan (sin la hora ni el botón de hora rápida).
export const valuesForSave = (values = {}) => Object.fromEntries(VALUE_KEYS.map((k) => [k, String(values[k] ?? "").slice(0, 500)]));

// Nombre que se propone: el tipo y la doctrina de la plantilla, o el título del texto pegado (sin invisibles: el nombre
// es solo una etiqueta para ti; el texto guardado no se toca).
export function defaultName(kind, { values = {}, text = "" } = {}) {
  const raw = kind === "template" ? [values.type, values.doctrine].map((x) => trimSpaces(x)).filter(Boolean).join(" ") : parsePing(String(text)).title;
  return withoutInvisible(raw).replace(/\s+/g, " ").trim().slice(0, 80);
}

export function sortSaved(list = [], order = "used") {
  const out = [...list];
  if (order === "alpha") return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  if (order === "manual") return out;
  return out.sort((a, b) => (b.uses || 0) - (a.uses || 0) || (b.lastUsed || 0) - (a.lastUsed || 0) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

// Guarda (o actualiza el del mismo nombre y tipo, sin perder cuántas veces se ha usado).
// → { saved, item, status: "added" | "updated" | "too-long" | "full" | "no-name" }. Si no se guarda, saved es el mismo.
export function saveQuick(saved = [], { name, kind, values, text, groups = [] }, now = Date.now()) {
  name = trimSpaces(withoutInvisible(name)).slice(0, 80);
  if (!name) return { saved, item: null, status: "no-name" };
  if (kind === "paste" && String(text ?? "").length > SAVED_TEXT_MAX) return { saved, item: null, status: "too-long" };
  const content = {
    kind,
    values: kind === "template" ? valuesForSave(values) : {},
    text: kind === "paste" ? String(text) : "",
    groups: [...new Set(groups.map(String))].slice(0, 20),
  };
  const i = saved.findIndex((q) => q.kind === kind && same(q.name, name));
  if (i >= 0) {
    const item = { ...saved[i], ...content, name };
    return { saved: saved.map((q, j) => (j === i ? item : q)), item, status: "updated" };
  }
  if (saved.length >= SAVED_MAX) return { saved, item: null, status: "full" };
  const item = { id: newId(now), name, ...content, uses: 0, lastUsed: 0, created: now };
  return { saved: [...saved, item], item, status: "added" };
}

export const markUsed = (saved = [], id, now = Date.now()) => saved.map((q) => (q.id === id ? { ...q, uses: (q.uses || 0) + 1, lastUsed: now } : q));

export function renameSaved(saved = [], id, name) {
  name = trimSpaces(withoutInvisible(name)).slice(0, 80);
  if (!name) return saved;
  return saved.map((q) => (q.id === id ? { ...q, name } : q));
}

export const removeSaved = (saved = [], id) => saved.filter((q) => q.id !== id);

// Sube (dir = -1) o baja (dir = 1) uno en el orden «a mano».
export function moveSaved(saved = [], id, dir) {
  const i = saved.findIndex((q) => q.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= saved.length) return saved;
  const out = [...saved];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

// El texto que sale: el de la plantilla de ahora con los campos guardados y la hora elegida, o el pegado tal cual.
export function quickText(fc, item, hm) {
  if (!item) return "";
  if (item.kind === "paste") return item.text;
  return templateText(fc.template.format, { ...item.values, time: hm }, fc.template.fields);
}

// Los grupos guardados que siguen saliendo como botón (en su orden de la barra).
export const savedGroupsIn = (item, barGroups = []) => barGroups.filter((g) => (item?.groups || []).some((n) => same(n, g.name))).map((g) => g.name);

// ---------- sugerencia de grupo («¿Va a caps?») ----------

// Palabras del texto (sin invisibles y en minúsculas; el texto que se envía no se toca).
const words = (text) => withoutInvisible(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

// ¿Habla el texto de este grupo? Su nombre como palabra (con o sin «s» final) o, si es una abreviatura en plural
// («caps», «supers», «dreads»), una palabra que empieza por su raíz: «capitals», «supercapitals»… Para nombres cortos
// sin «s» («all») solo vale la palabra exacta, para no confundir «all» con «alliance».
export function mentionsGroup(text, name) {
  const n = String(name ?? "").toLowerCase();
  if (!n) return false;
  const stem = n.endsWith("s") ? n.slice(0, -1) : n;
  const prefixOk = stem.length >= 3 && (n.endsWith("s") || stem.length >= 5);
  return words(text).some((w) => w === n || w === stem || w === `${n}s` || (prefixOk && w.length > stem.length && w.startsWith(stem)));
}

// Pulsar un grupo de la barra «Para»: lo marca o lo desmarca. Si se desmarca uno que había marcado la sugerencia, queda
// descartado (no se vuelve a marcar) y hay que repintar las tarjetas «¿Va a …?».
// state: { selected, autoMarked, dismissed } (Set). → { selected: boolean, suggestionsChanged: boolean }
export function toggleGroup(state, name) {
  if (state.selected.has(name)) {
    state.selected.delete(name);
    const wasAuto = state.autoMarked.delete(name);
    if (wasAuto) state.dismissed.add(name);
    return { selected: false, suggestionsChanged: wasAuto };
  }
  state.selected.add(name);
  return { selected: true, suggestionsChanged: false };
}

// Grupos de la barra que el texto menciona y aún no están marcados.
export const suggestGroups = (text, groupNames = [], selected = []) => groupNames.filter((g) => !selected.some((s) => same(s, g)) && mentionsGroup(text, g));
