// Preferencias → Privacidad → «Historial local»: cuánto tiempo se guardan los mensajes, los pings y las flotas.
// De serie no se borra nada de mensajes ni pings («Nunca»), y las flotas a los 90 días (como antes).
// Al acortar un plazo se dice antes cuánto se va a borrar y solo se guarda si el usuario lo confirma; la poda la hace
// el proceso principal (main/retention.js), también una vez al día con los plazos guardados.
import { S, api } from "../state.js";
import { h, field, select, confirmDialog, toast } from "../dom.js";
import { t } from "../i18n.js";
import { group } from "./common.js";
import { addPrivacyGroup } from "./privacy.js";
import { countOldFleets, pruneFleets } from "../fleets.js";

export const RETENTION_DEFAULTS = { messagesDays: 0, pingsDays: 0, fleetsDays: 90 };
const CHOICES = [0, 30, 90, 180, 365];
export const retention = () => ({ ...RETENTION_DEFAULTS, ...(S.settings.retention || {}) });

const label = (d) => (d ? t("{n} días", { n: d }) : t("Nunca"));
const longer = (a, b) => (a === 0 ? Infinity : a) >= (b === 0 ? Infinity : b);

// Cuánto se borraría con los plazos propuestos (mensajes y pings: el proceso principal; flotas: aquí).
async function preview(kind, days) {
  if (kind === "fleetsDays") return { fleets: countOldFleets(days) };
  return api("retention:preview", { ...retention(), [kind]: days });
}

async function saveNow(next) {
  S.settings.retention = next;
  await api("settings:set", S.settings);
}

// Cambiar un plazo. Si se alarga (o es «Nunca») no se borra nada y se guarda sin más. Si se acorta, se cuenta lo que
// se borraría y, si hay algo, se pide confirmación; sin ella el selector vuelve a su valor y no se guarda nada.
export async function changeRetention(kind, days, sel) {
  const cur = retention();
  const next = { ...cur, [kind]: days };
  if (longer(days, cur[kind])) {
    await saveNow(next);
    return true;
  }
  const p = await preview(kind, days);
  const n = kind === "fleetsDays" ? p.fleets : kind === "pingsDays" ? p.pings : p.messages;
  if (n > 0) {
    const what = { messagesDays: t("{n} mensajes de salas y chats", { n }), pingsDays: t("{n} pings de flota", { n }), fleetsDays: t("{n} flotas guardadas", { n }) }[kind];
    const ok = await confirmDialog({
      title: t("Borrar historial antiguo"),
      message: t("Con un plazo de {days} se borrarán ahora {what} de este equipo, y a partir de hoy, cada día, lo que pase de ese plazo. No se puede deshacer.", { days: label(days), what }),
      okLabel: t("Borrar"),
      danger: true,
    });
    if (!ok) {
      if (sel) sel.value = String(cur[kind]);
      return false;
    }
  }
  await saveNow(next);
  if (kind === "fleetsDays") pruneFleets();
  else {
    const r = await api("retention:apply");
    if (r?.error) toast(r.error, { kind: "error" });
  }
  if (n > 0) toast(t("Historial antiguo borrado"), { kind: "ok" });
  return true;
}

function retentionGroup() {
  const r = retention();
  const row = (kind, title, hint) => {
    const sel = select(
      CHOICES.map((d) => [String(d), label(d)]),
      String(r[kind]),
      (v) => changeRetention(kind, Number(v), sel).catch((e) => toast(e.message, { kind: "error" })),
    );
    return field(title, sel, hint);
  };
  return group(
    t("Historial local"),
    h("p", { class: "muted small" }, t("Cuánto tiempo se guarda en este equipo lo que recibes. Lo más antiguo se borra solo, cada día. Los registros de Pidgin nunca se tocan.")),
    row("messagesDays", t("Mensajes de salas y chats"), t("La bandeja de menciones sigue a sus salas.")),
    row("pingsDays", t("Pings de flota"), t("Los pings marcados para SRP no se borran mientras tengan la marca.")),
    row("fleetsDays", t("Calendario de flotas")),
  );
}

let registered = false;
export function initRetentionSettings() {
  if (registered) return;
  registered = true;
  addPrivacyGroup(retentionGroup);
}
