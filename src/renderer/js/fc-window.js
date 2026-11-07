// Modo FC: ventana «Enviar ping» (Ping rápido, Plantilla, Pegar texto). De momento solo un aviso: la ventana de
// verdad llega en el siguiente paso.
import { h, icon, modal } from "./dom.js";
import { t } from "./i18n.js";
import { openSettings } from "./settings.js";

export function openSendPing() {
  modal({
    title: t("Enviar ping"),
    icon: "megaphone",
    className: "fc-send-modal",
    body: h(
      "div",
      { class: "fc-soon" },
      icon("megaphone", "fc-soon-icon"),
      h("p", {}, h("strong", {}, t("Próximamente"))),
      h("p", { class: "muted small" }, t("Aquí podrás enviar pings al bot de tu alianza con un ping rápido, una plantilla o un texto pegado. Mientras tanto, puedes dejar listo el canal del bot y los grupos en Preferencias → Modo FC.")),
    ),
    actions: [
      { label: t("Abrir Preferencias → Modo FC"), icon: "settings", action: (close) => (close(), openSettings("fc")) },
      "spacer",
      { label: t("Cerrar"), primary: true, action: (close) => close() },
    ],
  });
}
