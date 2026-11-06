// Preferencias → Acerca de: quién hace la app, su versión y los enlaces al repositorio (novedades, avisar de un fallo,
// privacidad, licencia). Solo el nombre público del autor: nada de nombres reales ni correos. Los enlaces se abren en
// el navegador (shell:open solo deja pasar http, https, mailto y xmpp).
import { S, api } from "../state.js";
import { h, icon } from "../dom.js";
import { t, currentLang } from "../i18n.js";
import { group } from "./common.js";

const AUTHOR = "AlexDeveOp";

function link(ic, label, url, hint) {
  return h(
    "button",
    { class: "about-link", title: url, onclick: () => api("shell:open", url) },
    icon(ic),
    h("span", { class: "about-link-text" }, h("span", {}, label), hint ? h("small", { class: "muted" }, hint) : null),
    icon("external-link"),
  );
}

export const aboutTabs = {
  about() {
    const repo = `https://github.com/${S.repo}`;
    const blob = (file) => `${repo}/blob/main/${file}`;
    const readme = currentLang() === "es" ? "README.es.md" : "README.md";
    const channel = S.system?.store ? "Microsoft Store" : "GitHub";
    return h(
      "div",
      {},
      h(
        "div",
        { class: "about-head" },
        h("img", { class: "about-logo", src: "assets/logo.svg", alt: "" }),
        h(
          "div",
          {},
          h("div", { class: "about-name" }, "EvEX-MPP"),
          h("div", { class: "muted" }, t("Versión {version} · {channel}", { version: S.version, channel })),
          h("div", { class: "muted small" }, t("Cliente XMPP moderno para comunidades de EVE Online.")),
          h("div", { class: "small" }, t("Hecho por {author}. Código abierto con licencia MIT.", { author: AUTHOR })),
        ),
      ),
      group(
        t("Proyecto"),
        link("globe", t("Repositorio en GitHub"), repo, t("Código, instrucciones y descargas")),
        link("history", t("Novedades de cada versión"), blob("CHANGELOG.md")),
        link("book-marked", t("Guía de uso"), blob(readme)),
      ),
      group(
        t("Ayuda"),
        link("triangle-alert", t("Avisar de un fallo o proponer una mejora"), `${repo}/issues`, t("Hace falta una cuenta de GitHub. No pegues contraseñas ni mensajes privados.")),
        link("shield", t("Informar de un problema de seguridad"), blob("SECURITY.md"), t("En privado, sin que se publique")),
      ),
      group(
        t("Privacidad y licencias"),
        link("shield-check", t("Política de privacidad"), blob("PRIVACY.md"), t("Qué se guarda, a qué se conecta la app y cómo desactivarlo")),
        link("file-text", t("Licencia (MIT)"), blob("LICENSE")),
        link("file-text", t("Componentes de terceros"), blob("THIRD_PARTY_NOTICES.md"), t("Fuentes, iconos y emojis que incluye la app")),
      ),
      h("p", { class: "muted small" }, t("EVE Online es una marca de Fenris Creations (antes CCP Games). EvEX-MPP no está afiliado a Fenris Creations.")),
    );
  },
};
