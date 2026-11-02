// Aviso de versión nueva en la interfaz. Lleva a la página de la release; no descarga nada.
import { S, api } from "./state.js";
import { toast } from "./dom.js";
import { t } from "./i18n.js";

export function showUpdate(r) {
  toast(t("Hay una versión nueva de EvEX-MPP: {version} (tienes la {current})", { version: r.latest, current: S.version }), {
    timeout: 0,
    icon: "download",
    actions: [{ label: t("Ver la versión"), primary: true, action: () => api("shell:open", r.url) }],
  });
}

// Botón «Comprobar ahora» de Preferencias.
export async function checkUpdatesNow() {
  try {
    const r = await api("updates:check");
    if (r.newer) showUpdate(r);
    else toast(t("Tienes la última versión ({version})", { version: S.version }), { kind: "ok" });
  } catch (err) {
    toast(t("No se pudo comprobar si hay versión nueva: {message}", { message: err.message }), { kind: "error" });
  }
}
