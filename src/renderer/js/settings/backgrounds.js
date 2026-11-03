// Preferencias → Fondos y editor de fondos (también el de cada sala).
import { S, api, emit, saveSettings } from "../state.js";
import { h, icon, modal, field, select, range, clear, toast } from "../dom.js";
import { GRADIENTS, backgroundCss, applyBackgroundLayer, imageAdjust, panelTransparency } from "../themes.js";
import { t, tk } from "../i18n.js";
import { append, look, full, group } from "./common.js";

export const backgroundTabs = {
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

};

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
  // La primera vez se añaden las imágenes que ya se usaban en algún fondo (de antes de existir la lista); después
  // la lista es solo bgLibrary, para que la × quite de verdad (antes las imágenes en uso volvían a aparecer).
  if (!S.settings.bgLibrarySeeded) {
    const st = S.settings;
    const used = [st.background, st.sidebarBackground, ...Object.values(st.conversationBackgrounds || {})].filter((b) => b?.type === "image" && String(b.value).startsWith("media:")).map((b) => b.value);
    st.bgLibrary = [...new Set([...(st.bgLibrary || []), ...used])];
    st.bgLibrarySeeded = true;
    saveSettings();
  }
  const library = () => S.settings.bgLibrary || [];
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
      // Tus imágenes: un clic vuelve a ponerla; la × la quita de la lista (no borra el fichero) y, si es la de este
      // fondo, también la quita del fondo (se puede deshacer).
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
                    title: t("Quitar de tus imágenes"),
                    onclick: (ev) => {
                      ev.stopPropagation();
                      removeFromLibrary(url);
                      if (bg.value === url) commit({ value: "" });
                      else render();
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
      const common = (label, k, min, max, step, def, fmt, after) => {
        const r = range(
          min,
          max,
          step,
          bg[k] ?? def,
          (v) => {
            change((b) => (b[k] = v));
            bg[k] = v;
            after?.();
          },
          fmt,
        );
        r.querySelector("input").addEventListener("pointerdown", remember);
        return field(label, r);
      };
      // Paneles de ejemplo en la vista previa: con Preferencias abiertas no se ve la ventana de detrás.
      const panels = noDim ? null : h("div", { class: "bg-stage-panels" }, h("div", { class: "p-side" }), h("div", { class: "p-head" }));
      const paintPanels = () => panels?.style.setProperty("--p-alpha", `${Math.round((1 - panelTransparency(bg)) * 100)}%`);
      if (panels) {
        stage.append(panels);
        paintPanels();
      }
      append(
        wrap,
        common(t("Intensidad"), "opacity", 0.05, 1, 0.05, 0.35, (v) => `${Math.round(v * 100)}%`),
        common(t("Desenfoque"), "blur", 0, 30, 1, 0, (v) => `${v}px`),
        noDim ? null : common(t("Transparencia de los paneles"), "panels", 0, 1, 0.05, panelTransparency(bg), (v) => `${Math.round(v * 100)}%`, paintPanels),
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
    }, { noDim: true }),
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
