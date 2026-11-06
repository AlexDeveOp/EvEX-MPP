// Preferencias → Privacidad: opciones para que no se vea ni salga del equipo más de lo necesario.
//
// Las partes de la app añaden aquí sus grupos sin tocar este fichero: addPrivacyGroup(build), con build() → elemento
// (normalmente el de group() de common.js). Salen en el orden en que se registren; regístralos una vez al arrancar.
import { h } from "../dom.js";
import { t } from "../i18n.js";

const groups = [];
export function addPrivacyGroup(build) {
  groups.push(build);
}

function privacyTab() {
  const box = h("div", {}, h("p", { class: "muted small" }, t("Opciones para que no se vea en pantalla ni salga de tu equipo más de lo necesario.")));
  for (const build of groups) {
    try {
      const el = build();
      if (el) box.append(el);
    } catch (e) {
      console.error(e);
    }
  }
  return box;
}

export const privacyTabs = { privacy: privacyTab };
