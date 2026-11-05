// «No molestar» en la interfaz: interruptor rápido (menú de estado, bandeja y barra de título), indicador en la barra
// de título y comprobación cada minuto del horario (para el indicador y el menú de la bandeja).
import { S, api, on, onMain, emit, updateSettings } from "./state.js";
import { h, icon } from "./dom.js";
import { dndState, toggleDnd } from "./notify-rules.js";
import { fmtTime } from "./format.js";
import { t } from "./i18n.js";

export const dndNow = () => dndState(S.settings.notifications);

// Enciende o apaga «No molestar». Si está activo por horario, lo apaga hasta el final de ese tramo.
export function toggleDndNow() {
  const changes = toggleDnd(S.settings.notifications);
  updateSettings((s) => Object.assign(s.notifications, changes));
  refreshDnd();
}

// Texto del estado: «No molestar», «No molestar hasta las 08:00 (horario)».
export function dndLabel(st = dndNow()) {
  if (st.manual) return t("No molestar activado");
  if (st.scheduled && st.until) return t("No molestar hasta las {time} (horario)", { time: fmtTime(st.until.getTime()) });
  return t("No molestar");
}

let last = null;
// Pinta el indicador y avisa al proceso principal si ha cambiado (para la casilla de la bandeja).
export function refreshDnd() {
  const st = dndNow();
  const key = `${st.active}|${st.manual}|${st.until?.getTime() || 0}`;
  const el = document.getElementById("tb-dnd");
  if (el) {
    el.hidden = !st.active;
    el.title = `${dndLabel(st)} — ${t("Solo suenan los pings de flota. Clic para desactivarlo.")}`;
    el.setAttribute("aria-label", el.title);
  }
  if (key !== last) {
    last = key;
    api("dnd:state", { active: st.active, label: st.active ? dndLabel(st) : "" }).catch(() => {});
    emit("dnd", st);
  }
}

export function initDnd() {
  const bar = document.getElementById("tb-eve");
  if (bar && !document.getElementById("tb-dnd")) {
    bar.before(h("button", { id: "tb-dnd", class: "tb-dnd", type: "button", hidden: true, onclick: toggleDndNow }, icon("bell-off"), h("span", {}, t("No molestar"))));
  }
  on("settings", refreshDnd);
  onMain("dnd-toggle", toggleDndNow);
  refreshDnd();
  // El horario empieza y acaba solo: se mira cada 30 s.
  setInterval(refreshDnd, 30e3);
}
