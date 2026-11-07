// Modo FC: envía los pings de flota del plan (fc-send.js) por la cuenta elegida y espera la respuesta del bot.
// - Un mensaje por grupo, uno detrás de otro, para no mezclar las respuestas.
// - La respuesta se reconoce por el remitente (la dirección del grupo o el canal del bot; en una sala, el nick del bot)
//   y un error del servidor por el id de la stanza.
// - Solo se OBSERVAN los eventos de la cuenta: las respuestas del bot siguen llegando al chat como siempre.
// - Sin respuesta en FC_REPLY_MS: «unconfirmed», nunca «sent». El propio ping reenviado por el bot (con su pie de
//   broadcast) no cuenta como respuesta: se devuelve aparte, en echo.
import { buildPlan, interpretReply, isBroadcastEcho } from "../renderer/js/fc-send.js";

export const FC_REPLY_MS = 15e3;
const bare = (jid) => String(jid || "").split("/")[0].toLowerCase();

// req: { mode, groups, linePrefix, botJid, botNick, channelType: "chat" | "groupchat", text, sentPattern, rejectedPattern }
// → [{ group, to, status, reason, reply, echo }]
export async function sendPlan(x, req = {}, { timeoutMs = FC_REPLY_MS } = {}) {
  const plan = buildPlan(req);
  const results = [];
  for (const item of plan) results.push(await sendOne(x, item, req, timeoutMs));
  return results;
}

function sendOne(x, item, req, timeoutMs) {
  // El canal del bot es una sala solo en el modo «línea al principio» (en «una dirección por grupo» cada grupo es un
  // contacto).
  const inRoom = req.mode === "line" && req.channelType === "groupchat";
  const target = bare(item.to);
  const botNick = String(req.botNick || "");
  return new Promise((resolve) => {
    let id = null;
    let echo = false;
    const own = bare(x.ownJid);
    let done = false;
    const fromBot = (ev) => {
      if (bare(ev.conv) !== target) return false;
      // En una sala hablan todos: solo vale lo que dice el bot (si no se sabe su nick, no se adivina).
      if (inRoom) return !!botNick && ev.nick === botNick;
      return true;
    };
    const onEvent = (ev) => {
      if (done) return;
      if (ev.type === "message-error") {
        // Openfire Broadcast pone el motivo en el cuerpo («Not allowed to send a broadcast message to …») y deja la
        // condición sola (not-allowed); el texto del error, si lo hay, manda.
        const text = ev.message && ev.message !== ev.condition ? ev.message : ev.body || ev.message || "";
        if (id && ev.id === id) finish({ error: { condition: ev.condition || "", text } });
        return;
      }
      if (ev.type !== "message" || ev.outgoing || ev.system) return;
      // En «una dirección por grupo» el servicio de broadcast no contesta si acepta: si el FC es miembro del grupo, solo le
      // llega su propia copia (desde su JID, mismo texto, sin pie). Es una pista, no una confirmación.
      if (req.mode !== "line" && own && bare(ev.conv) === own && ev.body === item.body) {
        echo = true;
        return;
      }
      if (!fromBot(ev)) return;
      if (isBroadcastEcho(ev.body)) {
        echo = true;
        return;
      }
      finish({ body: ev.body });
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();
    x.on("event", onEvent);
    function finish(reply) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      x.off("event", onEvent);
      const r = interpretReply(reply, { sentPattern: req.sentPattern, rejectedPattern: req.rejectedPattern });
      resolve({ group: item.group, to: item.to, status: r.status, reason: r.reason, reply: reply?.body ?? null, echo });
    }
    Promise.resolve()
      .then(() => x.sendMessage({ to: item.to, body: item.body, type: inRoom ? "groupchat" : "chat" }))
      .then((sentId) => (id = sentId))
      .catch((e) => finish({ error: { condition: "send-failed", text: e?.message || String(e) } }));
  });
}

export function registerFcIpc(handle, { getConn }) {
  handle("fc:send", (accountId, req) => sendPlan(getConn(accountId), req));
}
