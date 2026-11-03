// Utilidades comunes de Preferencias: guardar ajustes, grupos, filas de sonido y colores de las burbujas de prueba.
import { S, api, emit, saveSettings } from "../state.js";
import { h, iconButton, field, select, range, debounce } from "../dom.js";
import { applyAppearance, themeColors } from "../themes.js";
import { PRESETS as SOUNDS, previewSound } from "../sounds.js";
import { t } from "../i18n.js";

export const append = (el, ...children) => el.append(...children.filter(Boolean));

// Cambios solo visuales: se aplican al momento sin repintar mensajes.
export function look(fn) {
  fn(S.settings);
  applyAppearance();
  saveSettings();
}
const rerender = debounce(() => emit("settings", S.settings), 200);
export function full(fn) {
  fn(S.settings);
  applyAppearance();
  saveSettings();
  rerender();
}

export const group = (title, ...children) => h("section", { class: "settings-group" }, h("h3", {}, title), ...children);

// Una fila por tipo de aviso: lista de sonidos (o archivo propio), volumen propio, prueba y elegir archivo.
export function soundRow(kind, label) {
  const set = (fn) => look((x) => fn(x.notifications));
  const cur = () => S.settings.notifications.sounds[kind];
  const sel = select([...Object.entries(SOUNDS).map(([k, v]) => [k, t(v.name)]), ["custom", t("Archivo propio…")]], cur().preset, async (v) => {
    if (v === "custom" && !cur().file) {
      const url = await api("file:pick", "sound");
      if (!url) return (sel.value = cur().preset);
      set((x) => (x.sounds[kind] = { ...x.sounds[kind], preset: "custom", file: url }));
    } else set((x) => (x.sounds[kind] = { ...x.sounds[kind], preset: v }));
    previewSound(cur());
  });
  const pick = iconButton("folder-open", t("Elegir otro archivo de sonido"), async () => {
    const url = await api("file:pick", "sound");
    if (!url) return;
    set((x) => (x.sounds[kind] = { ...x.sounds[kind], preset: "custom", file: url }));
    sel.value = "custom";
    previewSound(cur());
  });
  const vol = range(0, 1, 0.05, cur().volume ?? 1, (v) => set((x) => (x.sounds[kind] = { ...x.sounds[kind], volume: v })), (v) => `${Math.round(v * 100)}%`);
  vol.classList.add("sound-volume");
  vol.title = t("Volumen de este sonido");
  return field(t(label), h("div", { class: "row sound-row" }, sel, iconButton("volume-2", t("Probar"), () => previewSound(cur())), pick, vol));
}

// Opción que no se puede usar en este sistema: desactivada, apagada y con el motivo debajo.
export function unavailable(row, reason) {
  const input = row.querySelector("input");
  if (input) {
    input.checked = false;
    input.disabled = true;
  }
  row.classList.add("unavailable");
  row.querySelector(".toggle-text")?.append(h("small", { class: "muted" }, reason));
  return row;
}

export function popupTestColors() {
  const c = themeColors();
  return { surface: c.surface, text: c.text, border: c.border, warn: c.warn, "theme-accent": c.accent };
}
