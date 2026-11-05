// Pings repetidos: algunos bots mandan una copia del broadcast a cada conexión de la cuenta. Con Pidgin abierto a la
// vez, el servidor reenvía además a EvEX-MPP la copia de Pidgin (Message Carbons, XEP-0280), y llegan dos pings casi
// iguales: solo cambia la hora del pie («at 2026-11-04 17:50:24.895801 EVE»), a veces en un segundo.
import { pingFingerprint, senderTargets } from "./ping-recovery.js";

export { pingFingerprint };
export const REPEAT_MS = 10000;

export function isPingSender(pingSenders, accountJid, conv) {
  const c = String(conv || "").toLowerCase();
  return senderTargets(pingSenders, accountJid).some((tg) => tg.jid === c);
}

// Recuerda los pings recientes por conversación; `repeated` dice si el texto ya llegó hace menos de `windowMs`.
export function createPingDedupe(windowMs = REPEAT_MS) {
  const recent = new Map(); // conversación -> [{ fp, ts }]
  return {
    repeated(conv, body, ts) {
      const fp = pingFingerprint(body);
      const list = (recent.get(conv) || []).filter((x) => Math.abs(ts - x.ts) <= windowMs);
      const dup = list.some((x) => x.fp === fp);
      if (!dup) list.push({ fp, ts });
      recent.set(conv, list);
      return dup;
    },
  };
}
