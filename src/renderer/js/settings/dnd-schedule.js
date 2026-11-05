// Preferencias → Notificaciones → «No molestar»: interruptor manual, horario (de–a y días) y si dejan pasar las menciones.
import { S } from "../state.js";
import { h, toggle, field } from "../dom.js";
import { t, tk } from "../i18n.js";
import { full, group } from "./common.js";
import { dndNow, dndLabel } from "../dnd.js";
import { DEFAULT_SCHEDULE, parseHM } from "../notify-rules.js";

// Lunes primero; los valores son los de Date.getDay() (0 = domingo).
const DAYS = [
  [1, tk("Lu"), tk("lunes")],
  [2, tk("Ma"), tk("martes")],
  [3, tk("Mi"), tk("miércoles")],
  [4, tk("Ju"), tk("jueves")],
  [5, tk("Vi"), tk("viernes")],
  [6, tk("Sá"), tk("sábado")],
  [0, tk("Do"), tk("domingo")],
];

export function dndGroup() {
  const n = S.settings.notifications;
  const sched = { ...DEFAULT_SCHEDULE, ...(n.dndSchedule || {}) };
  const save = (fn) => full((x) => fn(x.notifications));
  const setSched = (patch) => save((x) => (x.dndSchedule = { ...DEFAULT_SCHEDULE, ...(x.dndSchedule || {}), ...patch }));
  const status = h("p", { class: "muted small dnd-status" });
  const paint = () => {
    const st = dndNow();
    status.textContent = st.active ? `${dndLabel(st)}.` : t("Ahora no está activo.");
  };
  paint();

  const time = (key) =>
    h("input", {
      class: "input dnd-time",
      type: "time",
      value: sched[key],
      onchange: (e) => {
        if (parseHM(e.target.value) == null) return;
        setSched({ [key]: e.target.value });
        setTimeout(paint);
      },
    });
  const days = h(
    "div",
    { class: "dnd-days", role: "group", "aria-label": t("Días") },
    DAYS.map(([d, short, long]) =>
      h(
        "button",
        {
          type: "button",
          class: `chip ${sched.days.includes(d) ? "on" : ""}`,
          title: t(long),
          "aria-pressed": String(sched.days.includes(d)),
          onclick: (e) => {
            const cur = new Set(S.settings.notifications.dndSchedule?.days || DEFAULT_SCHEDULE.days);
            if (cur.has(d)) cur.delete(d);
            else cur.add(d);
            // Al menos un día: si se quitan todos, el horario no haría nada.
            if (!cur.size) return;
            setSched({ days: [...cur] });
            e.currentTarget.classList.toggle("on", cur.has(d));
            e.currentTarget.setAttribute("aria-pressed", String(cur.has(d)));
            setTimeout(paint);
          },
        },
        t(short),
      ),
    ),
  );

  return group(
    t("No molestar"),
    toggle(n.dnd, (v) => (save((x) => (x.dnd = v)), setTimeout(paint)), t("No molestar ahora"), t("También desde el menú de tu estado, la bandeja del sistema o el aviso de la barra de título. No cambia tu estado XMPP.")),
    toggle(sched.enabled, (v) => (setSched({ enabled: v }), setTimeout(paint)), t("Con horario"), t("Se activa solo cada día elegido, de una hora a otra (puede pasar de medianoche: 23:00–07:00).")),
    field(t("Horario"), h("div", { class: "row dnd-range" }, time("from"), h("span", { class: "muted" }, "–"), time("to"))),
    field(t("Días"), days),
    toggle(n.dndAllowMentions, (v) => save((x) => (x.dndAllowMentions = v)), t("Dejar pasar las menciones"), t("Mientras está activo, avisan los mensajes que te mencionan o tienen tus palabras clave (salvo en salas o chats en «Nada»).")),
    h("p", { class: "muted small" }, t("Los pings de flota y los avisos de conexión perdida o recuperada suenan siempre.")),
    status,
  );
}
