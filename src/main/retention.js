// Caducidad del historial local (Preferencias → Privacidad): borra los mensajes más antiguos que el plazo elegido.
// Garantías (borra datos reales, así que van con test):
// - Con «Nunca» (0 días) no se abre ni se reescribe ningún fichero.
// - Solo se tocan los .jsonl de logs/<idCuenta>/ de EvEX-MPP; nunca los registros de Pidgin ni nada fuera de ahí.
// - Las líneas que no se entienden (JSON roto, campos de versiones futuras, sin hora) se conservan tal cual y en su sitio.
// - Se escribe un temporal y se renombra: si algo falla a mitad, el fichero original queda intacto.
// - Los pings marcados para SRP no se borran mientras tengan la marca.
// - Solo se aplican plazos guardados, y la ventana solo los guarda después de que el usuario confirme lo que se borra.
import fs from "node:fs";
import path from "node:path";
import { Logs } from "./logs.js";
import { isPingSender } from "./ping-dedupe.js";

export const DAY_MS = 86400e3;
export const DAY_CHOICES = [0, 30, 90, 180, 365];
export const RETENTION_DEFAULTS = { messagesDays: 0, pingsDays: 0, fleetsDays: 90 };

// ¿Es la conversación de un remitente de pings? Como en la ventana (convs.js): «pingbot» sin dominio vale en cualquier
// servidor. Se usa la versión más amplia para no tratar nunca un ping como un mensaje normal.
export function isPingConv(pingSenders, accountJid, conv) {
  const local = String(conv || "").toLowerCase().split("@")[0];
  return isPingSender(pingSenders, accountJid, conv) || (pingSenders || []).some((s) => !String(s).includes("@") && String(s).trim().toLowerCase() === local);
}

const pick = (v, fallback) => (DAY_CHOICES.includes(Number(v)) ? Number(v) : fallback);

// Plazos normalizados: solo los valores de la lista; cualquier otra cosa vuelve al de serie.
export function retentionSettings(r = {}) {
  return {
    messagesDays: pick(r?.messagesDays, RETENTION_DEFAULTS.messagesDays),
    pingsDays: pick(r?.pingsDays, RETENTION_DEFAULTS.pingsDays),
    fleetsDays: pick(r?.fleetsDays, RETENTION_DEFAULTS.fleetsDays),
  };
}

// Fecha de corte (ms) de una conversación, o null si no caduca («Nunca»).
export function convCutoff(r, { ping = false, now = Date.now() } = {}) {
  const days = ping ? r.pingsDays : r.messagesDays;
  return days > 0 ? now - days * DAY_MS : null;
}

// Quita de un texto JSONL las entradas más antiguas que el corte. Devuelve { text, removed }.
// Se borra solo una línea que sea un objeto con "ts" numérico anterior al corte y que no esté en keepKeys; todo lo
// demás (líneas rotas, sin hora, de versiones futuras) se queda tal cual, en el mismo orden.
export function pruneText(text, cutoff, keepKeys = new Set()) {
  if (cutoff == null) return { text, removed: 0 };
  const lines = text.split("\n");
  const out = [];
  let removed = 0;
  for (const line of lines) {
    let e = null;
    if (line.trim()) {
      try {
        e = JSON.parse(line);
      } catch {}
    }
    const old = e && typeof e === "object" && !Array.isArray(e) && typeof e.ts === "number" && Number.isFinite(e.ts) && e.ts < cutoff;
    if (old && !keepKeys.has(e.key || Logs.key(e))) {
      removed++;
      continue;
    }
    out.push(line);
  }
  return { text: out.join("\n"), removed };
}

// Poda un fichero. Con cutoff null no lo abre. dryRun: solo cuenta. Devuelve cuántas entradas se borran (o se borrarían).
export function pruneFile(file, cutoff, keepKeys, { dryRun = false } = {}) {
  if (cutoff == null) return 0;
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return 0;
  }
  const r = pruneText(text, cutoff, keepKeys);
  if (!r.removed || dryRun) return r.removed;
  // Temporal en la misma carpeta y renombrado: el cambio es atómico. Si falla, se quita el temporal y el original sigue.
  const tmp = `${file}.${process.pid}.prune.tmp`;
  try {
    fs.writeFileSync(tmp, r.text);
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw err;
  }
  return r.removed;
}

// Ficheros de historial de una cuenta, solo dentro de logs/<idCuenta>/ (se comprueba la ruta real).
export function accountLogFiles(logs, accountId) {
  const dir = path.resolve(logs.baseDir, accountId);
  if (!dir.startsWith(path.resolve(logs.baseDir) + path.sep)) return [];
  return logs
    .listConversations(accountId)
    .map(({ conv }) => ({ conv, file: path.resolve(logs.file(accountId, conv)) }))
    .filter(({ file }) => file.startsWith(dir + path.sep) && file.endsWith(".jsonl"));
}

// Poda (o cuenta, con dryRun) todo el historial. settings: los ajustes guardados (retention, pingSenders, srp.marks).
// Devuelve { messages, pings, files }: entradas borradas de conversaciones normales, de pings y ficheros reescritos.
export function pruneHistory(logs, accounts, settings, { now = Date.now(), dryRun = false, retention } = {}) {
  const r = retentionSettings(retention ?? settings?.retention);
  const result = { messages: 0, pings: 0, files: 0 };
  // «Nunca» en los dos: ni se listan las carpetas.
  if (!r.messagesDays && !r.pingsDays) return result;
  const keep = new Set(Object.keys(settings?.srp?.marks || {}));
  for (const acc of accounts || []) {
    for (const { conv, file } of accountLogFiles(logs, acc.id)) {
      const ping = isPingConv(settings?.pingSenders, acc.jid, conv);
      const cutoff = convCutoff(r, { ping, now });
      const n = pruneFile(file, cutoff, keep, { dryRun });
      if (!n) continue;
      result[ping ? "pings" : "messages"] += n;
      if (!dryRun) {
        result.files++;
        logs.recent.delete(logs.file(acc.id, conv));
      }
    }
  }
  return result;
}

// Para logs.append/mergeImport: no volver a guardar lo que ya ha caducado (historial de sala, archivo, Pidgin).
export function cutoffFor(getSettings, getAccount) {
  return (accountId, conv, now = Date.now()) => {
    const s = getSettings();
    const r = retentionSettings(s?.retention);
    if (!r.messagesDays && !r.pingsDays) return null;
    const acc = getAccount(accountId);
    return convCutoff(r, { ping: isPingConv(s?.pingSenders, acc?.jid, conv), now });
  };
}
