// Ventana de preferencias y editor de fondos.
import { S, api, emit, saveSettings, updateSettings } from "./state.js";
import { h, icon, iconButton, modal, field, toggle, select, range, clear, toast, debounce } from "./dom.js";

const append = (el, ...children) => el.append(...children.filter(Boolean));
import { PRESETS, TOKENS, GRADIENTS, BUNDLED_FONTS, applyAppearance, themeColors, backgroundCss, resolveThemeId } from "./themes.js";
import { PRESETS as SOUNDS, SOUND_KINDS, previewSound } from "./sounds.js";
import { addCustomEmoji, emojifyHtml } from "./emoji.js";
import { openAccounts, openPidginImport } from "./accounts.js";

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
  ["appearance", "Apariencia", "palette"],
  ["colors", "Colores", "brush"],
  ["messages", "Mensajes", "message-square"],
  ["backgrounds", "Fondos", "image"],
  ["emoji", "Emojis", "smile"],
  ["notifications", "Notificaciones", "bell"],
  ["pings", "Pings de flota", "siren"],
  ["behavior", "Comportamiento", "sliders-horizontal"],
  ["data", "Cuentas y datos", "database"],
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
  modal({ title: "Preferencias", icon: "settings", wide: true, className: "settings-modal", body: h("div", { class: "settings-layout" }, nav, content) });
  show(tab);
}

const group = (title, ...children) => h("section", { class: "settings-group" }, h("h3", {}, title), ...children);

const RENDER = {
  appearance() {
    const s = S.settings;
    const themeGrid = h("div", { class: "theme-grid" });
    for (const [id, t] of Object.entries(PRESETS)) {
      themeGrid.append(
        h(
          "button",
          {
            class: `theme-card ${resolveThemeId(s.theme) === id ? "active" : ""}`,
            style: { "--t-bg": t.bg, "--t-bg2": t.bg2, "--t-accent": t.accent, "--t-text": t.text, "--t-surface": t.surface, "--t-accent2": t.accent2 },
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
          h("span", { class: "tc-name" }, t.name),
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
      group("Tema", themeGrid, h("p", { class: "muted small" }, "Personaliza cada color en la pestaña «Colores». Puedes exportar e importar temas.")),
      group(
        "Tipografía",
        field("Fuente de la interfaz", fontSel, "Incluye Inter, Nunito, Rajdhani, Orbitron y todas las fuentes instaladas en Windows"),
        field("Fuente monoespaciada (código)", monoSel),
        field("Tamaño de letra", range(11, 22, 1, s.fontSize, (v) => look((x) => (x.fontSize = v)), (v) => `${v}px`)),
        field("Escala de la interfaz", range(0.8, 1.5, 0.05, s.uiScale, (v) => look((x) => (x.uiScale = v)), (v) => `${Math.round(v * 100)}%`)),
      ),
      group(
        "Disposición",
        field("Densidad", select([["compact", "Compacta"], ["cozy", "Cómoda"], ["spacious", "Espaciosa"]], s.density, (v) => look((x) => (x.density = v)))),
        toggle(s.layout.compactSidebar, (v) => look((x) => (x.layout.compactSidebar = v)), "Barra lateral compacta", "Oculta estados y reduce el tamaño de los elementos"),
        toggle(s.layout.showOccupants, (v) => look((x) => (x.layout.showOccupants = v)), "Mostrar lista de participantes en salas"),
        toggle(s.animations !== false, (v) => look((x) => (x.animations = v)), "Animaciones", "Transiciones y entrada suave de mensajes"),
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
            ? iconButton("refresh-cw", "Restaurar color del tema", (e) => {
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
        `Colores del tema «${PRESETS[resolveThemeId(s.theme)].name}»`,
        h("p", { class: "muted small" }, "Los cambios se aplican al instante. Los colores modificados se marcan y se pueden restaurar uno a uno."),
        grid,
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn", onclick: () => (look((x) => (x.colors = {})), rerenderTab()) }, icon("refresh-cw"), "Restaurar todos"),
          h("button", { class: "btn", onclick: exportTheme }, icon("download"), "Exportar tema"),
          h("button", { class: "btn", onclick: importTheme }, icon("upload"), "Importar tema"),
        ),
      ),
      group(
        "Colores de apodos",
        toggle(s.nickColors, (v) => full((x) => (x.nickColors = v)), "Colorear cada apodo", "Color estable generado a partir del nombre"),
        field("Saturación", range(20, 100, 5, parseInt(c.nickS), (v) => look((x) => (x.colors = { ...x.colors, nickS: `${v}%` })), (v) => `${v}%`)),
        field("Luminosidad", range(25, 85, 1, parseInt(c.nickL), (v) => look((x) => (x.colors = { ...x.colors, nickL: `${v}%` })), (v) => `${v}%`)),
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
      ["modern", "Moderno", "Avatar y nombre, mensajes agrupados"],
      ["bubbles", "Burbujas", "Estilo móvil: los tuyos a la derecha"],
      ["irc", "Clásico / IRC", "Una línea por mensaje: [hora] <apodo> texto"],
      ["pidgin", "Pidgin", "Como Pidgin: (hora) apodo: texto, en color"],
    ];
    return h(
      "div",
      {},
      group(
        "Estilo de mensajes",
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
        field("Redondeo de burbujas", range(0, 24, 1, s.bubbleRadius, (v) => look((x) => (x.bubbleRadius = v)), (v) => `${v}px`)),
        toggle(s.showAvatars, (v) => look((x) => (x.showAvatars = v)), "Mostrar avatares"),
        field("Agrupar mensajes seguidos del mismo autor durante", range(0, 30, 1, s.behavior.groupMessagesMinutes, (v) => full((x) => (x.behavior.groupMessagesMinutes = v)), (v) => (v ? `${v} min` : "no agrupar"))),
      ),
      group(
        "Hora",
        field("Formato", select([["24", "24 horas"], ["12", "12 horas (a. m./p. m.)"]], s.timeFormat, (v) => full((x) => (x.timeFormat = v)))),
        toggle(s.showSeconds, (v) => full((x) => (x.showSeconds = v)), "Mostrar segundos"),
        toggle(s.showLocalTime !== false, (v) => full((x) => (x.showLocalTime = v)), "Mostrar la hora local", "En los mensajes, las tarjetas de ping y las notificaciones (en gris)"),
        toggle(s.showEveTime !== false, (v) => full((x) => (x.showEveTime = v)), "Mostrar la hora EVE (UTC)", "En los mensajes, las tarjetas de ping y las notificaciones (en ámbar)"),
        toggle(s.showEveClock !== false, (v) => look((x) => (x.showEveClock = v)), "Reloj EVE en la barra de título"),
      ),
      group(
        "Contenido",
        toggle(s.behavior.linkPreviews, (v) => full((x) => (x.behavior.linkPreviews = v)), "Vista previa de imágenes y vídeos de YouTube", "Carga la imagen directamente desde el enlace"),
        toggle(s.behavior.showJoinLeave, (v) => full((x) => (x.behavior.showJoinLeave = v)), "Mostrar entradas y salidas en las salas"),
        field("Mensajes de historial al entrar en una sala", range(0, 200, 10, s.behavior.mucHistory, (v) => look((x) => (x.behavior.mucHistory = v)), (v) => `${v}`), "Solo se piden los posteriores al último mensaje guardado"),
      ),
    );
  },

  backgrounds() {
    return h(
      "div",
      {},
      group("Fondo de la ventana", backgroundEditor(S.settings.background, (fn) => look((x) => fn(x.background)))),
      group("Fondo de la barra lateral", backgroundEditor(S.settings.sidebarBackground, (fn) => look((x) => fn(x.sidebarBackground)), { noDim: true })),
      group(
        "Fondos por conversación",
        h("p", { class: "muted small" }, "Clic derecho en una sala o contacto → «Fondo personalizado…»."),
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
                  h("button", { class: "btn small", onclick: () => openBackgroundEditor(key) }, "Editar"),
                  h("button", { class: "btn small danger ghost", onclick: (e) => (full((x) => delete x.conversationBackgrounds[key]), e.currentTarget.closest(".list-row").remove()) }, "Quitar"),
                ),
              ),
            )
          : h("p", { class: "muted" }, "Ninguno todavía."),
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
            iconButton("trash-2", "Quitar", () => (full((x) => (x.customEmoji = x.customEmoji.filter((y) => y.url !== c.url))), renderCustom())),
          ),
        );
      }
      if (!S.settings.customEmoji.length) list.append(h("p", { class: "muted" }, "Añade GIF, PNG o WebP (animados también). Se usan escribiendo :nombre:"));
    };
    renderCustom();
    return h(
      "div",
      {},
      group(
        "Estilo",
        field(
          "Dibujo de los emojis",
          select(
            [
              ["noto-animated", "Noto animados (Google) — con movimiento"],
              ["noto", "Noto estáticos (Google)"],
              ["twemoji", "Twemoji (estilo Twitter/Discord)"],
              ["native", "Nativos de Windows (sin conexión)"],
            ],
            s.emojiStyle,
            (v) => {
              full((x) => (x.emojiStyle = v));
              preview.innerHTML = emojifyHtml(sample, v);
            },
          ),
          "Los animados y Noto/Twemoji se descargan de Internet la primera vez",
        ),
        preview,
        field("Tamaño en el texto", range(1, 2, 0.05, s.emojiSize, (v) => look((x) => (x.emojiSize = v)), (v) => `${Math.round(v * 100)}%`)),
        toggle(s.jumboEmoji, (v) => full((x) => (x.jumboEmoji = v)), "Emojis grandes cuando el mensaje solo tiene emojis"),
        toggle(s.emoticonToEmoji, (v) => full((x) => (x.emoticonToEmoji = v)), "Convertir emoticonos de texto", "Por ejemplo :) → 🙂, <3 → ❤️, \\o/ → 🙌"),
      ),
      group(
        "Emojis personalizados",
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
                toast(`${added.length} emoji(s) añadidos`, { kind: "ok" });
              }
            },
          },
          icon("plus"),
          "Añadir imágenes…",
        ),
      ),
    );
  },

  notifications() {
    const n = S.settings.notifications;
    const set = (fn) => look((x) => fn(x.notifications));
    const kw = h("textarea", { class: "input", rows: 2, placeholder: "Una palabra o frase por línea (p. ej. «cyno», «titan», tu nombre de personaje)", value: (n.keywords || []).join("\n") });
    kw.value = (n.keywords || []).join("\n");
    kw.addEventListener("change", () => full((x) => (x.notifications.keywords = kw.value.split("\n").map((s) => s.trim()).filter(Boolean))));
    // Una fila por tipo de aviso: lista de sonidos (o archivo propio) y botón de prueba.
    const soundRow = (kind, label) => {
      const cur = () => S.settings.notifications.sounds[kind];
      const fileLabel = h("span", { class: "muted small ellipsis" }, cur().file ? "Archivo propio" : "");
      const sel = select([...Object.entries(SOUNDS).map(([k, v]) => [k, v.name]), ["custom", "Archivo propio…"]], cur().preset, async (v) => {
        if (v === "custom" && !cur().file) {
          const url = await api("file:pick", "sound");
          if (!url) return (sel.value = cur().preset);
          set((x) => (x.sounds[kind] = { preset: "custom", file: url }));
          fileLabel.textContent = "Archivo propio";
        } else set((x) => (x.sounds[kind] = { ...x.sounds[kind], preset: v }));
        previewSound(cur());
      });
      const pick = iconButton("folder-open", "Elegir otro archivo de sonido", async () => {
        const url = await api("file:pick", "sound");
        if (!url) return;
        set((x) => (x.sounds[kind] = { preset: "custom", file: url }));
        sel.value = "custom";
        fileLabel.textContent = "Archivo propio";
        previewSound(cur());
      });
      return field(label, h("div", { class: "row" }, sel, iconButton("volume-2", "Probar", () => previewSound(cur())), pick, fileLabel));
    };
    return h(
      "div",
      {},
      group(
        "General",
        toggle(n.enabled, (v) => set((x) => (x.enabled = v)), "Notificaciones de escritorio"),
        toggle(n.dnd, (v) => set((x) => (x.dnd = v)), "No molestar", "Silencia todo excepto los pings de flota"),
        toggle(n.showPreview, (v) => set((x) => (x.showPreview = v)), "Mostrar el texto del mensaje en la notificación"),
        toggle(n.flashTaskbar, (v) => set((x) => (x.flashTaskbar = v)), "Hacer parpadear la barra de tareas"),
      ),
      group(
        "Aspecto del aviso",
        field(
          "Tipo de notificación",
          select(
            [
              ["custom", "Burbuja de EvEX-MPP (sube desde la barra de tareas, siempre encima)"],
              ["windows", "Notificación de Windows (centro de notificaciones)"],
              ["both", "Ambas"],
            ],
            n.popupStyle,
            (v) => set((x) => (x.popupStyle = v)),
          ),
          "La burbuja propia también se ve sobre EVE en modo ventana sin bordes",
        ),
        field(
          "Esquina de la pantalla",
          select(
            [
              ["bottom-left", "Abajo a la izquierda"],
              ["bottom-right", "Abajo a la derecha"],
              ["top-left", "Arriba a la izquierda"],
              ["top-right", "Arriba a la derecha"],
            ],
            n.popupCorner,
            (v) => set((x) => (x.popupCorner = v)),
          ),
        ),
        field("Duración de los avisos de mensajes", range(3, 30, 1, n.popupDuration, (v) => set((x) => (x.popupDuration = v)), (v) => `${v} s`)),
        toggle(n.pingSticky, (v) => set((x) => (x.pingSticky = v)), "Los pings se quedan en pantalla hasta cerrarlos", "Si no, desaparecen como los mensajes"),
        toggle(n.trayBlink, (v) => set((x) => (x.trayBlink = v)), "Parpadear el «!» de la bandeja con pings sin leer"),
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn", onclick: () => (api("notify:test", "msg", popupTestColors()), previewSound(S.settings.notifications.sounds.private)) }, icon("message-square"), "Probar aviso de mensaje"),
          h("button", { class: "btn", onclick: () => (api("notify:test", "ping", popupTestColors()), previewSound(S.settings.notifications.sounds.ping)) }, icon("siren"), "Probar aviso de ping"),
        ),
      ),
      group(
        "Cuándo avisar",
        toggle(n.privateMessages, (v) => set((x) => (x.privateMessages = v)), "Mensajes privados"),
        toggle(n.mentions, (v) => set((x) => (x.mentions = v)), "Cuando te mencionan en una sala"),
        toggle(n.allRoomMessages, (v) => set((x) => (x.allRoomMessages = v)), "Todos los mensajes de todas las salas", "Se puede ajustar por sala con clic derecho"),
        toggle(n.pings, (v) => set((x) => (x.pings = v)), "Pings de flota (remitentes configurados en «Pings de flota»)"),
        field("Palabras clave que cuentan como mención", kw),
      ),
      group(
        "Sonidos",
        toggle(n.sound, (v) => set((x) => (x.sound = v)), "Reproducir sonidos"),
        SOUND_KINDS.map(([kind, label]) => soundRow(kind, label)),
        field("Volumen", range(0, 1, 0.05, n.volume, (v) => set((x) => (x.volume = v)), (v) => `${Math.round(v * 100)}%`)),
      ),
    );
  },

  pings() {
    const s = S.settings;
    const senders = h("textarea", { class: "input", rows: 3, placeholder: "p. ej. pingbot@ejemplo.com, o solo «pingbot» para cualquier servidor" });
    senders.value = s.pingSenders.join("\n");
    senders.addEventListener("change", () => full((x) => (x.pingSenders = senders.value.split("\n").map((v) => v.trim().toLowerCase()).filter(Boolean))));
    return h(
      "div",
      {},
      group(
        "Remitentes de pings",
        h("p", { class: "muted small" }, "Los mensajes de estas direcciones aparecen como tarjetas en «Pings de flota», con alarma propia y notificación prioritaria."),
        field("Direcciones (una por línea)", senders),
      ),
      group(
        "Importante si usas Pidgin a la vez",
        h(
          "p",
          { class: "muted" },
          "Los pings se envían a tu cuenta, no a una sala. Si tienes Pidgin y EvEX-MPP conectados a la vez, el servidor los entrega al cliente con mayor prioridad. Sube la prioridad de esta cuenta (Cuentas → Conexión avanzada) para recibirlos aquí.",
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
        "Escritura",
        toggle(b.enterToSend, (v) => set((x) => (x.enterToSend = v)), "Intro envía el mensaje", "Desactivado: Ctrl+Intro envía e Intro hace salto de línea"),
        toggle(b.sendTyping, (v) => set((x) => (x.sendTyping = v)), "Avisar de que estoy escribiendo (chats privados)"),
        toggle(b.spellcheck, (v) => set((x) => (x.spellcheck = v)), "Corrector ortográfico"),
        field(
          "Idiomas del corrector",
          select([["es-ES,en-US", "Español + inglés"], ["es-ES", "Español"], ["en-US", "Inglés"], ["en-GB", "Inglés (Reino Unido)"]], b.spellLanguages.join(","), (v) => set((x) => (x.spellLanguages = v.split(",")))),
        ),
      ),
      group(
        "Ventana",
        toggle(b.closeToTray, (v) => set((x) => (x.closeToTray = v)), "Cerrar a la bandeja del sistema", "La X oculta la ventana; sales desde el icono de la bandeja"),
        toggle(b.minimizeToTray, (v) => set((x) => (x.minimizeToTray = v)), "Minimizar a la bandeja del sistema", "El botón «_» esconde la ventana junto al reloj en vez de dejarla en la barra de tareas"),
        toggle(b.startMinimized, (v) => set((x) => (x.startMinimized = v)), "Iniciar minimizado en la bandeja"),
        toggle(b.startWithWindows, (v) => set((x) => (x.startWithWindows = v)), "Iniciar con Windows"),
        toggle(b.restoreOpenTabs, (v) => set((x) => (x.restoreOpenTabs = v)), "Restaurar las pestañas abiertas al iniciar"),
      ),
      group("Presencia", field("Ponerme «Ausente» tras inactividad", range(0, 60, 1, b.autoAwayMinutes, (v) => set((x) => (x.autoAwayMinutes = v)), (v) => (v ? `${v} min` : "nunca")))),
    );
  },

  data() {
    return h(
      "div",
      {},
      group(
        "Cuentas",
        h("div", { class: "row" }, h("button", { class: "btn", onclick: () => openAccounts() }, icon("user-cog"), "Gestionar cuentas"), h("button", { class: "btn", onclick: () => openPidginImport() }, icon("import"), "Importar de Pidgin")),
      ),
      group(
        "Temas",
        h("div", { class: "row" }, h("button", { class: "btn", onclick: exportTheme }, icon("download"), "Exportar mi tema"), h("button", { class: "btn", onclick: importTheme }, icon("upload"), "Importar tema")),
      ),
      group(
        "Datos locales",
        h("p", { class: "muted small" }, "Configuración, historial (JSONL), avatares y archivos personalizados se guardan en la carpeta de datos de la aplicación. Las contraseñas se cifran con DPAPI de Windows."),
        h("button", { class: "btn", onclick: () => api("shell:openUserData") }, icon("folder-open"), "Abrir carpeta de datos"),
        h("p", { class: "muted small" }, `EvEX-MPP ${S.version}`),
      ),
    );
  },
};

function popupTestColors() {
  const t = themeColors();
  return { surface: t.surface, text: t.text, border: t.border, warn: t.warn, "theme-accent": t.accent };
}

async function exportTheme() {
  const s = S.settings;
  const data = {
    format: "evex-theme/1",
    name: PRESETS[resolveThemeId(s.theme)].name,
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
  if (await api("theme:export", data)) toast("Tema exportado", { kind: "ok" });
}

async function importTheme() {
  try {
    const t = await api("theme:import");
    if (!t) return;
    if (t.format !== "evex-theme/1") throw new Error("No es un tema de EvEX-MPP");
    full((x) => {
      if (PRESETS[t.base]) x.theme = t.base;
      x.colors = t.colors || {};
      for (const k of ["fontFamily", "monoFamily", "fontSize", "messageStyle", "bubbleRadius", "density"]) if (t[k] != null) x[k] = t[k];
      if (t.background) x.background = t.background;
    });
    toast(`Tema «${t.name}» aplicado`, { kind: "ok" });
  } catch (e) {
    toast(e.message, { kind: "error" });
  }
}

// ---------- editor de fondos ----------

function backgroundEditor(bg, change, { noDim } = {}) {
  const wrap = h("div", { class: "bg-editor" });
  const render = () => {
    clear(wrap);
    const swatch = h("div", { class: "bg-preview", style: { background: backgroundCss(bg) || "var(--bg)" } });
    const types = select(
      [
        ["none", "Sin fondo"],
        ["gradient", "Degradado"],
        ["image", "Imagen"],
        ["color", "Color sólido"],
      ],
      bg.type,
      (v) => {
        change((b) => {
          b.type = v;
          if (v === "gradient" && !GRADIENTS[b.value]) b.value = "nebula";
          if (v === "color" && !/^#/.test(b.value)) b.value = "#101826";
        });
        Object.assign(bg, { type: v });
        render();
      },
    );
    wrap.append(swatch, field("Tipo", types));
    if (bg.type === "gradient") {
      wrap.append(
        h(
          "div",
          { class: "gradient-grid" },
          Object.entries(GRADIENTS).map(([id, css]) =>
            h("button", {
              class: `gradient-swatch ${bg.value === id ? "active" : ""}`,
              title: id,
              style: { background: css },
              onclick: () => {
                change((b) => (b.value = id));
                bg.value = id;
                render();
              },
            }),
          ),
        ),
      );
    }
    if (bg.type === "image") {
      wrap.append(
        h(
          "div",
          { class: "row" },
          h(
            "button",
            {
              class: "btn",
              onclick: async () => {
                const url = await api("file:pick", "image");
                if (!url) return;
                change((b) => (b.value = url));
                bg.value = url;
                render();
              },
            },
            icon("folder-open"),
            "Elegir imagen…",
          ),
          h("span", { class: "muted small" }, "JPG, PNG, GIF animado o WebP"),
        ),
      );
    }
    if (bg.type === "color") {
      wrap.append(field("Color", h("input", { type: "color", value: bg.value, oninput: (e) => (change((b) => (b.value = e.target.value)), (swatch.style.background = e.target.value)) })));
    }
    if (bg.type !== "none") {
      append(
        wrap,
        field("Intensidad", range(0.05, 1, 0.05, bg.opacity, (v) => change((b) => (b.opacity = v)), (v) => `${Math.round(v * 100)}%`)),
        field("Desenfoque", range(0, 30, 1, bg.blur || 0, (v) => change((b) => (b.blur = v)), (v) => `${v}px`)),
        noDim ? null : field("Transparencia de los paneles", range(0, 1, 0.05, bg.dim ?? 0.4, (v) => change((b) => (b.dim = v)), (v) => `${Math.round(v * 100)}%`)),
      );
    }
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
    title: `Fondo de ${key.split("|")[1]}`,
    icon: "image",
    body: backgroundEditor(bg, (fn) => {
      fn(bg);
      apply();
    }),
    actions: [
      {
        label: "Quitar fondo",
        danger: true,
        action: (c) => {
          delete S.settings.conversationBackgrounds[key];
          saveSettings();
          emit("conv-bg", key);
          c();
        },
      },
      "spacer",
      { label: "Listo", primary: true, action: (c) => (apply(), c()) },
    ],
  });
}
