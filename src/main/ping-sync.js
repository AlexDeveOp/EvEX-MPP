// Pings perdidos con la app cerrada: se recuperan de los registros de Pidgin y del archivo del servidor (XEP-0313).
import fs from "node:fs";
import * as store from "./store.js";
import { scanPidgin } from "./pidgin-import.js";
import { senderTargets, pidginPingEntries, storeRecovered } from "./ping-recovery.js";

let options = { accounts: new Map(), logs: null, onRecovered: () => {} };

export function configurePingSync(o) {
  options = { ...options, ...o };
}

const PIDGIN_LOOKBACK = 3 * 86400e3; // primera revisión de los registros de Pidgin: los últimos 3 días
const ARCHIVE_LOOKBACK = 7 * 86400e3; // como mucho se piden al servidor los últimos 7 días
const pidginChecked = new Map(); // id de cuenta -> cuándo se revisaron por última vez sus registros de Pidgin
let pidginScan = null;
let pingSyncQueue = Promise.resolve();

function pidginAccounts() {
  if (!pidginScan || Date.now() - pidginScan.at > 10 * 60e3) pidginScan = { at: Date.now(), accounts: scanPidgin().accounts };
  return pidginScan.accounts;
}

// Revisa los registros de Pidgin y, con `server`, el archivo del servidor de las cuentas conectadas. Las llamadas se
// encolan para no leer ni guardar lo mismo dos veces a la vez.
// `notify: false` cuando quien pide la revisión (el botón) ya muestra el resultado.
export function syncPings({ server = true, notify = true } = {}) {
  const run = pingSyncQueue.then(() => syncPingsNow({ server, notify }));
  pingSyncQueue = run.catch(() => {});
  return run;
}

async function syncPingsNow({ server, notify }) {
  const { accounts, logs } = options;
  const s = store.get().settings;
  const result = { added: 0, pidgin: false, accounts: [] };
  if (!s.pingSenders?.length) return result;
  const usePidgin = s.pingRecovery?.pidgin !== false;
  const useServer = server && s.pingRecovery?.server !== false;
  for (const acc of store.get().accounts) {
    const x = accounts.get(acc.id);
    const targets = senderTargets(s.pingSenders, acc.jid).filter((tg) => tg.jid);
    const info = { account: acc.alias || acc.jid, online: !!x?.online, mam: !!x?.mam, pidgin: 0, server: 0, error: "" };
    const nickOf = (jid) => x?.roster.get(jid)?.name;
    const p = usePidgin ? pidginAccounts().find((a) => a.jid.toLowerCase() === acc.jid.toLowerCase()) : null;
    if (p && fs.existsSync(p.logsDir)) {
      result.pidgin = true;
      const startedAt = Date.now();
      const since = (pidginChecked.get(acc.id) ?? startedAt - PIDGIN_LOOKBACK) - 60e3;
      for (const tg of targets) info.pidgin += storeRecovered(logs, acc.id, tg.jid, pidginPingEntries(p.logsDir, tg, since, [p.alias, p.jid.split("@")[0]].filter(Boolean).map((n) => n.toLowerCase())), nickOf(tg.jid));
      pidginChecked.set(acc.id, startedAt);
    }
    if (useServer && x?.online && x.mam) {
      for (const tg of targets) {
        const last = logs.lastTimestamp(acc.id, tg.jid) || 0;
        const start = Math.max(last - 60e3, Date.now() - ARCHIVE_LOOKBACK);
        try {
          info.server += storeRecovered(logs, acc.id, tg.jid, await x.fetchArchive(tg.jid, start), nickOf(tg.jid));
        } catch (e) {
          info.error = e.message;
        }
      }
    }
    result.added += info.pidgin + info.server;
    result.accounts.push(info);
  }
  if (process.env.EVEX_DEBUG) console.log("[pings]", JSON.stringify({ server, ...result }));
  if (result.added && notify) options.onRecovered(result.added);
  return result;
}
