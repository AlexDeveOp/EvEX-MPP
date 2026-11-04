// Ventana de preferencias. Cada pestaña está en settings/*.js.
import { h, icon, modal, clear } from "./dom.js";
import { t } from "./i18n.js";
import { appearanceTabs } from "./settings/appearance.js";
import { backgroundTabs } from "./settings/backgrounds.js";
import { emojiTabs } from "./settings/emoji.js";
import { notificationTabs } from "./settings/notifications.js";
import { pingTabs } from "./settings/pings.js";
import { dataTabs } from "./settings/data.js";
import { networkTabs } from "./settings/network.js";
import { profileTabs, setProfileFocus } from "./settings/profile.js";

export { openBackgroundEditor } from "./settings/backgrounds.js";

const TABS = [
  ["profile", t("Perfil"), "circle-user-round"],
  ["appearance", t("Apariencia"), "palette"],
  ["colors", t("Colores"), "brush"],
  ["messages", t("Mensajes"), "message-square"],
  ["backgrounds", t("Fondos"), "image"],
  ["emoji", t("Emojis"), "smile"],
  ["notifications", t("Notificaciones"), "bell"],
  ["pings", t("Pings de flota"), "siren"],
  ["behavior", t("Comportamiento"), "sliders-horizontal"],
  ["network", t("Red y proxy"), "globe"],
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

// Preferencias → Perfil con el avatar de esa cuenta a la vista.
export function openProfile(accountId) {
  setProfileFocus(accountId);
  openSettings("profile");
}

const RENDER = { ...appearanceTabs, ...backgroundTabs, ...emojiTabs, ...notificationTabs, ...pingTabs, ...dataTabs, ...networkTabs, ...profileTabs };
