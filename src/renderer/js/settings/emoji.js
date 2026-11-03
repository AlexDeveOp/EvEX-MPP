// Preferencias → Emojis y GIFs.
import { S, api } from "../state.js";
import { h, icon, iconButton, field, toggle, select, range, clear, toast } from "../dom.js";
import { addCustomEmoji, emojifyHtml } from "../emoji.js";
import { BUNDLED_ANIMATED } from "../data/emoji-anim.js";
import { t } from "../i18n.js";
import { onWindows } from "../system.js";
import { look, full, group } from "./common.js";

export const emojiTabs = {
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
              ["native", onWindows(t("Nativos de Windows (sin conexión)"), t("Nativos del sistema (sin conexión)"))],
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
          onWindows(t("Se piden a Google (fonts.gstatic.com), que ve tu IP. Desactivado: esos emojis se muestran con el estilo de Windows."), t("Se piden a Google (fonts.gstatic.com), que ve tu IP. Desactivado: esos emojis se muestran con el estilo del sistema.")),
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

};

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
