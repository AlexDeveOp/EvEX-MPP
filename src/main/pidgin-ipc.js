// Importación de Pidgin (cuentas, salas, contraseñas e historial) y reparación del historial importado con versiones
// anteriores.
import path from "node:path";
import fs from "node:fs";
import * as store from "./store.js";
import { scanPidgin, importLogs, repairImportedLogs, shouldOfferRepair } from "./pidgin-import.js";
import { userData } from "./paths.js";

export function registerPidginIpc(handle, { logs, send, publicAccount }) {
  // Repara el historial importado de Pidgin con versiones anteriores (fechas día/mes y avisos de Pidgin).
  // Antes copia la carpeta de historial entera, por si hubiera que volver atrás.
  const repairTargets = () => {
    const scan = scanPidgin();
    return store.get().accounts.map((acc) => ({ acc, p: scan.accounts.find((p) => p.jid === acc.jid) })).filter((x) => x.p && fs.existsSync(x.p.logsDir));
  };
  // ¿Ofrecer la reparación al arrancar? (shouldOfferRepair, en pidgin-import.js)
  handle("pidgin:repairStatus", () => ({
    offer: shouldOfferRepair({ imported: store.get().imported, dataEntries: fs.readdirSync(userData()), hasTargets: () => repairTargets().length > 0 }),
  }));
  handle("pidgin:repairOffered", () => {
    store.get().imported.__repairOffered = 1;
    store.save();
    return true;
  });
  handle("pidgin:repairLogs", async () => {
    const targets = repairTargets();
    if (!targets.length) return { accounts: 0 };
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const backup = path.join(userData(), `logs-copia-${stamp}`);
    fs.cpSync(path.join(userData(), "logs"), backup, { recursive: true });
    const total = { accounts: targets.length, conversations: 0, fixed: 0, removed: 0, backup: path.basename(backup) };
    for (const { acc, p } of targets) {
      const r = await repairImportedLogs({ logsDir: p.logsDir, selfNames: [p.alias, p.jid.split("@")[0]].filter(Boolean).map((s) => s.toLowerCase()), logs, accountId: acc.id });
      total.conversations += r.conversations;
      total.fixed += r.fixed;
      total.removed += r.removed;
    }
    store.get().imported.__logsRepaired = 1;
    store.save();
    return total;
  });

  handle("pidgin:scan", () => {
    const r = scanPidgin();
    return { ...r, imported: Object.keys(store.get().imported).length };
  });
  handle("pidgin:import", async ({ jids, importPasswords, importRooms, importLogs: doLogs }) => {
    const scan = scanPidgin({ includePasswords: importPasswords });
    const results = [];
    for (const p of scan.accounts.filter((a) => jids.includes(a.jid))) {
      let acc = store.get().accounts.find((a) => a.jid === p.jid);
      const rooms = acc?.rooms ? [...acc.rooms] : [];
      if (importRooms) for (const r of p.rooms) if (!rooms.some((x) => x.jid === r.jid)) rooms.push(r);
      acc = store.upsertAccount({
        ...(acc || {}),
        jid: p.jid,
        alias: acc?.alias || p.alias,
        host: p.host,
        port: p.port,
        security: p.security,
        autoLogin: p.autoLogin,
        nick: acc?.nick || p.alias,
        rooms,
      });
      // Sin llavero (Linux) la contraseña no se guarda: se importa la cuenta igualmente y se pide al conectar.
      let passwordSaved = false;
      if (importPasswords && p.password) {
        try {
          await store.setPassword(acc.id, p.password);
          passwordSaved = true;
        } catch (err) {
          if (err.code !== "NO_KEYRING") throw err;
        }
      }
      let logResult = null;
      if (doLogs) {
        const cfg = store.get();
        logResult = await importLogs({
          logsDir: p.logsDir,
          selfNames: [p.alias, p.jid.split("@")[0]].map((s) => s.toLowerCase()),
          logs,
          accountId: acc.id,
          alreadyImported: cfg.imported,
          onProgress: (pr) => send("import-progress", pr),
        });
        // 2 = importado con las reglas actuales; 1 = con una versión anterior, que puede necesitar reparación.
        for (const f of logResult.files) cfg.imported[f] = 2;
        store.save();
        logResult = { conversations: logResult.conversations, messages: logResult.messages };
      }
      results.push({ jid: p.jid, accountId: acc.id, rooms: p.rooms.length, logs: logResult, password: passwordSaved, ...(importPasswords && p.password && !passwordSaved ? { passwordNotSaved: "no-keyring" } : {}) });
    }
    store.flush();
    return { results, accounts: store.get().accounts.map(publicAccount) };
  });
}
