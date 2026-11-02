// Traducción de la interfaz. Los textos originales están en español dentro del código: t("Texto con {variable}", { variable }).
// Cada idioma es un fichero en ../locales/ que asocia el texto español con su traducción.
// El idioma se guarda también en localStorage para conocerlo al cargar los módulos (antes de hablar con el proceso principal).
import en from "../locales/en.js";

const DICTS = { en };
const CACHE_KEY = "evex.lang";

// Etiquetas sin traducir a propósito: cada idioma se muestra en su propio idioma.
export const LANGUAGES = [
  ["auto", null],
  ["es", "Español"],
  ["en", "English"],
];

function systemLang() {
  return /^es\b/i.test(navigator.language || "") ? "es" : "en";
}

export function resolveLang(pref) {
  if (pref === "es" || DICTS[pref]) return pref;
  return systemLang();
}

function cachedPref() {
  try {
    return localStorage.getItem(CACHE_KEY) || "auto";
  } catch {
    return "auto";
  }
}

const lang = resolveLang(cachedPref());
document.documentElement.lang = lang;

export const currentLang = () => lang;

// Marca un texto como traducible sin traducirlo todavía (constantes que se traducen al mostrarlas con t()).
export const tk = (key) => key;

// Configuración regional para fechas y horas.
export const locale = () => (lang === "es" ? "es-ES" : "en-GB");

export function t(key, vars) {
  let s = lang === "es" ? key : (DICTS[lang]?.[key] ?? key);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

// Guarda la preferencia. Devuelve true si el idioma efectivo cambia (hay que recargar la interfaz).
export function setLanguagePreference(pref) {
  try {
    localStorage.setItem(CACHE_KEY, pref || "auto");
  } catch {}
  return resolveLang(pref) !== lang;
}

// Traduce el HTML estático marcado con data-i18n="text title placeholder aria-label".
// La clave es el texto español que ya lleva el elemento.
export function translateStatic(root = document) {
  if (lang === "es") return;
  for (const el of root.querySelectorAll("[data-i18n]")) {
    for (const what of el.dataset.i18n.split(/\s+/)) {
      if (what === "text") {
        const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
        if (node) node.textContent = t(node.textContent.trim());
      } else if (el.hasAttribute(what)) el.setAttribute(what, t(el.getAttribute(what)));
    }
  }
}
