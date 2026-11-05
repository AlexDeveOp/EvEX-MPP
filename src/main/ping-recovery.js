// Recuperar los pings que llegaron con EvEX-MPP cerrado: de los registros de Pidgin en este PC (si Pidgin estaba
// conectado, el servidor se los entregó a él) y del archivo de mensajes del servidor (XEP-0313), si lo tiene.
// Las entradas se guardan en el historial local sin duplicar las que ya están.
import fs from "node:fs";
import path from "node:path";
import { parseLogFile, detectDateOrder } from "./pidgin-import.js";

const NEAR_MS = 120000;
// Caracteres invisibles que algunos bots meten en los pings (marca de agua): no cuentan al comparar.
const INVISIBLE = /[\u200b-\u200d\ufeff]/g;

// Texto comparable: sin invisibles y con los espacios y saltos de línea juntos. Pidgin y el servidor pueden
// diferir en eso (HTML del registro, \r\n).
export function normBody(s) {
  return String(s ?? "")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Fechas y horas («2026-11-05 00:05:02.548411»): cada copia de un mismo ping lleva la suya en el pie.
const STAMP = /\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?/g;

// Huella de un ping: el texto comparable sin fechas ni horas. Dos copias del mismo broadcast (la de EvEX-MPP y la que
// guardó Pidgin) solo se diferencian en eso, a veces en un segundo.
export function pingFingerprint(body) {
  return normBody(body).replace(STAMP, "#");
}

// Direcciones completas de los remitentes de pings para una cuenta. «pingbot» (sin dominio) se busca en el servidor de
// la cuenta; para los registros de Pidgin vale con cualquier dominio.
export function senderTargets(pingSenders, accountJid) {
  const domain = String(accountJid || "").split("@")[1]?.split("/")[0] || "";
  return [...new Set((pingSenders || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean))].map((s) => ({
    jid: s.includes("@") ? s : domain ? `${s}@${domain}` : "",
    local: s.includes("@") ? null : s,
  }));
}

// Carpetas de conversación de Pidgin («logs/jabber/<cuenta>/<contacto>») que corresponden a un remitente.
function senderDirs(logsDir, target) {
  let dirs;
  try {
    dirs = fs.readdirSync(logsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.endsWith(".chat"));
  } catch {
    return [];
  }
  return dirs.filter((d) => {
    const name = d.name.toLowerCase();
    return name === target.jid || (target.local && name.split("@")[0] === target.local);
  }).map((d) => path.join(logsDir, d.name));
}

// Pings recibidos por Pidgin para un remitente, de los ficheros modificados desde `sinceMs`. `selfNames` (en
// minúsculas) son los nombres con los que Pidgin escribe tus propios mensajes, que no son pings.
export function pidginPingEntries(logsDir, target, sinceMs = 0, selfNames = []) {
  const out = [];
  for (const dir of senderDirs(logsDir, target)) {
    let files;
    try {
      files = fs.readdirSync(dir).filter((f) => /\.(html?|txt)$/i.test(f)).map((f) => path.join(dir, f));
    } catch {
      continue;
    }
    const recent = files.filter((f) => {
      try {
        return fs.statSync(f).mtimeMs >= sinceMs;
      } catch {
        return false;
      }
    });
    if (!recent.length) continue;
    const dateOrder = detectDateOrder(files);
    for (const f of recent) for (const e of parseLogFile(f, { dateOrder, selfNames })) if (e.nick && !e.out && !e.sys) out.push(e);
  }
  return out;
}

// Guarda las entradas que falten en la conversación del remitente y devuelve cuántas se añadieron. Una entrada ya está
// si hay otra recibida con el mismo texto (normalizado y sin fechas ni horas) con menos de 2 minutos de diferencia,
// venga de donde venga.
export function storeRecovered(logs, accountId, conv, entries, nick) {
  if (!entries.length) return 0;
  const existing = logs.tail(accountId, conv, Infinity).filter((e) => !e.out);
  const byBody = new Map();
  const remember = (body, ts) => {
    const k = pingFingerprint(body);
    if (!byBody.has(k)) byBody.set(k, []);
    byBody.get(k).push(ts);
  };
  for (const e of existing) remember(e.body, e.ts);
  const name = nick || [...existing].reverse().find((e) => e.nick)?.nick || conv.split("@")[0];
  const fresh = [];
  for (const e of [...entries].sort((a, b) => a.ts - b.ts)) {
    if (!e.body || !Number.isFinite(e.ts)) continue;
    if (byBody.get(pingFingerprint(e.body))?.some((ts) => Math.abs(ts - e.ts) <= NEAR_MS)) continue;
    remember(e.body, e.ts);
    fresh.push({ ts: e.ts, nick: name, body: e.body, ...(e.jid ? { jid: e.jid } : {}) });
  }
  return fresh.length ? logs.mergeImport(accountId, conv, fresh) : 0;
}

