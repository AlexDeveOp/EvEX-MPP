// Traducción en el proceso principal (bandeja, menús, diálogos y errores). Usa los mismos ficheros que la interfaz.
import { app } from "electron";
import en from "../renderer/locales/en.js";

const DICTS = { en };
let lang = "es";

// pref: "auto" | "es" | "en". «auto» sigue el idioma de Windows (solo se conoce tras app.whenReady).
export function setLanguage(pref) {
  const system = /^es\b/i.test(app.getLocale?.() || "") ? "es" : "en";
  lang = pref === "es" || DICTS[pref] ? pref : system;
  return lang;
}

export const currentLang = () => lang;

// Marca un texto como traducible sin traducirlo todavía (constantes que se traducen al mostrarlas con t()).
export const tk = (key) => key;

export function t(key, vars) {
  let s = lang === "es" ? key : (DICTS[lang]?.[key] ?? key);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}
