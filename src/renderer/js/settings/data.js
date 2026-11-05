// Preferencias → Comportamiento y Cuentas y datos.
import { S, api } from "../state.js";
import { h, icon, field, toggle, select, range } from "../dom.js";
import { checkUpdatesNow } from "../updates.js";
import { openAccounts, openPidginImport } from "../accounts.js";
import { repairPidginHistory } from "../pidgin-repair.js";
import { t } from "../i18n.js";
import { exportTheme, importTheme } from "./appearance.js";
import { look, group, unavailable } from "./common.js";
import { onWindows, trayAvailable, isStore } from "../system.js";

// Sin bandeja (p. ej. GNOME sin extensión) la ventana oculta no se podría volver a abrir: estas opciones se desactivan.
function trayOption(row) {
  return trayAvailable() ? row : unavailable(row, t("No disponible: este escritorio no muestra la bandeja del sistema, así que la ventana oculta no se podría volver a abrir."));
}

export const dataTabs = {
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
        trayOption(toggle(b.closeToTray, (v) => set((x) => (x.closeToTray = v)), t("Cerrar a la bandeja del sistema"), t("La X oculta la ventana; sales desde el icono de la bandeja"))),
        trayOption(toggle(b.minimizeToTray, (v) => set((x) => (x.minimizeToTray = v)), t("Minimizar a la bandeja del sistema"), t("El botón «_» esconde la ventana junto al reloj en vez de dejarla en la barra de tareas"))),
        trayOption(toggle(b.startMinimized, (v) => set((x) => (x.startMinimized = v)), t("Iniciar minimizado en la bandeja"))),
        // En la versión de la Store el inicio automático es una tarea del paquete que solo se activa desde Windows.
        isStore()
          ? field(
              t("Iniciar con Windows"),
              h("button", { class: "btn", onclick: () => api("shell:startupSettings") }, icon("external-link"), t("Abrir «Aplicaciones de inicio» de Windows")),
              t("En la versión de la Microsoft Store se activa en Configuración → Aplicaciones → Inicio. Arranca en la bandeja."),
            )
          : toggle(b.startWithWindows, (v) => set((x) => (x.startWithWindows = v)), onWindows(t("Iniciar con Windows"), t("Iniciar con el sistema"))),
        toggle(b.restoreOpenTabs, (v) => set((x) => (x.restoreOpenTabs = v)), t("Restaurar las pestañas abiertas al iniciar")),
      ),
      group(t("Presencia"), field(t("Ponerme «Ausente» tras inactividad"), range(0, 60, 1, b.autoAwayMinutes, (v) => set((x) => (x.autoAwayMinutes = v)), (v) => (v ? `${v} min` : "nunca")))),
      group(
        t("Salas"),
        toggle(
          b.discoverMucServices,
          (v) => set((x) => (x.discoverMucServices = v)),
          t("Buscar otros servidores de salas"),
          t("El explorador y las sugerencias del + incluyen también los demás servidores de salas del dominio (muc., chat.…), no solo conference."),
        ),
      ),
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
      isStore()
        ? group(t("Actualizaciones"), h("p", { class: "muted small" }, t("Instalada desde la Microsoft Store: la Store la mantiene al día.")))
        : group(
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
