// Reglas por palabra clave: cada regla tiene sus palabras, dónde se aplica y qué hace (aviso, sonido, color).
// La primera regla activa que coincide es la que manda; el orden se cambia en Preferencias → Notificaciones.
import { S } from "./state.js";
import { mentionRegex } from "./format.js";

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

// notify: "always" avisa aunque la sala esté en «solo menciones» o silenciada; "mention" cuenta como mención
// (respeta la sala silenciada); "never" solo resalta. sound.preset "default" usa el sonido normal del aviso.
export const RULE_DEFAULTS = {
  id: "",
  name: "",
  enabled: true,
  words: [],
  match: "word",
  where: { rooms: true, private: true, pings: true },
  notify: "always",
  color: "#f59e0b",
  sound: { preset: "default", file: "", volume: 1 },
  sticky: false,
  dnd: false,
};

export function newRule() {
  return normalizeRule({ id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` });
}

export function normalizeRule(r = {}) {
  return {
    ...RULE_DEFAULTS,
    ...r,
    words: (Array.isArray(r.words) ? r.words : []).map((w) => String(w).trim()).filter(Boolean),
    where: { ...RULE_DEFAULTS.where, ...(r.where || {}) },
    sound: { ...RULE_DEFAULTS.sound, ...(r.sound || {}) },
    color: COLOR_RE.test(r.color || "") ? r.color : RULE_DEFAULTS.color,
  };
}

export const ruleLabel = (r) => r.name || r.words[0] || "";

// Expresión de una regla: palabra completa (como las menciones), texto contenido o expresiones regulares
// (una por línea). Devuelve { re } o { error } si alguna expresión no es válida.
export function compileRule(rule) {
  const words = rule.words.filter(Boolean);
  if (!words.length) return { re: null };
  if (rule.match === "regex") {
    try {
      for (const w of words) new RegExp(w, "u");
      return { re: new RegExp(words.map((w) => `(?:${w})`).join("|"), "giu") };
    } catch (e) {
      return { re: null, error: e.message };
    }
  }
  if (rule.match === "contains") return { re: new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu") };
  return { re: mentionRegex(words) };
}

// Las reglas compiladas se guardan mientras no cambien los ajustes.
let cache = { json: "", list: [] };
export function activeRules(rules = S.settings?.notifications?.keywordRules) {
  const json = JSON.stringify(rules || []);
  if (json !== cache.json) {
    const list = (rules || [])
      .map(normalizeRule)
      .filter((r) => r.enabled)
      .map((r) => ({ rule: r, re: compileRule(r).re }))
      .filter((x) => x.re);
    cache = { json, list };
  }
  return cache.list;
}

// where: "rooms", "private" o "pings". Los caracteres invisibles de los pings no cuentan.
export function matchRule(text, where, rules) {
  if (!text) return null;
  const clean = String(text).replace(INVISIBLE, "");
  for (const { rule, re } of activeRules(rules)) {
    if (!rule.where[where]) continue;
    re.lastIndex = 0;
    if (re.test(clean)) return rule;
  }
  return null;
}

// Para resaltar en el texto: expresión y color de cada regla que se aplica en ese sitio.
export function highlightRules(where, rules) {
  return activeRules(rules)
    .filter(({ rule }) => rule.where[where])
    .map(({ rule, re }) => ({ re, color: rule.color }));
}
