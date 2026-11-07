// Preferencias → Modo FC → «Compartir configuración»: exportar e importar la configuración entre FCs.
// El fichero lo hace y lo lee el proceso principal (src/main/fc-share.js): aquí solo hay los dos botones, la vista previa
// y, si el usuario dice que sí, se guarda la configuración mezclada (que ya conserva su cuenta, su firma y si el modo
// está activo). Se puede importar con el Modo FC apagado: importar no lo enciende.
import { S } from "../state.js";
import { h, icon, modal, toast } from "../dom.js";
import { t } from "../i18n.js";
import { full } from "./common.js";

const api = (ch, ...args) => window.evex.call(ch, ...args);

// Error de fc:exportFile o fc:importFile (llega como «…fc-share:<código>») → texto para el usuario.
export function shareErrorText(err) {
  const code = /\bfc-share:([a-z-]+)\b/.exec(String(err?.message ?? err ?? ""))?.[1];
  const texts = {
    "too-big": () => t("El fichero es demasiado grande para ser una configuración del Modo FC."),
    "bad-json": () => t("El fichero no se puede leer: no es un JSON válido."),
    "not-fc-config": () => t("Ese fichero no es una configuración del Modo FC de EvEX-MPP."),
    "newer-version": () => t("La configuración es de una versión más nueva de EvEX-MPP. Actualiza la app para importarla."),
    "bad-version": () => t("La configuración tiene una versión que no se reconoce."),
    "bad-config": () => t("La configuración está incompleta o dañada."),
    "too-many-groups": () => t("La configuración tiene demasiados grupos."),
  };
  return texts[code]?.() || t("No se ha podido completar: {error}", { error: String(err?.message ?? err ?? "") });
}

const MODE_LABELS = { address: () => t("Una dirección por grupo"), line: () => t("Línea al principio, al canal del bot"), web: () => t("Web de pings de la alianza") };
const CHANGE_LABELS = {
  groupMode: () => t("Cómo se envía"),
  lineFormat: () => t("Línea del grupo"),
  webUrl: () => t("Web de pings"),
  channel: () => t("Canal del bot"),
  groups: () => t("Grupos"),
  defaultGroup: () => t("Grupo por defecto"),
  template: () => t("Plantilla"),
  tabs: () => t("Pestañas"),
  defaultTab: () => t("Pestaña por defecto"),
  confirm: () => t("Confirmaciones"),
  confirmMulti: () => t("Confirmaciones"),
  botNick: () => t("Avanzado"),
  sentPattern: () => t("Avanzado"),
  rejectedPattern: () => t("Avanzado"),
};
const WARNING_TEXTS = {
  "web-url-dropped": () => t("La dirección web no era http ni https y no se importa."),
  "groups-dropped": () => t("Algunos grupos no eran válidos o estaban repetidos y se han quitado."),
};

// Las líneas de la vista previa. El texto del fichero va siempre como texto (escapado por h), tal cual.
export function previewBody(file, preview) {
  const row = (label, value) => h("div", { class: "fc-share-row" }, h("span", { class: "field-label" }, label), " ", h("span", {}, value));
  const changes = [...new Set(preview.changes.map((k) => CHANGE_LABELS[k]?.() || k))];
  return h(
    "div",
    { class: "fc-share-preview" },
    row(t("Fichero:"), file),
    row(t("Cómo se envía:"), MODE_LABELS[preview.groupMode]?.() || preview.groupMode),
    preview.groupMode === "line" && preview.channelJid ? row(t("Canal del bot:"), preview.channelJid) : null,
    preview.groupMode === "web" && preview.webUrl ? row(t("Web de pings:"), preview.webUrl) : null,
    row(t("Grupos ({n}):", { n: preview.groups.length }), preview.groups.map((g) => (g.address ? `${g.name} (${g.address})` : g.name)).join(", ") || "—"),
    h("div", { class: "field-label" }, t("Plantilla:")),
    h("pre", { class: "fc-share-format", style: { whiteSpace: "pre-wrap", maxHeight: "12em", overflow: "auto" } }, preview.format),
    changes.length ? row(t("Cambia:"), changes.join(", ")) : h("p", { class: "muted" }, t("Es igual que tu configuración: no cambia nada.")),
    ...preview.warnings.map((w) => h("p", { class: "muted" }, icon("alert-triangle"), " ", WARNING_TEXTS[w]?.() || w)),
    h("p", { class: "muted" }, t("Se mantienen tu cuenta, tu firma y si el Modo FC está activo.")),
  );
}

async function exportConfig() {
  try {
    // Lo que se acaba de cambiar puede no haberse guardado aún (se guarda con retraso): primero se guarda.
    await api("settings:set", S.settings);
    const r = await api("fc:exportFile");
    if (r?.saved) toast(t("Configuración guardada en {file}.", { file: r.saved }), { kind: "ok" });
  } catch (e) {
    toast(shareErrorText(e), { kind: "error" });
  }
}

async function importConfig() {
  let r;
  try {
    r = await api("fc:importFile");
  } catch (e) {
    return toast(shareErrorText(e), { kind: "error" });
  }
  if (!r || r.canceled) return;
  modal({
    title: t("Importar la configuración del Modo FC"),
    icon: "download",
    body: previewBody(r.file, r.preview),
    actions: [
      "spacer",
      { label: t("Cancelar"), action: (close) => close() },
      {
        label: t("Importar"),
        primary: true,
        action: (close) => {
          full((s) => (s.fcMode = r.merged));
          close();
          toast(t("Configuración del Modo FC importada."), { kind: "ok" });
        },
      },
    ],
  });
}

// Lo que se pinta en la sección «Compartir configuración».
export function buildFcShareControls() {
  return h(
    "div",
    { class: "fc-share" },
    h("p", { class: "muted" }, t("Pasa a otro FC los grupos, la plantilla y cómo se envía. No incluye tu cuenta, tu firma ni tus pings guardados.")),
    h(
      "div",
      { class: "row" },
      h("button", { class: "btn", type: "button", onclick: exportConfig }, icon("upload"), t("Exportar…")),
      h("button", { class: "btn", type: "button", onclick: importConfig }, icon("download"), t("Importar…")),
    ),
  );
}
