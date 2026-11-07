// Modo FC: el núcleo para ENVIAR pings de flota (sin interfaz).
// OJO: lo importan los DOS lados, el proceso principal (src/main/fc-ipc.js) y la interfaz. Tiene que seguir siendo
// puro: no puede importar nada (ni del DOM, ni de electron, ni otros módulos).
// El texto del ping va TAL CUAL: nunca se normaliza, recorta ni se le quitan los caracteres invisibles (algunas alianzas
// marcan así cada copia; ver feedback de opsec). Solo se componen las piezas.

// ---------- plantilla ----------

const PLACEHOLDER = /\{([a-zA-Z][\w-]*)\}/g;
// Separadores entre campos de una misma línea («FC: {fc} · Comms: {comms}»).
const SEPARATORS = [" · ", " | ", " - ", " — ", ", "];

const isEmpty = (v) => v === undefined || v === null || String(v) === "";

// Rellena el formato con los campos. Una línea cuyos campos están TODOS vacíos se quita entera (con su etiqueta: «FC:
// {fc}» sin FC no deja «FC:»). Si en una línea solo falta alguno, se quita ese trozo y el separador que lo acompaña.
// Las llaves que no son de un campo conocido ({otra}) se dejan como están. Los valores van tal cual.
export function renderTemplate(format, fields = {}) {
  const known = (k) => Object.prototype.hasOwnProperty.call(fields, k);
  const out = [];
  let removedBefore = false;
  for (const line of String(format ?? "").split("\n")) {
    const keys = [...line.matchAll(PLACEHOLDER)].map((m) => m[1]).filter(known);
    if (keys.length && keys.every((k) => isEmpty(fields[k]))) {
      removedBefore = true;
      continue;
    }
    let text = line;
    if (keys.some((k) => isEmpty(fields[k]))) text = dropEmptyPieces(text, fields, known);
    text = text.replace(PLACEHOLDER, (m, k) => (known(k) ? String(fields[k] ?? "") : m));
    // Una línea en blanco que queda pegada a otra en blanco por haber quitado lo de en medio, sobra.
    if (text === "" && removedBefore && out.length && out[out.length - 1] === "") {
      removedBefore = false;
      continue;
    }
    removedBefore = false;
    out.push(text);
  }
  while (out.length && out[out.length - 1] === "" && String(format ?? "").split("\n").at(-1) !== "") out.pop();
  return out.join("\n");
}

// Quita de una línea los trozos (entre separadores) cuyo campo está vacío.
function dropEmptyPieces(line, fields, known) {
  const sep = SEPARATORS.find((s) => line.includes(s));
  const emptyPiece = (piece) => {
    const keys = [...piece.matchAll(PLACEHOLDER)].map((m) => m[1]).filter(known);
    return keys.length > 0 && keys.every((k) => isEmpty(fields[k]));
  };
  if (!sep) return line.replace(PLACEHOLDER, (m, k) => (known(k) && isEmpty(fields[k]) ? "" : m));
  return line
    .split(sep)
    .filter((piece) => !emptyPiece(piece))
    .join(sep);
}

// ---------- plan de envío ----------

// Los errores llevan un código (error.code) y los datos (error.group, error.mode); el texto lo pone la interfaz con t(),
// porque este módulo no puede importar nada. Códigos: FC_ERRORS.
export const FC_ERRORS = ["no-address", "no-bot", "unknown-mode", "no-text", "no-groups"];
function fcError(code, data = {}) {
  return Object.assign(new Error(`fc:${code}`), { code, ...data });
}

// Cómo se elige el grupo de destino. Cada modo devuelve { to, body } para un grupo. Para añadir un tercero, basta con
// otra entrada aquí (y su opción en Preferencias).
export const SEND_MODES = {
  // Una dirección por grupo (all@pings.ejemplo.com): el texto va tal cual a esa dirección.
  address: ({ group, text }) => {
    if (!group.address) throw fcError("no-address", { group: group.name });
    return { to: group.address, body: text };
  },
  // Una línea al principio («!ping all») y el texto debajo, todo al canal del bot.
  line: ({ group, text, linePrefix, botJid }) => {
    if (!botJid) throw fcError("no-bot");
    const first = String(linePrefix ?? "{grupo}").replace(/\{grupo\}|\{group\}/g, group.name);
    return { to: botJid, body: `${first}\n${text}` };
  },
};

// Un mensaje por grupo: [{ group, to, body }]. El texto nunca se toca.
export function buildPlan({ mode = "address", groups = [], linePrefix = "!ping {grupo}", botJid = "", text = "" } = {}) {
  const make = SEND_MODES[mode];
  if (!make) throw fcError("unknown-mode", { mode });
  if (typeof text !== "string" || text === "") throw fcError("no-text");
  if (!groups.length) throw fcError("no-groups");
  return groups.map((group) => ({ group: group.name, ...make({ group, text, linePrefix, botJid }) }));
}

// ---------- respuesta del bot ----------

// De serie, sin configurar nada. Un «texto que indica que se ha enviado» propio sustituye a los de éxito.
export const DEFAULT_SENT = /\b(?:sent|broadcast(?:ed)?|delivered|ping(?:ed)? sent|enviado)\b/i;
// Los fallos van aquí también: DEFAULT_SENT acepta «broadcast», y «Broadcast failed» o «Error broadcasting…» no pueden
// salir como enviados (el rechazo manda sobre el éxito).
export const DEFAULT_REJECTED = /\b(?:denied|not allowed|no permission|permission denied|forbidden|unauthori[sz]ed|rejected|not authori[sz]ed|unknown (?:group|command)|invalid group|fail(?:ed|ure|s)?|errors?|could not|couldn'?t|unable|usage|rechazado|sin permiso|no autorizado|fallo|fall[oó]|no se pudo)\b/i;

// Texto configurable → expresión: si parece una (/…/i) se usa como tal; si no, el texto tal cual, sin mayúsculas.
export function toPattern(spec) {
  if (!spec) return null;
  if (spec instanceof RegExp) return spec;
  const s = String(spec);
  const re = /^\/(.+)\/([a-z]*)$/i.exec(s);
  if (re) {
    try {
      return new RegExp(re[1], re[2].includes("i") ? re[2] : `${re[2]}i`);
    } catch {
      return null;
    }
  }
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

// Estados de un envío (la interfaz pone el texto):
// - sent        «Enviado»: el bot ha dicho que lo ha mandado (modo line). Manda sobre los demás salvo rejected.
// - delivered   «Entregado: te ha llegado tu copia»: sin respuesta del bot, pero ha llegado la copia propia (address)
//               o el ping con su pie y nuestro texto (line).
// - accepted    «No rechazado por el servidor» (gris, nunca verde): modo address sin error al terminar la espera. El
//               servicio de broadcast de Openfire no confirma nada cuando acepta; solo avisa si rechaza.
// - unconfirmed «Sin confirmar»: modo line sin respuesta ni copia.
// - rejected    «Rechazado»: error del servidor o respuesta del bot que lo dice.
// Solo sent y delivered cuentan como enviados.
export const STATUSES = ["sent", "delivered", "accepted", "unconfirmed", "rejected"];
export const isConfirmed = (status) => status === "sent" || status === "delivered";

// reply: null (sin respuesta a tiempo) | { error: { condition, text } } | { body }.
// mode: el del envío; echo: si ha llegado la copia propia. → { status, reason }. Sin respuesta nunca es «sent».
export function interpretReply(reply, { sentPattern, rejectedPattern, mode = "line", echo = false } = {}) {
  if (!reply) {
    if (echo) return { status: "delivered", reason: "echo" };
    return mode === "address" ? { status: "accepted", reason: "no-error" } : { status: "unconfirmed", reason: "timeout" };
  }
  if (reply.error) return { status: "rejected", reason: reply.error.text || reply.error.condition || "error" };
  const body = String(reply.body ?? "");
  const rejected = toPattern(rejectedPattern) || DEFAULT_REJECTED;
  const sent = toPattern(sentPattern) || DEFAULT_SENT;
  if (rejected.test(body)) return { status: "rejected", reason: body };
  if (sent.test(body)) return { status: "sent", reason: body };
  // Una respuesta que no se entiende no tapa la copia propia, si ha llegado.
  return { status: echo ? "delivered" : "unconfirmed", reason: body };
}

// ¿Es un ping reenviado por el bot (con su pie «~~~ This was a … broadcast from … to … ~~~»)? No es la respuesta del
// bot. Para saber si es el NUESTRO (la copia propia), isEchoOf.
const BROADCAST_FOOTER = /~~~[^~]*\b(?:broadcast|ping)\b[^~]*\bfrom\b[^~]*\bto\b[^~]*~~~/i;
export const isBroadcastEcho = (body) => BROADCAST_FOOTER.test(String(body ?? ""));

// Copia SOLO para comparar (nunca se enseña ni se envía): sin invisibles ni espacios, que un bot puede recolocar.
const squash = (s) => String(s ?? "").replace(/[\s\u200B-\u200D\u2060\uFEFF]+/g, "");

// Modo line: ¿es el ping que acabamos de mandar, reenviado por el bot con su pie? (Otro ping del mismo bot no cuenta.)
export function isEchoOf(body, text) {
  if (!isBroadcastEcho(body)) return false;
  const t = squash(text);
  return t !== "" && squash(body).includes(t);
}

// Modo address: ¿es la copia propia del ping? Llega desde nuestro JID, con el mismo texto y sin pie.
export function isOwnCopy(ev, { ownJid, text }) {
  const bareOf = (j) => String(j || "").split("/")[0].toLowerCase();
  const own = bareOf(ownJid);
  const body = squash(ev?.body);
  return !!own && bareOf(ev?.conv) === own && body !== "" && body === squash(text);
}
