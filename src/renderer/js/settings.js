// Ventana de preferencias y editor de fondos.
import { S, api, emit, saveSettings } from "./state.js";
import { h, icon, iconButton, modal, field, toggle, select, range, clear, toast, debounce, confirmDialog } from "./dom.js";

const append = (el, ...children) => el.append(...children.filter(Boolean));
import { PRESETS, TOKENS, GRADIENTS, BUNDLED_FONTS, applyAppearance, themeColors, backgroundCss, resolveThemeId, applyBackgroundLayer, imageAdjust } from "./themes.js";
import { PRESETS as SOUNDS, SOUND_GROUPS, previewSound, outputDevices } from "./sounds.js";
import { addCustomEmoji, emojifyHtml } from "./emoji.js";
import { BUNDLED_ANIMATED } from "./data/emoji-anim.js";
import { checkUpdatesNow } from "./updates.js";
import { openAccounts, openPidginImport } from "./accounts.js";

import { t, tk, LANGUAGES, setLanguagePreference } from "./i18n.js";
// Cambios solo visuales: se aplican al momento sin repintar mensajes.
function look(fn) {
  fn(S.settings);
  applyAppearance();
  saveSettings();
}
const rerender = debounce(() => emit("settings", S.settings), 200);
function full(fn) {
  fn(S.settings);
  applyAppearance();
  saveSettings();
  rerender();
}

let systemFonts = null;

const TABS = [
  ["appearance", t("Apariencia"), "palette"],
  ["colors", t("Colores"), "brush"],
  ["messages", t("Mensajes"), "message-square"],
  ["backgrounds", t("Fondos"), "image"],
  ["emoji", t("Emojis"), "smile"],
  ["notifications", t("Notificaciones"), "bell"],
  ["pings", t("Pings de flota"), "siren"],
  ["behavior", t("Comportamiento"), "sliders-horizontal"],
  ["data", t("Cuentas y datos"), "database"],
];

export function openSettings(tab = "appearance") {
  const nav = h("nav", { class: "settings-nav" });
  const content = h("div", { class: "settings-content" });
  const show = (id) => {
    tab = id;
    for (const b of nav.children) b.classList.toggle("active", b.dataset.tab === id);
    clear(content);
    const r = RENDER[id]();
    content.append(r);
    content.scrollTop = 0;
  };
  for (const [id, label, ic] of TABS) nav.append(h("button", { class: "settings-tab", dataset: { tab: id }, onclick: () => show(id) }, icon(ic), label));
  modal({ title: t("Preferencias"), icon: "settings", wide: true, className: "settings-modal", body: h("div", { class: "settings-layout" }, nav, content) });
  show(tab);
}

const group = (title, ...children) => h("section", { class: "settings-group" }, h("h3", {}, title), ...children);

const RENDER = {
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
      wrap.replaceWith(RENDER.colors());
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

  backgrounds() {
    return h(
      "div",
      {},
      group(t("Fondo de la ventana"), backgroundEditor(S.settings.background, (fn) => look((x) => fn(x.background)))),
      group(t("Fondo de la barra lateral"), backgroundEditor(S.settings.sidebarBackground, (fn) => look((x) => fn(x.sidebarBackground)), { noDim: true })),
      group(
        t("Fondos por conversación"),
        h("p", { class: "muted small" }, t("Clic derecho en una sala o contacto → «Fondo personalizado…», o menú ⋮ de la sala → «Fondo de esta conversación…». Imagen de tu PC, pegada, arrastrada o de una dirección de Internet, con zoom, posición y encaje.")),
        Object.keys(S.settings.conversationBackgrounds || {}).length
          ? h(
              "div",
              { class: "list" },
              Object.entries(S.settings.conversationBackgrounds).map(([key, bg]) =>
                h(
                  "div",
                  { class: "list-row" },
                  h("span", { class: "bg-swatch", style: { background: backgroundCss(bg) } }),
                  h("span", {}, key.split("|")[1]),
                  h("span", { class: "spacer" }),
                  h("button", { class: "btn small", onclick: () => openBackgroundEditor(key) }, t("Editar")),
                  h("button", { class: "btn small danger ghost", onclick: (e) => (full((x) => delete x.conversationBackgrounds[key]), e.currentTarget.closest(".list-row").remove()) }, t("Quitar")),
                ),
              ),
            )
          : h("p", { class: "muted" }, t("Ninguno todavía.")),
      ),
    );
  },

  emoji() {
    const s = S.settings;
    const sample = "😀 🚀 🔥 👍 🎉 ❤️ 😂 🫡";
    const preview = h("div", { class: "emoji-sample", html: emojifyHtml(sample) });
    const list = h("div", { class: "custom-emoji-list" });
    const renderCustom = () => {
      clear(list);
      for (const c of S.settings.customEmoji) {
        list.append(
          h(
            "div",
            { class: "custom-emoji" },
            h("img", { src: c.url, alt: c.name }),
            h("input", {
              class: "input small",
              value: c.name,
              onchange: (e) => full((x) => (x.customEmoji.find((y) => y.url === c.url).name = e.target.value.toLowerCase().replace(/[^a-z0-9_+-]+/g, "_"))),
            }),
            iconButton("trash-2", t("Quitar"), () => (full((x) => (x.customEmoji = x.customEmoji.filter((y) => y.url !== c.url))), renderCustom())),
          ),
        );
      }
      if (!S.settings.customEmoji.length) list.append(h("p", { class: "muted" }, t("Añade GIF, PNG o WebP (animados también). Se usan escribiendo :nombre:")));
    };
    renderCustom();
    return h(
      "div",
      {},
      group(
        t("Estilo"),
        field(
          t("Dibujo de los emojis"),
          select(
            [
              ["noto-animated", t("Noto animados (Google) — con movimiento")],
              ["noto", t("Noto estáticos (Google)")],
              ["twemoji", t("Twemoji (estilo Twitter/Discord)")],
              ["native", t("Nativos de Windows (sin conexión)")],
            ],
            s.emojiStyle,
            (v) => {
              full((x) => (x.emojiStyle = v));
              preview.innerHTML = emojifyHtml(sample, v);
            },
          ),
          t("Los {n} emojis animados más usados vienen con la app (Animated Noto Emoji © Google, CC BY 4.0). Noto estáticos y Twemoji se descargan de Internet.", { n: BUNDLED_ANIMATED.size }),
        ),
        preview,
        toggle(
          s.downloadEmoji,
          (v) => {
            full((x) => (x.downloadEmoji = v));
            preview.innerHTML = emojifyHtml(sample);
          },
          t("Descargar de Internet los emojis animados que no vienen con la app"),
          t("Se piden a Google (fonts.gstatic.com), que ve tu IP. Desactivado: esos emojis se muestran con el estilo de Windows."),
        ),
        field(t("Tamaño en el texto"), range(1, 2, 0.05, s.emojiSize, (v) => look((x) => (x.emojiSize = v)), (v) => `${Math.round(v * 100)}%`)),
        toggle(s.jumboEmoji, (v) => full((x) => (x.jumboEmoji = v)), t("Emojis grandes cuando el mensaje solo tiene emojis")),
        toggle(s.emoticonToEmoji, (v) => full((x) => (x.emoticonToEmoji = v)), t("Convertir emoticonos de texto"), t("Por ejemplo :) → 🙂, <3 → ❤️, \\o/ → 🙌")),
      ),
      gifsGroup(),
      group(
        t("Emojis personalizados"),
        list,
        h(
          "button",
          {
            class: "btn",
            onclick: async () => {
              const added = await api("emoji:import");
              if (added?.length) {
                addCustomEmoji(added);
                renderCustom();
                toast(t("{length} emoji(s) añadidos", { length: added.length }), { kind: "ok" });
              }
            },
          },
          icon("plus"),
          t("Añadir imágenes…"),
        ),
      ),
    );
  },

  notifications() {
    const n = S.settings.notifications;
    const set = (fn) => look((x) => fn(x.notifications));
    const kw = h("textarea", { class: "input", rows: 2, placeholder: t("Una palabra o frase por línea (p. ej. «cyno», «titan», tu nombre de personaje)"), value: (n.keywords || []).join("\n") });
    kw.value = (n.keywords || []).join("\n");
    kw.addEventListener("change", () => full((x) => (x.notifications.keywords = kw.value.split("\n").map((s) => s.trim()).filter(Boolean))));
    // Una fila por tipo de aviso: lista de sonidos (o archivo propio), volumen propio, prueba y elegir archivo.
    const soundRow = (kind, label) => {
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
    };
    // Salida de audio: se rellena al abrir (la lista depende de los dispositivos conectados).
    const device = select([["", t("Predeterminada de Windows")]], n.outputDevice || "", (v) => (set((x) => (x.outputDevice = v)), previewSound(S.settings.notifications.sounds.private)));
    outputDevices().then((list) => {
      for (const d of list) device.append(h("option", { value: d.id }, d.label));
      device.value = list.some((d) => d.id === n.outputDevice) ? n.outputDevice : "";
    });
    const r = n.pingRepeat || { enabled: false, interval: 30, times: 5 };
    return h(
      "div",
      {},
      group(
        t("General"),
        toggle(n.enabled, (v) => set((x) => (x.enabled = v)), t("Notificaciones de escritorio")),
        toggle(n.dnd, (v) => set((x) => (x.dnd = v)), t("No molestar"), t("Silencia todo excepto los pings de flota y los avisos de conexión perdida o recuperada")),
        toggle(n.showPreview, (v) => set((x) => (x.showPreview = v)), t("Mostrar el texto del mensaje en la notificación")),
        toggle(n.flashTaskbar, (v) => set((x) => (x.flashTaskbar = v)), t("Hacer parpadear la barra de tareas")),
      ),
      group(
        t("Aspecto del aviso"),
        field(
          t("Tipo de notificación"),
          select(
            [
              ["custom", t("Burbuja de EvEX-MPP (sube desde la barra de tareas, siempre encima)")],
              ["windows", t("Notificación de Windows (centro de notificaciones)")],
              ["both", t("Ambas")],
            ],
            n.popupStyle,
            (v) => set((x) => (x.popupStyle = v)),
          ),
          t("La burbuja propia también se ve sobre EVE en modo ventana sin bordes"),
        ),
        field(
          t("Esquina de la pantalla"),
          select(
            [
              ["bottom-left", t("Abajo a la izquierda")],
              ["bottom-right", t("Abajo a la derecha")],
              ["top-left", t("Arriba a la izquierda")],
              ["top-right", t("Arriba a la derecha")],
            ],
            n.popupCorner,
            (v) => set((x) => (x.popupCorner = v)),
          ),
        ),
        field(t("Duración de los avisos de mensajes"), range(3, 30, 1, n.popupDuration, (v) => set((x) => (x.popupDuration = v)), (v) => `${v} s`)),
        toggle(n.pingSticky, (v) => set((x) => (x.pingSticky = v)), t("Los pings se quedan en pantalla hasta cerrarlos"), t("Si no, desaparecen como los mensajes")),
        toggle(n.trayBlink, (v) => set((x) => (x.trayBlink = v)), t("Parpadear el «!» de la bandeja con pings sin leer")),
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn", onclick: () => (api("notify:test", "msg", popupTestColors()), previewSound(S.settings.notifications.sounds.private)) }, icon("message-square"), t("Probar aviso de mensaje")),
          h("button", { class: "btn", onclick: () => (api("notify:test", "ping", popupTestColors()), previewSound(S.settings.notifications.sounds.ping)) }, icon("siren"), t("Probar aviso de ping")),
        ),
      ),
      group(
        t("Cuándo avisar"),
        toggle(n.privateMessages, (v) => set((x) => (x.privateMessages = v)), t("Mensajes privados")),
        toggle(n.mentions, (v) => set((x) => (x.mentions = v)), t("Cuando te mencionan en una sala")),
        toggle(n.allRoomMessages, (v) => set((x) => (x.allRoomMessages = v)), t("Todos los mensajes de todas las salas"), t("Se puede ajustar por sala con clic derecho")),
        toggle(n.pings, (v) => set((x) => (x.pings = v)), t("Pings de flota (remitentes configurados en «Pings de flota»)")),
        field(t("Palabras clave que cuentan como mención"), kw),
      ),
      group(
        t("Sonidos"),
        toggle(n.sound, (v) => set((x) => (x.sound = v)), t("Reproducir sonidos")),
        field(t("Volumen general"), range(0, 1, 0.05, n.volume, (v) => set((x) => (x.volume = v)), (v) => `${Math.round(v * 100)}%`)),
        field(t("Salida de audio"), device, t("Por ejemplo, los auriculares para oír los avisos mientras juegas")),
        h("div", { class: "row" }, h("button", { class: "btn", onclick: importPidginSounds }, icon("import"), t("Importar sonidos de Pidgin"))),
      ),
      SOUND_GROUPS.map(([name, kinds]) =>
        group(
          t("Sonidos: {group}", { group: t(name) }),
          kinds.map(([kind, label]) => soundRow(kind, label)),
          name === "Flota"
            ? [
                toggle(r.enabled, (v) => set((x) => (x.pingRepeat = { ...r, ...x.pingRepeat, enabled: v })), t("Repetir el sonido del ping hasta que mires la ventana"), t("Para no perderte un ping si estás lejos del ordenador")),
                field(t("Repetir cada"), range(10, 120, 5, r.interval, (v) => set((x) => (x.pingRepeat = { ...r, ...x.pingRepeat, interval: v })), (v) => `${v} s`)),
                field(t("Máximo de repeticiones"), range(1, 20, 1, r.times, (v) => set((x) => (x.pingRepeat = { ...r, ...x.pingRepeat, times: v })), (v) => `${v}`)),
              ]
            : null,
        ),
      ),
    );
  },

  pings() {
    const s = S.settings;
    const senders = h("textarea", { class: "input", rows: 3, placeholder: t("p. ej. pingbot@ejemplo.com, o solo «pingbot» para cualquier servidor") });
    senders.value = s.pingSenders.join("\n");
    senders.addEventListener("change", () => full((x) => (x.pingSenders = senders.value.split("\n").map((v) => v.trim().toLowerCase()).filter(Boolean))));
    return h(
      "div",
      {},
      group(
        t("Remitentes de pings"),
        h("p", { class: "muted small" }, t("Los mensajes de estas direcciones aparecen como tarjetas en «Pings de flota», con alarma propia y notificación prioritaria.")),
        field(t("Direcciones (una por línea)"), senders),
      ),
      group(
        t("Aviso visual"),
        field(
          t("La sirena de los pings recientes late…"),
          select(
            [
              ["0", t("Nunca")],
              ["5", t("Durante 5 minutos")],
              ["15", t("Durante 15 minutos")],
              ["30", t("Durante 30 minutos")],
              ["60", t("Durante 1 hora")],
              ["120", t("Durante 2 horas")],
              ["unseen", t("Hasta que vuelvas a abrir los pings")],
            ],
            s.pingHighlight ?? "60",
            (v) => full((x) => (x.pingHighlight = v)),
          ),
          t("Con «hasta que vuelvas a abrir los pings» solo laten los que han llegado desde la última vez que saliste de la vista de pings. Si desactivas las animaciones (Apariencia), no late nunca."),
        ),
      ),
      group(
        t("Importante si usas Pidgin a la vez"),
        h(
          "p",
          { class: "muted" },
          t("Los pings se envían a tu cuenta, no a una sala. Si tienes Pidgin y EvEX-MPP conectados a la vez, el servidor los entrega al cliente con mayor prioridad. Sube la prioridad de esta cuenta (Cuentas → Conexión avanzada) para recibirlos aquí."),
        ),
      ),
    );
  },

  behavior() {
    const b = S.settings.behavior;
    const set = (fn) => look((x) => fn(x.behavior));
    return h(
      "div",
      {},
      group(
        t("Escritura"),
        toggle(b.enterToSend, (v) => set((x) => (x.enterToSend = v)), t("Intro envía el mensaje"), t("Desactivado: Ctrl+Intro envía e Intro hace salto de línea")),
        toggle(b.sendTyping, (v) => set((x) => (x.sendTyping = v)), t("Avisar de que estoy escribiendo (chats privados)")),
        toggle(b.spellcheck, (v) => set((x) => (x.spellcheck = v)), t("Corrector ortográfico")),
        field(
          t("Idiomas del corrector"),
          select([["es-ES,en-US", t("Español + inglés")], ["es-ES", t("Español")], ["en-US", t("Inglés")], ["en-GB", t("Inglés (Reino Unido)")]], b.spellLanguages.join(","), (v) => set((x) => (x.spellLanguages = v.split(",")))),
        ),
      ),
      group(
        t("Ventana"),
        toggle(b.closeToTray, (v) => set((x) => (x.closeToTray = v)), t("Cerrar a la bandeja del sistema"), t("La X oculta la ventana; sales desde el icono de la bandeja")),
        toggle(b.minimizeToTray, (v) => set((x) => (x.minimizeToTray = v)), t("Minimizar a la bandeja del sistema"), t("El botón «_» esconde la ventana junto al reloj en vez de dejarla en la barra de tareas")),
        toggle(b.startMinimized, (v) => set((x) => (x.startMinimized = v)), t("Iniciar minimizado en la bandeja")),
        toggle(b.startWithWindows, (v) => set((x) => (x.startWithWindows = v)), t("Iniciar con Windows")),
        toggle(b.restoreOpenTabs, (v) => set((x) => (x.restoreOpenTabs = v)), t("Restaurar las pestañas abiertas al iniciar")),
      ),
      group(t("Presencia"), field(t("Ponerme «Ausente» tras inactividad"), range(0, 60, 1, b.autoAwayMinutes, (v) => set((x) => (x.autoAwayMinutes = v)), (v) => (v ? `${v} min` : "nunca")))),
    );
  },

  data() {
    return h(
      "div",
      {},
      group(
        t("Cuentas"),
        h("div", { class: "row" }, h("button", { class: "btn", onclick: () => openAccounts() }, icon("user-cog"), t("Gestionar cuentas")), h("button", { class: "btn", onclick: () => openPidginImport() }, icon("import"), t("Importar de Pidgin"))),
      ),
      group(
        t("Temas"),
        h("div", { class: "row" }, h("button", { class: "btn", onclick: exportTheme }, icon("download"), t("Exportar mi tema")), h("button", { class: "btn", onclick: importTheme }, icon("upload"), t("Importar tema"))),
      ),
      group(
        t("Datos locales"),
        h("p", { class: "muted small" }, t("Configuración, historial (JSONL), avatares y archivos personalizados se guardan en la carpeta de datos de la aplicación. Las contraseñas se cifran con DPAPI de Windows.")),
        h("button", { class: "btn", onclick: () => api("shell:openUserData") }, icon("folder-open"), t("Abrir carpeta de datos")),
        h("p", { class: "muted small" }, t("Si importaste el historial de Pidgin con una versión anterior, puede tener fechas cambiadas (día y mes al revés) y miles de avisos de Pidgin (entradas, salidas y desconexiones). La reparación los corrige sin volver a importar.")),
        h("button", { class: "btn", onclick: repairPidginHistory }, icon("wand-sparkles"), t("Reparar historial importado de Pidgin")),
        h("p", { class: "muted small" }, `EvEX-MPP ${S.version}`),
      ),
      group(
        t("Actualizaciones"),
        toggle(
          S.settings.behavior.checkUpdates,
          (v) => look((x) => (x.behavior.checkUpdates = v)),
          t("Avisar cuando haya una versión nueva"),
          t("Una vez al día se consulta la última versión publicada en GitHub (api.github.com), que ve tu IP. No se descarga ni se instala nada: solo se avisa."),
        ),
        h("button", { class: "btn", onclick: checkUpdatesNow }, icon("refresh-cw"), t("Comprobar ahora")),
      ),
    );
  },
};

function popupTestColors() {
  const c = themeColors();
  return { surface: c.surface, text: c.text, border: c.border, warn: c.warn, "theme-accent": c.accent };
}

// Guarda el idioma ya (sin esperar al guardado diferido) y recarga la interfaz si cambia.
async function changeLanguage(lang) {
  S.settings.language = lang;
  await api("settings:set", S.settings);
  if (setLanguagePreference(lang)) location.reload();
}

async function exportTheme() {
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

async function importTheme() {
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

// ---------- editor de fondos ----------

// Imagen del portapapeles para los fondos: se leen sus bytes aquí y el proceso principal la valida y la guarda.
const importBlob = async (blob) => api("image:importBytes", new Uint8Array(await blob.arrayBuffer()), blob.type);
async function pasteImage() {
  let items;
  try {
    items = await navigator.clipboard.read();
  } catch {
    throw new Error(t("No se pudo leer el portapapeles. Prueba con Ctrl+V con el editor abierto."));
  }
  for (const it of items) {
    const type = it.types.find((x) => x.startsWith("image/"));
    if (type) return importBlob(await it.getType(type));
  }
  throw new Error(t("No hay ninguna imagen copiada en el portapapeles."));
}

// Ctrl+V va a un solo editor de fondos: el último en el que se hizo clic o, si solo hay uno abierto, ese.
// (Antes cada editor abierto lo recogía y una imagen pegada cambiaba a la vez el fondo de la ventana y el de la barra.)
let pasteTarget = null;
document.addEventListener("paste", (e) => {
  const open = [...document.querySelectorAll(".bg-editor")].filter((el) => el.isConnected);
  if (!open.length) return;
  const target = pasteTarget?.wrap.isConnected ? pasteTarget : open.length === 1 ? open[0].editor : null;
  const file = [...(e.clipboardData?.items || [])].find((it) => it.kind === "file" && it.type.startsWith("image/"))?.getAsFile();
  const text = e.clipboardData?.getData("text/plain")?.trim() || "";
  const isUrl = /^https?:\/\/\S+$/i.test(text) && !e.target.closest?.("input, textarea");
  if (!file && !isUrl) return;
  e.preventDefault();
  if (!target) return toast(t("Haz clic en el fondo que quieres cambiar y vuelve a pegar."), { kind: "warn" });
  target.importWith(() => (file ? importBlob(file) : api("image:importUrl", text)));
});

const BG_TYPES = [
  ["none", tk("Sin fondo"), "circle-slash"],
  ["gradient", tk("Degradado"), "sparkles"],
  ["color", tk("Color"), "palette"],
  ["image", tk("Imagen"), "image"],
];

function backgroundEditor(bg, change, { noDim } = {}) {
  const wrap = h("div", { class: "bg-editor" });
  const editor = { wrap };
  wrap.editor = editor;
  wrap.addEventListener("pointerdown", () => (pasteTarget = editor));

  // ---- Deshacer: estados anteriores del fondo (hasta 30) ----
  const history = [];
  const snapshot = () => JSON.parse(JSON.stringify(bg));
  const remember = () => {
    history.push(snapshot());
    if (history.length > 30) history.shift();
  };
  const replaceWith = (state) => {
    change((b) => {
      for (const k of Object.keys(b)) delete b[k];
      Object.assign(b, state);
    });
    for (const k of Object.keys(bg)) delete bg[k];
    Object.assign(bg, state);
  };
  // Cambio «grande» (tipo, imagen, degradado, encaje…): se puede deshacer y se repinta el editor.
  const commit = (patch) => {
    remember();
    change((b) => Object.assign(b, patch));
    Object.assign(bg, patch);
    render();
  };
  const undo = () => {
    const prev = history.pop();
    if (!prev) return;
    replaceWith(prev);
    render();
  };

  // ---- Biblioteca de imágenes importadas («Tus imágenes») ----
  // Las importadas y, además, las que ya se usan en algún fondo (incluidas las de antes de existir la lista).
  const library = () => {
    const st = S.settings;
    const used = [st.background, st.sidebarBackground, ...Object.values(st.conversationBackgrounds || {})].filter((b) => b?.type === "image" && String(b.value).startsWith("media:")).map((b) => b.value);
    return [...new Set([...(st.bgLibrary || []), ...used])];
  };
  const addToLibrary = (url) => look((x) => (x.bgLibrary = [url, ...(x.bgLibrary || []).filter((u) => u !== url)].slice(0, 24)));
  const removeFromLibrary = (url) => look((x) => (x.bgLibrary = (x.bgLibrary || []).filter((u) => u !== url)));

  // ---- Importar (archivo, arrastrar, pegar, dirección): siempre disponible, sea cual sea el tipo ----
  editor.importWith = async (fn) => {
    try {
      const url = await fn();
      if (!url) return;
      addToLibrary(url);
      commit({ type: "image", value: url });
    } catch (err) {
      toast(err.message, { kind: "error", timeout: 8000 });
    }
  };
  wrap.addEventListener("dragover", (e) => {
    e.preventDefault();
    wrap.classList.add("drop-over");
  });
  wrap.addEventListener("dragleave", (e) => !wrap.contains(e.relatedTarget) && wrap.classList.remove("drop-over"));
  wrap.addEventListener("drop", (e) => {
    e.preventDefault();
    wrap.classList.remove("drop-over");
    pasteTarget = editor;
    const file = e.dataTransfer.files?.[0];
    const filePath = file && window.evex.pathForFile(file);
    if (filePath) return editor.importWith(() => api("image:importPath", filePath));
    const url = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || "").split(/\s+/)[0];
    if (/^https?:\/\//i.test(url)) return editor.importWith(() => api("image:importUrl", url));
    toast(t("Suelta aquí una imagen de tu PC o de una web."), { kind: "warn" });
  });

  function importSection() {
    const urlInput = h("input", { class: "input bg-url", type: "url", placeholder: t("Dirección de una imagen de Internet (https://…)") });
    const download = () => urlInput.value.trim() && editor.importWith(() => api("image:importUrl", urlInput.value.trim()));
    urlInput.addEventListener("keydown", (e) => e.key === "Enter" && download());
    return h(
      "div",
      { class: "bg-import" },
      h("div", { class: "bg-import-title" }, icon("import"), t("Importar una imagen")),
      h("p", { class: "muted small" }, t("Arrastra aquí una imagen desde el Explorador o el navegador, o pégala con Ctrl+V. JPG, PNG, GIF animado o WebP.")),
      h(
        "div",
        { class: "row" },
        h("button", { class: "btn", type: "button", onclick: () => editor.importWith(() => api("file:pick", "image")) }, icon("folder-open"), t("Elegir archivo…")),
        h("button", { class: "btn", type: "button", title: t("Pega una imagen copiada (Ctrl+V): una captura o una imagen copiada de una web"), onclick: () => editor.importWith(pasteImage) }, icon("copy"), t("Pegar imagen")),
      ),
      h("div", { class: "row" }, urlInput, h("button", { class: "btn", type: "button", onclick: download }, icon("download"), t("Descargar"))),
    );
  }

  const render = () => {
    clear(wrap);
    // ---- Vista previa (en las imágenes: arrastrar mueve, la rueda hace zoom, doble clic centra) ----
    const isImage = bg.type === "image" && !!bg.value;
    const stage = h("div", { class: `bg-preview bg-stage ${isImage ? "interactive" : ""}` });
    const layer = h("div", { class: "bg-stage-layer" });
    stage.append(layer);
    const paint = () => {
      if (bg.type === "image") {
        stage.style.background = "var(--bg)";
        applyBackgroundLayer(layer, bg.value ? { ...bg, opacity: 1, blur: 0 } : null);
      } else {
        applyBackgroundLayer(layer, null);
        stage.style.background = backgroundCss(bg) || "var(--bg)";
      }
    };

    // ---- Tipo, como botones siempre visibles ----
    const typeBar = h(
      "div",
      { class: "bg-types" },
      BG_TYPES.map(([id, label, ic]) =>
        h(
          "button",
          {
            class: `btn small ${bg.type === id ? "primary" : ""}`,
            type: "button",
            onclick: () => {
              if (bg.type === id) return;
              const patch = { type: id };
              if (id === "gradient" && !GRADIENTS[bg.value]) patch.value = "nebula";
              if (id === "color" && !/^#/.test(bg.value)) patch.value = "#101826";
              if (id === "image" && !String(bg.value).startsWith("media:")) patch.value = library()[0] || "";
              commit(patch);
            },
          },
          icon(ic),
          t(label),
        ),
      ),
    );
    const undoBtn = h("button", { class: "btn small", type: "button", disabled: !history.length, title: t("Vuelve al fondo anterior"), onclick: undo }, icon("history"), t("Deshacer"));
    wrap.append(stage, h("div", { class: "bg-toolbar" }, typeBar, h("span", { class: "spacer" }), undoBtn));

    if (bg.type === "gradient") {
      wrap.append(
        h(
          "div",
          { class: "gradient-grid" },
          Object.entries(GRADIENTS).map(([id, css]) =>
            h("button", { class: `gradient-swatch ${bg.value === id ? "active" : ""}`, type: "button", title: id, style: { background: css }, onclick: () => commit({ value: id }) }),
          ),
        ),
      );
    }
    if (bg.type === "color") {
      const input = h("input", { type: "color", value: /^#/.test(bg.value) ? bg.value : "#101826" });
      input.addEventListener("pointerdown", remember);
      input.addEventListener("input", () => {
        change((b) => (b.value = input.value));
        bg.value = input.value;
        paint();
      });
      wrap.append(field(t("Color"), input));
    }
    if (bg.type === "image") {
      // Tus imágenes: un clic vuelve a ponerla; la × la quita de la lista (no borra el fichero).
      const lib = library();
      if (lib.length) {
        wrap.append(
          h("div", { class: "bg-import-title" }, icon("image"), t("Tus imágenes")),
          h(
            "div",
            { class: "bg-library" },
            lib.map((url) =>
              h(
                "button",
                { class: `bg-thumb ${bg.value === url ? "active" : ""}`, type: "button", style: { backgroundImage: `url("${url.replace(/["\\\n]/g, encodeURIComponent)}")` }, onclick: () => bg.value !== url && commit({ value: url }) },
                h(
                  "span",
                  {
                    class: "gif-remove",
                    title: t("Quitar de la lista"),
                    onclick: (ev) => {
                      ev.stopPropagation();
                      removeFromLibrary(url);
                      render();
                    },
                  },
                  "×",
                ),
              ),
            ),
          ),
        );
      }
      if (isImage) {
        const a = imageAdjust(bg);
        const ctl = {};
        const set = (k, v) => {
          change((b) => (b[k] = v));
          bg[k] = v;
          paint();
        };
        // Los deslizadores se pueden deshacer: se guarda el estado al empezar a moverlos.
        const slider = (k, min, max, step, fmt) => {
          const r = range(min, max, step, a[k], (v) => set(k, v), fmt);
          r.querySelector("input").addEventListener("pointerdown", remember);
          ctl[k] = r;
          return r;
        };
        const sync = (k, v) => {
          const inp = ctl[k]?.querySelector("input");
          if (!inp) return;
          inp.value = v;
          inp.dispatchEvent(new Event("input"));
        };
        let drag = null;
        stage.addEventListener("pointerdown", (e) => {
          remember();
          const now = imageAdjust(bg);
          drag = { x: e.clientX, y: e.clientY, posX: now.posX, posY: now.posY, w: stage.clientWidth, h: stage.clientHeight };
          stage.setPointerCapture(e.pointerId);
          stage.classList.add("dragging");
        });
        stage.addEventListener("pointermove", (e) => {
          if (!drag) return;
          const z = imageAdjust(bg).zoom;
          sync("posX", Math.round(Math.min(100, Math.max(0, drag.posX - (((e.clientX - drag.x) / drag.w) * 100) / z))));
          sync("posY", Math.round(Math.min(100, Math.max(0, drag.posY - (((e.clientY - drag.y) / drag.h) * 100) / z))));
        });
        const end = () => {
          drag = null;
          stage.classList.remove("dragging");
        };
        stage.addEventListener("pointerup", end);
        stage.addEventListener("pointercancel", end);
        let wheelUndo = 0;
        stage.addEventListener(
          "wheel",
          (e) => {
            e.preventDefault();
            if (Date.now() - wheelUndo > 800) remember();
            wheelUndo = Date.now();
            sync("zoom", Math.round(Math.min(4, Math.max(1, imageAdjust(bg).zoom - Math.sign(e.deltaY) * 0.1)) * 100) / 100);
          },
          { passive: false },
        );
        stage.addEventListener("dblclick", () => (remember(), sync("posX", 50), sync("posY", 50), sync("zoom", 1)));
        stage.append(h("span", { class: "bg-stage-hint" }, t("Arrastra para mover · rueda para el zoom · doble clic para centrar")));
        wrap.append(
          field(
            t("Encaje"),
            select(
              [
                ["cover", t("Llenar (recorta lo que sobra)")],
                ["contain", t("Ver la imagen entera")],
                ["stretch", t("Estirar")],
                ["tile", t("Mosaico (repetir)")],
                ["original", t("Tamaño original")],
              ],
              a.fit,
              (v) => commit({ fit: v }),
            ),
          ),
          field(t("Zoom"), slider("zoom", 1, 4, 0.05, (v) => `${Math.round(v * 100)}%`)),
          field(t("Posición horizontal"), slider("posX", 0, 100, 1, (v) => `${Math.round(v)}%`)),
          field(t("Posición vertical"), slider("posY", 0, 100, 1, (v) => `${Math.round(v)}%`)),
          field(t("Brillo"), slider("brightness", 0.3, 1.6, 0.05, (v) => `${Math.round(v * 100)}%`)),
          field(t("Saturación"), slider("saturate", 0, 2, 0.05, (v) => `${Math.round(v * 100)}%`)),
          h("div", { class: "row" }, h("button", { class: "btn small", type: "button", onclick: () => commit({ fit: "cover", zoom: 1, posX: 50, posY: 50, brightness: 1, saturate: 1 }) }, icon("refresh-cw"), t("Restablecer ajuste"))),
        );
      } else {
        stage.append(h("span", { class: "bg-stage-hint" }, t("Importa una imagen abajo o elige una de tus imágenes")));
      }
    }
    if (bg.type !== "none") {
      const common = (label, k, min, max, step, def, fmt) => {
        const r = range(min, max, step, bg[k] ?? def, (v) => change((b) => (b[k] = v)), fmt);
        r.querySelector("input").addEventListener("pointerdown", remember);
        return field(label, r);
      };
      append(
        wrap,
        common(t("Intensidad"), "opacity", 0.05, 1, 0.05, 0.35, (v) => `${Math.round(v * 100)}%`),
        common(t("Desenfoque"), "blur", 0, 30, 1, 0, (v) => `${v}px`),
        noDim ? null : common(t("Transparencia de los paneles"), "dim", 0, 1, 0.05, 0.4, (v) => `${Math.round(v * 100)}%`),
      );
    }
    wrap.append(importSection());
    paint();
  };
  render();
  return wrap;
}

export function openBackgroundEditor(key) {
  const existing = S.settings.conversationBackgrounds?.[key];
  const bg = existing ? { ...existing } : { type: "gradient", value: "nebula", opacity: 0.35, blur: 0 };
  const apply = () => {
    S.settings.conversationBackgrounds = { ...S.settings.conversationBackgrounds, [key]: { ...bg } };
    saveSettings();
    emit("conv-bg", key);
  };
  modal({
    title: t("Fondo de {x}", { x: key.split("|")[1] }),
    icon: "image",
    body: backgroundEditor(bg, (fn) => {
      fn(bg);
      apply();
    }),
    actions: [
      {
        label: t("Quitar fondo"),
        danger: true,
        action: (c) => {
          delete S.settings.conversationBackgrounds[key];
          saveSettings();
          emit("conv-bg", key);
          c();
        },
      },
      "spacer",
      { label: t("Listo"), primary: true, action: (c) => (apply(), c()) },
    ],
  });
}

// Copia los sonidos del Pidgin instalado (los personalizados si los hay) y deja elegir a qué avisos aplicarlos.
async function importPidginSounds() {
  const scan = await api("sounds:pidginScan");
  if (!scan.found) return toast(t("No se ha encontrado Pidgin instalado ni sonidos configurados en él."), { kind: "warn" });
  const label = Object.fromEntries(SOUND_GROUPS.flatMap(([, kinds]) => kinds));
  // Los de contactos vienen desmarcados: en salas grandes suenan mucho.
  const checks = Object.entries(scan.sounds).map(([kind, info]) => {
    const input = h("input", { type: "checkbox", checked: !kind.startsWith("contact") });
    return { kind, input, row: h("label", { class: "check-row" }, input, h("span", {}, t(label[kind])), h("span", { class: "muted small" }, `${info.name}${info.custom ? ` (${t("personalizado")})` : ""}`)) };
  });
  modal({
    title: t("Importar sonidos de Pidgin"),
    body: h("div", {}, h("p", { class: "muted small" }, t("Se copian del Pidgin instalado en tu PC. El ping de flota no se cambia.")), checks.map((c) => c.row)),
    actions: [
      { label: t("Cancelar"), action: (close) => close() },
      {
        label: t("Importar"),
        primary: true,
        action: async (close) => {
          const kinds = checks.filter((c) => c.input.checked).map((c) => c.kind);
          const urls = await api("sounds:pidginImport", kinds);
          look((x) => {
            for (const [kind, url] of Object.entries(urls)) x.notifications.sounds[kind] = { ...x.notifications.sounds[kind], preset: "custom", file: url };
          });
          close();
          toast(t("Sonidos de Pidgin importados: {n}", { n: Object.keys(urls).length }), { kind: "ok" });
          // Volver a pintar la pestaña para que se vean los sonidos nuevos.
          document.querySelector('.settings-tab[data-tab="notifications"]')?.click();
        },
      },
    ],
  });
}

// GIFs: buscador opcional con la clave gratuita de cada usuario (las claves no se pueden incluir en un proyecto abierto).
const GIF_KEY_URLS = { giphy: "https://developers.giphy.com/dashboard/", klipy: "https://partner.klipy.com/api-keys" };
function gifsGroup() {
  const g = () => S.settings.gifs;
  const keyRow = h("div");
  const renderKey = () => {
    clear(keyRow);
    const prov = g().provider;
    if (prov === "none") return;
    const name = prov === "giphy" ? "GIPHY" : "KLIPY";
    const input = h("input", { class: "input gif-key", type: "password", autocomplete: "off", spellcheck: "false", placeholder: t("Pega aquí tu clave de {provider}", { provider: name }), value: g().keys?.[prov] || "" });
    input.addEventListener("change", () => look((x) => (x.gifs.keys = { ...x.gifs.keys, [prov]: input.value.trim() })));
    keyRow.append(
      field(
        t("Clave de {provider}", { provider: name }),
        h("div", { class: "row" }, input, h("button", { class: "btn", type: "button", onclick: () => api("shell:open", GIF_KEY_URLS[prov]) }, icon("external-link"), t("Conseguir una clave gratis"))),
        prov === "giphy"
          ? t("La clave gratuita de GIPHY permite 100 búsquedas por hora. Lo que buscas y tu IP llegan a GIPHY. Sus condiciones no permiten guardar sus GIFs en «Mis GIFs».")
          : t("La clave de prueba de KLIPY permite 100 búsquedas por hora. Lo que buscas y tu IP llegan a KLIPY. Sus GIFs no se guardan en «Mis GIFs»."),
      ),
    );
  };
  renderKey();
  return group(
    t("GIFs"),
    h("p", { class: "muted small" }, t("Botón «GIF» junto al de emojis. «Mis GIFs» funciona sin servicios externos: guarda cualquier GIF del chat con clic derecho → «Guardar en Mis GIFs».")),
    field(
      t("Buscador de GIFs"),
      select(
        [
          ["none", t("Ninguno (solo Mis GIFs)")],
          ["giphy", "GIPHY"],
          ["klipy", "KLIPY"],
        ],
        g().provider,
        (v) => (look((x) => (x.gifs.provider = v)), renderKey()),
      ),
      t("Desactivado por defecto. Cada usuario pone su propia clave gratuita."),
    ),
    keyRow,
    field(
      t("Contenido permitido"),
      select(
        [
          ["g", t("Para todos los públicos (G)")],
          ["pg", "PG"],
          ["pg-13", "PG-13"],
          ["r", t("Adultos (R)")],
        ],
        g().rating,
        (v) => look((x) => (x.gifs.rating = v)),
      ),
    ),
  );
}

async function repairPidginHistory() {
  const ok = await confirmDialog({
    title: t("Reparar historial importado de Pidgin"),
    message: t("Se vuelven a leer tus registros de Pidgin (sin cambiarlos) para corregir la fecha de los mensajes mal fechados y quitar los avisos de Pidgin. Antes se hace una copia de seguridad completa del historial en la carpeta de datos."),
    okLabel: t("Reparar"),
  });
  if (!ok) return;
  const busy = toast(t("Reparando el historial…"), { timeout: 0 });
  try {
    const r = await api("pidgin:repairLogs");
    busy();
    if (!r.accounts) return toast(t("No hay historial de Pidgin para ninguna de tus cuentas."), { kind: "warn" });
    await confirmDialog({
      title: t("Historial reparado"),
      message: t("Fechas corregidas: {fixed}. Avisos de Pidgin quitados: {removed}. Copia de seguridad: {backup} (en la carpeta de datos). La ventana se recargará para mostrar el historial corregido.", r),
      okLabel: t("Recargar"),
    });
    location.reload();
  } catch (err) {
    busy();
    toast(t("No se pudo reparar el historial: {message}", { message: err.message }), { kind: "error", timeout: 10000 });
  }
}
