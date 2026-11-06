// Modo captura: mientras compartes pantalla o retransmites, que no se vea información de operaciones.
// - Fuera de la ventana (burbuja, notificación del sistema, mini ventana, voz) los avisos van sin contenido: lo hace el
//   proceso principal (src/main/capture.js) y, aquí, mini-feed.js y tts.js.
// - En la ventana se difuminan los pings, los mensajes y los nombres de salas, contactos y cuenta (capture.css). Un clic
//   destapa ese elemento; vuelve a difuminarse a los 10 s o al salir el ratón.
// El texto nunca se cambia ni se guarda distinto: solo se tapa al pintarlo.
// El estado lo guarda el proceso principal (settings.capture), que también lo cambia desde la bandeja, el atajo global y
// la orden «--toggle-capture»; aquí llega con «capture-changed».
import { S, api, emit, onMain } from "./state.js";
import { h, icon, toggle } from "./dom.js";
import { t } from "./i18n.js";
import { isLinux } from "./system.js";
import { group } from "./settings/common.js";
import { addPrivacyGroup } from "./settings/privacy.js";

export const CAPTURE_ACCELERATOR = "Ctrl+Shift+H";
export const REVEAL_MS = 10000;

// Lo que se difumina. CONTENT: el primer clic solo lo destapa (no abre enlaces ni botones de dentro). NAMES: nombres en
// la barra lateral, pestañas y cabeceras; el clic los destapa y además hace lo de siempre (abrir la sala…).
export const CONTENT_SEL = ".ping-card, .fleet-row, .fleet-pill, .mention-card, .msg-body, .link-preview, .occ-item";
export const NAMES_SEL = ".sb-name, .tab-title, .conv-title h1, .conv-sub, .account-name, .status-text, .msg-nick, .switcher-item .sw-label";

export const captureOn = (settings = S.settings) => !!settings?.capture?.enabled;

export function applyCapture() {
  const on = captureOn();
  document.body.classList.toggle("capture-mode", on);
  const pill = document.getElementById("tb-capture");
  if (pill) pill.hidden = !on;
  if (!on) for (const el of document.querySelectorAll(".capture-revealed")) el.classList.remove("capture-revealed");
}

export const toggleCapture = () => api("capture:toggle").catch(() => {});
export const setCapture = (patch) => api("capture:set", patch);

// Clic para destapar un elemento difuminado.
function reveal(el) {
  el.classList.add("capture-revealed");
  let timer = null;
  const hide = () => {
    clearTimeout(timer);
    el.classList.remove("capture-revealed");
    el.removeEventListener("mouseleave", hide);
  };
  timer = setTimeout(hide, REVEAL_MS);
  el.addEventListener("mouseleave", hide);
}

function onClick(e) {
  if (!document.body.classList.contains("capture-mode")) return;
  const content = e.target.closest?.(CONTENT_SEL);
  if (content) {
    if (content.classList.contains("capture-revealed")) return;
    e.preventDefault();
    e.stopPropagation();
    reveal(content);
    return;
  }
  const name = e.target.closest?.(NAMES_SEL);
  if (name && !name.classList.contains("capture-revealed")) reveal(name);
}

// Pastilla «● Captura» en la barra de título, junto al reloj EVE: se ve siempre que está activo y lo quita con un clic.
function titlebarPill() {
  if (document.getElementById("tb-capture")) return;
  const eve = document.getElementById("tb-eve");
  if (!eve) return;
  const pill = h("button", { id: "tb-capture", class: "tb-capture", type: "button", hidden: true, title: t("Modo captura activo: los avisos van sin detalles y la ventana está difuminada. Pulsa para quitarlo.") }, h("span", { class: "dot" }), t("Captura"));
  pill.addEventListener("click", toggleCapture);
  eve.before(pill);
}

export function initCapture() {
  addPrivacyGroup(captureGroup);
  titlebarPill();
  document.addEventListener("click", onClick, true);
  // Atajo dentro de la app (el global, si está activado, lo maneja el proceso principal).
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === "h") {
      e.preventDefault();
      toggleCapture();
    }
  });
  onMain("capture-changed", (capture) => {
    S.settings.capture = { ...S.settings.capture, ...capture };
    applyCapture();
    emit("settings", S.settings);
  });
  applyCapture();
}

// ---------- Preferencias → Privacidad ----------

export function captureGroup() {
  const c = S.settings.capture || {};
  const note = h("p", { class: "muted small capture-shortcut-note" });
  const showResult = (r) => {
    if (r?.shortcut && r.shortcut.requested && !r.shortcut.registered) note.textContent = t("No se pudo activar el atajo global: otro programa ya lo usa o el escritorio no lo permite. Usa la orden de abajo.");
    else if (r?.shortcut?.registered) note.textContent = r.shortcut.portal ? t("Atajo global pedido al escritorio. En GNOME, la primera vez sale el aviso «Añadir atajos de teclado»: pulsa «Añadir». Se cambia o se quita en Configuración → Aplicaciones → EvEX-MPP.") : t("Atajo global activo.");
    else note.textContent = "";
  };
  const command = h("code", {}, "evex-mpp --toggle-capture");
  return group(
    t("Modo captura"),
    h("p", { class: "muted small" }, t("Para cuando compartes pantalla o retransmites. Los avisos (burbuja, notificación del sistema, mini ventana y voz) salen sin detalles: solo «Nuevo ping de flota» o «Nuevo mensaje». En la ventana se difuminan los pings, los mensajes y los nombres de salas, contactos y cuenta; un clic destapa uno durante 10 s. El texto no se cambia: solo se tapa en pantalla.")),
    toggle(!!c.enabled, (v) => setCapture({ enabled: v }).catch(() => {}), t("Activar el modo captura"), t("También con {keys}, desde la bandeja o pulsando «Captura» en la barra de arriba", { keys: CAPTURE_ACCELERATOR })),
    toggle(
      !!c.globalShortcut,
      (v) => setCapture({ globalShortcut: v }).then(showResult, () => {}),
      t("Atajo global ({keys})", { keys: CAPTURE_ACCELERATOR }),
      t("Funciona aunque estés en el juego o en otra ventana. Apagado de serie."),
    ),
    note,
    h(
      "p",
      { class: "muted small" },
      icon("keyboard"),
      isLinux()
        ? t(" En Linux, si el atajo global no funciona (algunos escritorios Wayland no lo permiten), crea un atajo de teclado propio en la configuración del escritorio (GNOME: Teclado → Atajos personalizados) que ejecute: ")
        : t(" También puedes cambiarlo desde fuera con la orden: "),
      command,
    ),
  );
}
