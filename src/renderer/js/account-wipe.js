// «Borrar la cuenta y todos sus datos locales» y el aviso de posible revocación (el servidor rechaza la cuenta).
// El borrado lo hace el proceso principal (main/account-wipe.js); aquí se pide escribir el JID para confirmar y, al
// terminar, se recarga la ventana para que no quede nada de la cuenta en memoria.
import { api, account } from "./state.js";
import { h, modal, toast } from "./dom.js";
import { t } from "./i18n.js";

const STEP_NAMES = () => ({
  keys: t("leer las claves de sus mensajes"),
  settings: t("quitar sus ajustes"),
  imported: t("quitar las marcas de importación de Pidgin"),
  history: t("borrar su historial"),
  connectionLog: t("quitar sus líneas del registro de conexión"),
  avatar: t("borrar su avatar"),
  secrets: t("borrar sus contraseñas guardadas"),
  account: t("quitar la cuenta de la lista"),
});

export function openWipeDialog(acc) {
  if (!acc) return;
  const input = h("input", { class: "input", type: "text", placeholder: acc.jid, autocomplete: "off", spellcheck: false, autofocus: true });
  const m = modal({
    title: t("Borrar la cuenta y todos sus datos locales"),
    icon: "trash-2",
    body: h(
      "div",
      { class: "wipe-body" },
      h("p", {}, t("Se borra de este equipo todo lo que EvEX-MPP guarda de {jid}:", { jid: acc.jid })),
      h(
        "ul",
        { class: "wipe-list" },
        h("li", {}, t("su historial de mensajes y pings (también el de las copias de «Reparar historial»);")),
        h("li", {}, t("sus contraseñas guardadas, la de su proxy y sus ajustes (salas, avisos por sala, fondos, pestañas);")),
        h("li", {}, t("sus marcas de SRP y flotas del calendario, salvo las de pings que también tenga otra cuenta;")),
        h("li", {}, t("sus líneas del registro de conexión y su avatar propio.")),
      ),
      h("p", { class: "muted" }, t("No se tocan los registros de Pidgin, los archivos que hayas guardado tú ni nada del servidor: la cuenta sigue existiendo allí.")),
      h("p", { class: "wipe-warning" }, t("Es un borrado normal de ficheros, no un borrado seguro: en un SSD o con copias de seguridad del sistema los datos pueden seguir siendo recuperables.")),
      h("label", { class: "field" }, h("span", { class: "field-label" }, t("Escribe {jid} para confirmar", { jid: acc.jid })), input),
    ),
    actions: [
      "spacer",
      { label: t("Cancelar"), action: (c) => c() },
      { label: t("Borrar todo"), danger: true, icon: "trash-2", action: (c) => go(c) },
    ],
  });
  const okBtn = m.footer.querySelector("button:last-child");
  const matches = () => input.value.trim().toLowerCase() === acc.jid.toLowerCase();
  const refresh = () => (okBtn.disabled = !matches());
  input.addEventListener("input", refresh);
  input.addEventListener("keydown", (e) => e.key === "Enter" && matches() && go(m.close));
  refresh();

  let busy = false;
  async function go(close) {
    if (busy || !matches()) return;
    busy = true;
    okBtn.disabled = true;
    let result;
    try {
      result = await api("account:wipe", acc.id, input.value);
    } catch (err) {
      busy = false;
      refresh();
      return toast(err.message, { kind: "error" });
    }
    close();
    if (result?.failed?.length) return showFailed(acc, result.failed);
    try {
      if (String(localStorage.getItem("evex.activeTab") || "").startsWith(`${acc.id}|`)) localStorage.removeItem("evex.activeTab");
    } catch {}
    // Se recarga para que no quede en memoria nada de la cuenta (conversaciones, menciones, avatares).
    location.reload();
  }
}

function showFailed(acc, failed) {
  const names = STEP_NAMES();
  modal({
    title: t("No se ha podido borrar todo"),
    icon: "triangle-alert",
    body: h(
      "div",
      {},
      h("p", {}, t("La cuenta {jid} sigue en la lista porque no se ha podido:", { jid: acc.jid })),
      h("ul", { class: "wipe-list" }, failed.map((f) => h("li", {}, `${names[f.step] || f.step}: ${f.message}`))),
      h("p", { class: "muted" }, t("Lo demás ya se ha borrado. Cierra lo que pueda estar usando esos ficheros y vuelve a intentarlo.")),
    ),
    actions: ["spacer", { label: t("Cerrar"), primary: true, action: (c) => c() }],
  });
}

// ---------- aviso: el servidor rechaza la cuenta ----------

const noticeOpen = new Set();

// ev: { condition, count, notify } (main.js). No cambia nada sin que se pulse una opción.
export function showAuthRejected(accountId, ev, { openAccounts } = {}) {
  const acc = account(accountId);
  if (!acc || !ev?.notify || noticeOpen.has(accountId)) return;
  noticeOpen.add(accountId);
  const why = {
    "account-disabled": t("El servidor dice que la cuenta está desactivada."),
    "credentials-expired": t("El servidor dice que las credenciales de la cuenta han caducado."),
  }[ev.condition] || t("El servidor ha rechazado la contraseña {n} veces seguidas.", { n: ev.count || 2 });
  const save = (patch) => api("account:save", { account: { id: accountId, ...patch } }).then((a) => Object.assign(acc, a));
  modal({
    title: t("El servidor rechaza la cuenta {jid}", { jid: acc.jid }),
    icon: "triangle-alert",
    className: "auth-rejected",
    body: h(
      "div",
      {},
      h("p", {}, why),
      h("p", { class: "muted" }, t("Puede que hayas cambiado la contraseña en otro sitio o que te hayan retirado el acceso (por ejemplo, al salir de la corporación o la alianza). EvEX-MPP ha dejado de intentar conectar con esta cuenta.")),
    ),
    onClose: () => noticeOpen.delete(accountId),
    actions: [
      { label: t("Cambiar la contraseña"), primary: true, icon: "key-round", action: (c) => (c(), openAccounts?.(accountId)) },
      {
        label: t("No conectar al iniciar"),
        icon: "power",
        action: (c) =>
          save({ autoLogin: false }).then(
            () => (c(), toast(t("{jid} ya no se conectará al iniciar.", { jid: acc.jid }), { kind: "ok" })),
            (err) => toast(err.message, { kind: "error" }),
          ),
      },
      { label: t("Borrar los datos locales…"), danger: true, icon: "trash-2", action: (c) => (c(), openWipeDialog(acc)) },
      "spacer",
      { label: t("Cerrar"), action: (c) => c() },
    ],
  });
}
