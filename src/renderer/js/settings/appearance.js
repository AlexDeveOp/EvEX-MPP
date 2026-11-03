// Preferencias → Apariencia, Colores y Mensajes (temas, fuentes, idioma, exportar e importar temas).
import { S, api } from "../state.js";
import { h, icon, iconButton, field, toggle, select, range, clear, toast } from "../dom.js";
import { PRESETS, TOKENS, BUNDLED_FONTS, themeColors, resolveThemeId } from "../themes.js";
import { t, LANGUAGES, setLanguagePreference } from "../i18n.js";
import { look, full, group } from "./common.js";

let systemFonts = null;

export const appearanceTabs = {
  appearance() {
    const s = S.settings;
    const themeGrid = h("div", { class: "theme-grid" });
    for (const [id, preset] of Object.entries(PRESETS)) {
      themeGrid.append(
        h(
          "button",
          {
            class: `theme-card ${resolveThemeId(s.theme) === id ? "active" : ""}`,
            style: { "--t-bg": preset.bg, "--t-bg2": preset.bg2, "--t-accent": preset.accent, "--t-text": preset.text, "--t-surface": preset.surface, "--t-accent2": preset.accent2 },
            onclick: (e) => {
              look((x) => {
                x.theme = id;
                x.colors = {};
              });
              themeGrid.querySelectorAll(".theme-card").forEach((b) => b.classList.remove("active"));
              e.currentTarget.classList.add("active");
            },
          },
          h("span", { class: "tc-preview" }, h("i", { class: "tc-side" }), h("i", { class: "tc-msg a" }), h("i", { class: "tc-msg b" }), h("i", { class: "tc-dot" })),
          h("span", { class: "tc-name" }, t(preset.name)),
        ),
      );
    }
    const fontOptions = () => [...BUNDLED_FONTS, ...(systemFonts || []).filter((f) => !BUNDLED_FONTS.some(([b]) => b === f)).map((f) => [f, f])];
    const fontSel = select(fontOptions(), s.fontFamily, (v) => look((x) => (x.fontFamily = v)));
    const monoSel = select(fontOptions(), s.monoFamily, (v) => look((x) => (x.monoFamily = v)));
    if (!systemFonts) {
      api("fonts:list").then((list) => {
        systemFonts = list;
        for (const [sel, cur] of [[fontSel, S.settings.fontFamily], [monoSel, S.settings.monoFamily]]) {
          clear(sel);
          for (const [v, l] of fontOptions()) sel.append(h("option", { value: v, selected: v === cur }, l));
        }
      });
    }
    return h(
      "div",
      {},
      group(
        t("Idioma"),
        field(
          t("Idioma de la interfaz"),
          select(
            LANGUAGES.map(([v, label]) => [v, label ?? t("Automático (idioma de Windows)")]),
            s.language || "auto",
            (v) => changeLanguage(v),
          ),
          t("Al cambiarlo, la ventana se recarga con el nuevo idioma"),
        ),
      ),
      group(t("Tema"), themeGrid, h("p", { class: "muted small" }, t("Personaliza cada color en la pestaña «Colores». Puedes exportar e importar temas."))),
      group(
        t("Tipografía"),
        field(t("Fuente de la interfaz"), fontSel, t("Incluye Inter, Nunito, Rajdhani, Orbitron y todas las fuentes instaladas en Windows")),
        field(t("Fuente monoespaciada (código)"), monoSel),
        field(t("Tamaño de letra"), range(11, 22, 1, s.fontSize, (v) => look((x) => (x.fontSize = v)), (v) => `${v}px`)),
        field(t("Escala de la interfaz"), range(0.8, 1.5, 0.05, s.uiScale, (v) => look((x) => (x.uiScale = v)), (v) => `${Math.round(v * 100)}%`)),
      ),
      group(
        t("Disposición"),
        field(t("Densidad"), select([["compact", t("Compacta")], ["cozy", t("Cómoda")], ["spacious", t("Espaciosa")]], s.density, (v) => look((x) => (x.density = v)))),
        toggle(s.layout.compactSidebar, (v) => look((x) => (x.layout.compactSidebar = v)), t("Barra lateral compacta"), t("Oculta estados y reduce el tamaño de los elementos")),
        toggle(s.layout.showOccupants, (v) => look((x) => (x.layout.showOccupants = v)), t("Mostrar lista de participantes en salas")),
        toggle(s.animations !== false, (v) => look((x) => (x.animations = v)), t("Animaciones"), t("Transiciones y entrada suave de mensajes")),
      ),
    );
  },

  colors() {
    const s = S.settings;
    const c = themeColors();
    const grid = h("div", { class: "color-grid" });
    for (const [key, label] of TOKENS) {
      const val = String(c[key] || "#000000");
      const hex = val.slice(0, 7);
      const alpha = val.length === 9 ? val.slice(7) : "";
      const input = h("input", {
        type: "color",
        value: hex,
        oninput: (e) => look((x) => (x.colors = { ...x.colors, [key]: e.target.value + alpha })),
      });
      grid.append(
        h(
          "label",
          { class: `color-item ${s.colors[key] ? "custom" : ""}` },
          input,
          h("span", {}, label),
          s.colors[key]
            ? iconButton("refresh-cw", t("Restaurar color del tema"), (e) => {
                e.preventDefault();
                look((x) => {
                  const { [key]: _, ...rest } = x.colors;
                  x.colors = rest;
                });
                rerenderTab();
              })
            : null,
        ),
      );
    }
    const wrap = h(
      "div",
      {},
      group(
        t("Colores del tema «{name}»", { name: t(PRESETS[resolveThemeId(s.theme)].name) }),
        h("p", { class: "muted small" }, t("Los cambios se aplican al instante. Los colores modificados se marcan y se pueden restaurar uno a uno.")),
        grid,
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn", onclick: () => (look((x) => (x.colors = {})), rerenderTab()) }, icon("refresh-cw"), t("Restaurar todos")),
          h("button", { class: "btn", onclick: exportTheme }, icon("download"), t("Exportar tema")),
          h("button", { class: "btn", onclick: importTheme }, icon("upload"), t("Importar tema")),
        ),
      ),
      group(
        t("Colores de apodos"),
        toggle(s.nickColors, (v) => full((x) => (x.nickColors = v)), t("Colorear cada apodo"), t("Color estable generado a partir del nombre")),
        field(t("Saturación"), range(20, 100, 5, parseInt(c.nickS), (v) => look((x) => (x.colors = { ...x.colors, nickS: `${v}%` })), (v) => `${v}%`)),
        field(t("Luminosidad"), range(25, 85, 1, parseInt(c.nickL), (v) => look((x) => (x.colors = { ...x.colors, nickL: `${v}%` })), (v) => `${v}%`)),
      ),
    );
    function rerenderTab() {
      wrap.replaceWith(appearanceTabs.colors());
    }
    return wrap;
  },

  messages() {
    const s = S.settings;
    const styles = [
      ["modern", t("Moderno"), t("Avatar y nombre, mensajes agrupados")],
      ["bubbles", t("Burbujas"), t("Estilo móvil: los tuyos a la derecha")],
      ["irc", t("Clásico / IRC"), t("Una línea por mensaje: [hora] <apodo> texto")],
      ["pidgin", t("Pidgin"), t("Como Pidgin: (hora) apodo: texto, en color")],
    ];
    return h(
      "div",
      {},
      group(
        t("Estilo de mensajes"),
        h(
          "div",
          { class: "style-grid" },
          styles.map(([id, name, desc]) =>
            h(
              "button",
              {
                class: `style-card ${s.messageStyle === id ? "active" : ""}`,
                onclick: (e) => {
                  look((x) => (x.messageStyle = id));
                  e.currentTarget.parentElement.querySelectorAll(".style-card").forEach((b) => b.classList.toggle("active", b === e.currentTarget));
                },
              },
              h("span", { class: `style-preview sp-${id}` }, h("i"), h("i"), h("i")),
              h("b", {}, name),
              h("small", { class: "muted" }, desc),
            ),
          ),
        ),
        field(t("Redondeo de burbujas"), range(0, 24, 1, s.bubbleRadius, (v) => look((x) => (x.bubbleRadius = v)), (v) => `${v}px`)),
        toggle(s.showAvatars, (v) => look((x) => (x.showAvatars = v)), t("Mostrar avatares")),
        field(t("Agrupar mensajes seguidos del mismo autor durante"), range(0, 30, 1, s.behavior.groupMessagesMinutes, (v) => full((x) => (x.behavior.groupMessagesMinutes = v)), (v) => (v ? `${v} min` : "no agrupar"))),
      ),
      group(
        t("Hora"),
        field(t("Formato"), select([["24", t("24 horas")], ["12", t("12 horas (a. m./p. m.)")]], s.timeFormat, (v) => full((x) => (x.timeFormat = v)))),
        toggle(s.showSeconds, (v) => full((x) => (x.showSeconds = v)), t("Mostrar segundos")),
        toggle(s.showLocalTime !== false, (v) => full((x) => (x.showLocalTime = v)), t("Mostrar la hora local"), t("En los mensajes, las tarjetas de ping y las notificaciones (en gris)")),
        toggle(s.showEveTime !== false, (v) => full((x) => (x.showEveTime = v)), t("Mostrar la hora EVE (UTC)"), t("En los mensajes, las tarjetas de ping y las notificaciones (en ámbar)")),
        toggle(s.showEveClock !== false, (v) => look((x) => (x.showEveClock = v)), t("Reloj EVE en la barra de título")),
      ),
      group(
        t("Contenido"),
        toggle(s.behavior.linkPreviews, (v) => full((x) => (x.behavior.linkPreviews = v)), t("Vista previa de imágenes y vídeos de YouTube"), t("Carga la imagen directamente desde el enlace")),
        toggle(s.behavior.showJoinLeave, (v) => full((x) => (x.behavior.showJoinLeave = v)), t("Mostrar entradas y salidas en las salas")),
        field(t("Mensajes de historial al entrar en una sala"), range(0, 200, 10, s.behavior.mucHistory, (v) => look((x) => (x.behavior.mucHistory = v)), (v) => `${v}`), t("Solo se piden los posteriores al último mensaje guardado")),
      ),
    );
  },

};

// Guarda el idioma ya (sin esperar al guardado diferido) y recarga la interfaz si cambia.
async function changeLanguage(lang) {
  S.settings.language = lang;
  await api("settings:set", S.settings);
  if (setLanguagePreference(lang)) location.reload();
}

export async function exportTheme() {
  const s = S.settings;
  const data = {
    format: "evex-theme/1",
    name: t(PRESETS[resolveThemeId(s.theme)].name),
    base: resolveThemeId(s.theme),
    colors: s.colors,
    fontFamily: s.fontFamily,
    monoFamily: s.monoFamily,
    fontSize: s.fontSize,
    messageStyle: s.messageStyle,
    bubbleRadius: s.bubbleRadius,
    density: s.density,
    background: s.background.type === "gradient" || s.background.type === "color" ? s.background : undefined,
  };
  if (await api("theme:export", data)) toast(t("Tema exportado"), { kind: "ok" });
}

export async function importTheme() {
  try {
    const theme = await api("theme:import");
    if (!theme) return;
    if (theme.format !== "evex-theme/1") throw new Error(t("No es un tema de EvEX-MPP"));
    full((x) => {
      if (PRESETS[theme.base]) x.theme = theme.base;
      x.colors = theme.colors || {};
      for (const k of ["fontFamily", "monoFamily", "fontSize", "messageStyle", "bubbleRadius", "density"]) if (theme[k] != null) x[k] = theme[k];
      if (theme.background) x.background = theme.background;
    });
    toast(t("Tema «{name}» aplicado", { name: theme.name }), { kind: "ok" });
  } catch (e) {
    toast(e.message, { kind: "error" });
  }
}
