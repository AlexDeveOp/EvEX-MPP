// Reparación del historial importado de Pidgin con versiones anteriores (fechas día/mes y avisos de Pidgin).
// Se ofrece sola una vez al arrancar si hace falta; también está en Preferencias → Cuentas y datos.
import { api } from "./state.js";
import { h, modal, toast, confirmDialog } from "./dom.js";
import { t } from "./i18n.js";

const EXPLAIN = () =>
  t("Se vuelven a leer tus registros de Pidgin (sin cambiarlos) para corregir la fecha de los mensajes mal fechados y quitar los avisos de Pidgin. Antes se hace una copia de seguridad completa del historial en la carpeta de datos.");

export async function repairPidginHistory({ ask = true } = {}) {
  if (ask) {
    const ok = await confirmDialog({ title: t("Reparar historial importado de Pidgin"), message: EXPLAIN(), okLabel: t("Reparar") });
    if (!ok) return;
  }
  const busy = toast(t("Reparando el historial…"), { timeout: 0 });
  let r;
  try {
    r = await api("pidgin:repairLogs");
  } catch (err) {
    busy();
    return toast(t("No se pudo reparar el historial: {message}", { message: err.message }), { kind: "error", timeout: 10000 });
  }
  busy();
  if (!r.accounts) return toast(t("No hay historial de Pidgin para ninguna de tus cuentas."), { kind: "warn" });
  showResult(r);
}

// Qué se ha hecho, punto por punto. La ventana se recarga al cerrar para mostrar el historial corregido.
function showResult(r) {
  const changed = r.fixed + r.removed > 0;
  const li = (text) => h("li", {}, text);
  modal({
    title: t("Historial reparado"),
    icon: "check",
    body: h(
      "div",
      {},
      changed
        ? h(
            "ul",
            { class: "repair-result" },
            li(t("Mensajes con la fecha corregida: {fixed}", r)),
            li(t("Avisos de Pidgin quitados (entradas, salidas y desconexiones): {removed}", r)),
            li(t("Conversaciones cambiadas: {conversations}", r)),
            li(t("Los mensajes de las personas y los temas de las salas se conservan.")),
          )
        : h("p", {}, t("Tu historial importado ya estaba bien: no ha hecho falta cambiar nada.")),
      h("p", { class: "muted" }, t("Copia de seguridad del historial anterior: la carpeta {backup}, dentro de la carpeta de datos. Puedes borrarla cuando compruebes que todo está bien.", r)),
    ),
    actions: [
      { label: t("Abrir carpeta de datos"), icon: "folder-open", action: () => api("shell:openUserData") },
      "spacer",
      { label: t("Recargar"), primary: true, action: (close) => close() },
    ],
    onClose: () => location.reload(),
  });
}

// Al arrancar: si hay historial importado con una versión anterior sin reparar, se ofrece una sola vez.
export async function offerPidginRepair() {
  const { offer } = await api("pidgin:repairStatus");
  if (!offer) return;
  let answered = false;
  const answer = (repair) => {
    if (answered) return;
    answered = true;
    api("pidgin:repairOffered");
    if (repair) repairPidginHistory({ ask: false });
    else toast(t("Puedes repararlo cuando quieras en Preferencias → Cuentas y datos."), { timeout: 8000 });
  };
  modal({
    title: t("Reparar el historial importado de Pidgin"),
    icon: "wand-sparkles",
    body: h(
      "div",
      {},
      h("p", {}, t("Importaste el historial de Pidgin con una versión anterior de EvEX-MPP. Esa versión podía cambiar la fecha de algunos mensajes (día y mes al revés) e importaba miles de avisos de Pidgin (entradas, salidas y desconexiones).")),
      h("p", { class: "muted" }, EXPLAIN()),
    ),
    actions: [
      "spacer",
      { label: t("Ahora no"), action: (close) => (answer(false), close()) },
      { label: t("Reparar ahora"), primary: true, icon: "wand-sparkles", action: (close) => (answer(true), close()) },
    ],
  });
}
