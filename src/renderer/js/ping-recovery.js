// Pings que llegaron con la app cerrada, recuperados por el proceso principal de los registros de Pidgin o del
// archivo del servidor (src/main/ping-recovery.js). Se añaden a «Pings de flota» sin sonar, porque ya pasaron, pero
// cuentan como no leídos y la sirena late si son recientes.
import { S, api, emit, PINGS_KEY } from "./state.js";
import { toast } from "./dom.js";
import { pingsConv, loadHistory, openConv, updateBadge } from "./convs.js";
import { t } from "./i18n.js";

const recoveredText = (n) => (n === 1 ? t("Se ha recuperado 1 ping que llegó con la app cerrada.") : t("Se han recuperado {count} pings que llegaron con la app cerrada.", { count: n }));

// `count` lo da el proceso principal: comparar antes y después no sirve al arrancar, porque la pestaña puede cargar los
// pings recuperados por su cuenta antes de que llegue el aviso.
export async function showRecoveredPings(count, { quiet = false } = {}) {
  if (!(count > 0)) return 0;
  const pc = pingsConv();
  await loadHistory(pc);
  if (!S.tabs.includes(PINGS_KEY)) await openConv(null, "*", "pings", { focus: false });
  if (S.active !== PINGS_KEY || !S.focused) pc.unread += count;
  emit("tabs");
  emit("sidebar");
  updateBadge();
  if (!quiet) toast(recoveredText(count), { kind: "info", timeout: 8000 });
  return count;
}

// Botón «Buscar pings nuevos»: revisa al momento y explica de dónde se ha podido buscar.
export async function searchMissedPings(btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api("pings:sync");
    const added = await showRecoveredPings(r.added, { quiet: true });
    if (!S.settings.pingSenders.length) return toast(t("Añade los remitentes de pings en Preferencias → Pings de flota."), { kind: "warn" });
    if (added) return toast(recoveredText(added), { kind: "ok", timeout: 8000 });
    const sources = [];
    if (r.pidgin) sources.push(t("los registros de Pidgin"));
    if (r.accounts.some((a) => a.online && a.mam)) sources.push(t("el archivo del servidor"));
    const failed = r.accounts.find((a) => a.error);
    if (failed) return toast(t("No se pudo consultar el archivo del servidor: {error}", { error: failed.error }), { kind: "error", timeout: 8000 });
    if (!sources.length) {
      const offline = !r.accounts.some((a) => a.online);
      return toast(offline ? t("No hay pings nuevos. Conecta la cuenta para preguntar también al servidor.") : t("No hay pings nuevos. Este servidor no guarda archivo de mensajes y no hay registros de Pidgin en este PC, así que no se pueden recuperar los pings que llegaron con la app cerrada."), { kind: "info", timeout: 10000 });
    }
    const list = sources.length === 2 ? t("{a} y {b}", { a: sources[0], b: sources[1] }) : sources[0];
    toast(t("No hay pings nuevos (revisados: {sources}).", { sources: list }), { kind: "info" });
  } catch (e) {
    toast(e.message, { kind: "error" });
  } finally {
    if (btn) btn.disabled = false;
  }
}
