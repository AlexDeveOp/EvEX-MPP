// Recibos de entrega (XEP-0184) para los pings: no se devuelven.
//
// Un ping se reparte a cientos de pilotos a la vez. Si el FC usa un cliente que pide recibo, cada EvEX-MPP que lo
// recibe le devolvería uno. Por eso no se contesta cuando:
// - el remitente está en «Remitentes de pings» (el bot que manda los pings por mensaje privado);
// - el texto lleva el pie de un ping repartido («~~~ This was a … broadcast from X to Y … ~~~»), aunque el remitente
//   no esté en la lista.
// Lo que reparte el complemento Broadcast de Openfire llega con «from» = el FC y sin nada en la stanza que diga que
// viene de un broadcast (comprobado con Openfire 5.1.2 + Broadcast 1.9.3): sin el pie y si el FC no está en la lista, no
// se puede distinguir de un mensaje normal suyo, y se contesta como a cualquier mensaje.
import { isPingSender } from "./ping-dedupe.js";
import { isBroadcastEcho } from "../renderer/js/fc-send.js";

export function skipReceipt({ pingSenders, accountJid, from, body }) {
  return isPingSender(pingSenders, accountJid, String(from || "").split("/")[0]) || isBroadcastEcho(body);
}
