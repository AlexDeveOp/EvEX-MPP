// Modo FC: envía los pings de flota del plan (fc-send.js) por la cuenta elegida y espera la respuesta del bot.
// - Un mensaje por grupo, uno detrás de otro, para no mezclar las respuestas.
// - La respuesta se reconoce por el remitente (la dirección del grupo o el canal del bot; en una sala, el nick del bot)
//   y un error del servidor por el id de la stanza.
// - Solo se OBSERVAN los eventos de la cuenta: las respuestas del bot siguen llegando al chat como siempre.
// - Sin respuesta nunca es «sent» (los estados, en fc-send.js): en line, «unconfirmed» a los FC_REPLY_MS; en address,
//   «accepted» a los FC_ADDRESS_MS (Openfire solo avisa si rechaza). Si llega la copia propia (en line, el ping con su
//   pie y nuestro texto), «delivered»; en line, la respuesta de éxito del bot sigue mandando («sent»).
// - Mientras se espera, la respuesta del bot se marca (markFcReply) para que se guarde y se vea como un mensaje normal
//   del chat con el bot y no como un ping.
import { buildPlan, interpretReply, isBroadcastEcho, isEchoOf, isOwnCopy } from "../renderer/js/fc-send.js";

// Espera a la respuesta de un bot de chat (modo line): los bots tardan lo suyo.
export const FC_REPLY_MS = 15e3;
// Modo address: el servicio de broadcast de Openfire rechaza al momento (al procesar el mensaje, antes de repartirlo) y
// no contesta si acepta. 5 s cubren de sobra la ida y vuelta por un proxy o una red lenta sin dejar al FC esperando 15 s
// por grupo para algo que nunca va a llegar.
export const FC_ADDRESS_MS = 5e3;
const bare = (jid) => String(jid || "").split("/")[0].toLowerCase();

// Envíos en curso por conexión: cada uno sabe reconocer la respuesta de su bot. Solo viven lo que dura la espera.
const pending = new Map(); // x → Set<(ev) => boolean>

// La respuesta del bot llega desde el mismo JID que los pings: sin esto se guardaría y avisaría como un ping. main.js lo
// llama ANTES de guardar o enviar el evento a la interfaz: marca ev.fcReply si es la respuesta a un envío en curso. Un
// ping de verdad (con su pie de broadcast) no se marca nunca.
export function markFcReply(x, ev) {
  if (ev?.type !== "message") return false;
  for (const claims of pending.get(x) || []) {
    if (claims(ev)) {
      ev.fcReply = true;
      return true;
    }
  }
  return false;
}

// req: { mode, groups, linePrefix, botJid, botNick, channelType: "chat" | "groupchat", text, sentPattern, rejectedPattern }
// → [{ group, to, status, reason, reply, echo }]
export async function sendPlan(x, req = {}, { timeoutMs = req.mode === "address" ? FC_ADDRESS_MS : FC_REPLY_MS } = {}) {
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
    let done = false;
    const fromBot = (ev) => {
      if (bare(ev.conv) !== target) return false;
      // En una sala hablan todos: solo vale lo que dice el bot (si no se sabe su nick, no se adivina).
      if (inRoom) return !!botNick && ev.nick === botNick;
      return true;
    };
    // ¿Es la respuesta del bot a este envío? (No el eco ni un ping con pie.)
    const isReply = (ev) => !done && ev.type === "message" && !ev.outgoing && !ev.system && fromBot(ev) && !isBroadcastEcho(ev.body);
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
      // En «una dirección por grupo» el servicio de broadcast no contesta si acepta: si el FC es miembro del grupo, le
      // llega su propia copia (desde su JID, mismo texto, sin pie). Openfire ya no puede rechazarlo: entregado.
      // (Otros servicios sí contestan desde la dirección del grupo: eso se lee abajo como respuesta.)
      if (req.mode !== "line" && isOwnCopy(ev, { ownJid: x.ownJid, text: req.text })) {
        echo = true;
        finish(null);
        return;
      }
      if (!fromBot(ev)) return;
      // Un ping con su pie: si es el nuestro (con nuestro texto), es la copia propia; la respuesta del bot, si llega, manda.
      if (isBroadcastEcho(ev.body)) {
        if (isEchoOf(ev.body, req.text)) echo = true;
        return;
      }
      finish({ body: ev.body });
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();
    if (!pending.has(x)) pending.set(x, new Set());
    pending.get(x).add(isReply);
    x.on("event", onEvent);
    function finish(reply) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      x.off("event", onEvent);
      pending.get(x)?.delete(isReply);
      if (!pending.get(x)?.size) pending.delete(x);
      const r = interpretReply(reply, { sentPattern: req.sentPattern, rejectedPattern: req.rejectedPattern, mode: req.mode, echo });
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
