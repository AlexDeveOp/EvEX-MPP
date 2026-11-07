// Bots de pings simulados para el servidor de pruebas (test/mock-xmpp.mjs), para el «Modo FC» (enviar pings de flota).
// Hay dos formas de elegir el grupo de destino, las mismas que usan las alianzas:
//
// 1. Modo «address» (una dirección por grupo): imita el complemento Broadcast de Openfire
//    (https://github.com/igniterealtime/openfire-broadcast-plugin, BroadcastPlugin.java):
//    - Servicio broadcast.<dominio>. «all@broadcast.<dominio>» va a todos los conectados; «<grupo>@broadcast.<dominio>»
//      a los miembros del grupo.
//    - Quién puede enviar (como plugin.broadcast.*): a «all», cualquiera si allowedUsers está vacío, si no solo ellos;
//      a un grupo, cualquiera si disableGroupPermissions, sus miembros si groupMembersAllowed (de serie sí) y los de
//      allowedUsers.
//    - Si se acepta, el remitente NO recibe nada (Openfire no confirma). Cada miembro recibe una copia del mensaje tal
//      cual: mismo tipo, «from» = el remitente (no el servicio) y sin pie; solo messagePrefix delante del texto si
//      está puesto. El remitente solo recibe copia si es miembro (o con «all», porque está conectado).
//    - Si se rechaza (sin permiso o grupo que no existe): mensaje de error con not-allowed (type="cancel"), el mismo id,
//      asunto «Error sending broadcast message» y el texto «Not allowed to send a broadcast message to <dir>» o
//      «Address not valid: <dir>».
//    - disco#info y disco#items del servicio como Openfire (los grupos que puede usar quien pregunta; item-not-found
//      para un grupo que no existe o que no puede usar).
//    - El grupo «silent» solo tiene un miembro que nunca se conecta («ausente»): lo que le manda alguien de allowedUsers
//      se acepta y no vuelve nada, como cualquier envío aceptado en Openfire de quien no es miembro. (Quien sí es miembro
//      recibe su propia copia, que sirve de confirmación; quien no es miembro ni está en allowedUsers recibe el error.)
//    - Diferencia con Openfire: este servidor no guarda mensajes para los desconectados.
//
// 2. Modo «line» (una línea al principio): un bot de chat, pingbot@<dominio>, como los bots de pings de las alianzas.
//    - Se le escribe «!ping <grupo>» en la primera línea y el ping debajo.
//    - Si se acepta, los miembros reciben el ping de pingbot@<dominio>/bot (tipo chat) con el pie
//      «~~~ This was a coord broadcast from <remitente> to <grupo> at AAAA-MM-DD HH:MM:SS.000000 EVE ~~~» y el remitente
//      recibe «Broadcast sent to N users».
//    - Sin permiso: «You are not allowed to broadcast to <grupo>». Grupo que no existe: «Unknown group: <grupo>». Sin la
//      línea «!ping»: «Usage: !ping <group> on the first line, then the ping text».
//    - El grupo «silent» se acepta y nunca contesta ni lo reparte (para probar el «sin confirmar»).
//
// Usuarios de prueba (contraseña «test», como todos; «usuario» es la cuenta de siempre y «piloto» la de la demo):
//   fc_bob    address: all y cualquier grupo (allowedUsers) · line: all y caps
//   fc_ana    address: all y cualquier grupo (allowedUsers) · line: all, caps y supers
//   usuario   address: caps (es miembro) · line: caps y silent
//   piloto    address: caps (es miembro) · line: all, caps y silent (la cuenta de la demo)
//   piloto1   nada en ninguno de los dos (y no es miembro de ningún grupo)
// Grupos: caps = usuario, piloto, fc_bob, piloto_dos · supers = fc_ana, piloto_tres · silent = ausente (nunca conectado).
// «all» llega a todos los conectados.
//
// Se puede cambiar todo con MOCK_BOTS=<fichero.json> (se mezcla con lo de aquí: { address: {…}, line: {…}, groups: {…} })
// y apagar los dos con MOCK_BOTS=off.
import fs from "node:fs";
import xml from "@xmpp/xml";

const STANZAS = "urn:ietf:params:xml:ns:xmpp-stanzas";
const DISCO_INFO = "http://jabber.org/protocol/disco#info";
const DISCO_ITEMS = "http://jabber.org/protocol/disco#items";

export const DEFAULT_BOTS = {
  groups: {
    caps: ["usuario", "piloto", "fc_bob", "piloto_dos"],
    supers: ["fc_ana", "piloto_tres"],
    silent: ["ausente"],
  },
  address: {
    enabled: true,
    serviceName: "broadcast",
    allowedUsers: ["fc_bob", "fc_ana"],
    groupMembersAllowed: true,
    disableGroupPermissions: false,
    messagePrefix: null,
  },
  line: {
    enabled: true,
    bot: "pingbot",
    command: "!ping",
    permissions: {
      fc_bob: ["all", "caps"],
      fc_ana: ["all", "caps", "supers"],
      usuario: ["caps", "silent"],
      // La cuenta de la demo (npm run demo): en la ventana «Enviar ping» sale enviado a all y caps, rechazado en supers
      // y sin confirmar en silent.
      piloto: ["all", "caps", "silent"],
      piloto1: [],
    },
    silent: ["silent"],
  },
};

const bareOf = (jid) => String(jid || "").split("/")[0].toLowerCase();
const localOf = (jid) => bareOf(jid).split("@")[0];
// Lo que viene del cliente, sin saltos de línea, antes de registrarlo.
const clean = (s) => String(s ?? "").replace(/[\r\n]/g, " ").slice(0, 200);

function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" ? merge(base[k], v) : v;
  return out;
}

export function loadBotsConfig(env = process.env) {
  if (env.MOCK_BOTS === "off") return merge(DEFAULT_BOTS, { address: { enabled: false }, line: { enabled: false } });
  if (!env.MOCK_BOTS) return DEFAULT_BOTS;
  return merge(DEFAULT_BOTS, JSON.parse(fs.readFileSync(env.MOCK_BOTS, "utf8")));
}

// Hora EVE (UTC) como la ponen los bots en el pie.
export function eveStamp(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.000000`;
}

// domain: el del servidor · log: el del mock · config: loadBotsConfig().
export function createBots({ domain, log = () => {}, config = DEFAULT_BOTS, now = () => Date.now() }) {
  const sessions = new Map(); // JID completo -> send
  const service = `${config.address.serviceName}.${domain}`;
  const botJid = `${config.line.bot}@${domain}`;
  const groups = config.groups;

  const online = () => [...sessions.keys()];
  const deliver = (fullJids, make) => {
    for (const j of fullJids) sessions.get(j)?.(make(j));
  };
  const membersOnline = (group) => {
    const members = new Set((groups[group] || []).map((u) => `${u}@${domain}`));
    return online().filter((j) => members.has(bareOf(j)));
  };

  // ---- modo «address» (Openfire Broadcast) ----
  const addr = config.address;
  const isAllowedUser = (from) => addr.allowedUsers.some((u) => (u.includes("@") ? u.toLowerCase() : `${u}@${domain}`) === bareOf(from));
  const canSendAll = (from) => !addr.allowedUsers.length || isAllowedUser(from);
  const isMember = (group, from) => (groups[group] || []).some((u) => `${u}@${domain}` === bareOf(from));
  const canSendGroup = (group, from) => addr.disableGroupPermissions || (addr.groupMembersAllowed && isMember(group, from)) || isAllowedUser(from);
  const usableGroups = (from) => Object.keys(groups).filter((g) => g !== "all" && canSendGroup(g, from));

  function addressMessage(st, from, send) {
    const to = st.attrs.to;
    const node = to.split("@")[0].toLowerCase();
    if (st.attrs.type === "error") return true;
    const fail = (text) => {
      log("broadcast rechazado", clean(from), "→", clean(to));
      send(xml("message", { type: "error", from: to, to: from, ...(st.attrs.id ? { id: st.attrs.id } : {}) }, xml("subject", {}, "Error sending broadcast message"), xml("body", {}, text), xml("error", { type: "cancel" }, xml("not-allowed", STANZAS))));
    };
    const copy = (target) => {
      const children = st.getChildElements().map((c) => (c.name === "body" && addr.messagePrefix ? xml("body", c.attrs, `${addr.messagePrefix} ${c.text()}`) : c));
      return xml("message", { ...st.attrs, from, to: target }, ...children);
    };
    if (node === "all") {
      if (!canSendAll(from)) return fail(`Not allowed to send a broadcast message to ${to}`), true;
      const targets = online();
      log("broadcast", clean(from), "→ all:", targets.length, "sesiones");
      deliver(targets, copy);
      return true;
    }
    if (!(node in groups)) return fail(`Address not valid: ${to}`), true;
    if (!canSendGroup(node, from)) return fail(`Not allowed to send a broadcast message to ${to}`), true;
    const targets = membersOnline(node);
    log("broadcast", clean(from), "→", node + ":", targets.length, "sesiones");
    deliver(targets, copy);
    return true;
  }

  function addressIq(st, from, send) {
    const to = st.attrs.to || "";
    if (st.attrs.type === "result" || st.attrs.type === "error") return true;
    const q = st.getChildElements()[0];
    const ns = q?.attrs.xmlns;
    const reply = (...children) => send(xml("iq", { type: "result", id: st.attrs.id, from: to, to: from }, ...children));
    const error = (cond, type = "cancel") => send(xml("iq", { type: "error", id: st.attrs.id, from: to, to: from }, ...(q ? [q] : []), xml("error", { type }, xml(cond, STANZAS))));
    const node = to.includes("@") ? to.split("@")[0].toLowerCase() : null;
    if (ns === DISCO_INFO && !node && !q.attrs.node)
      return reply(xml("query", { xmlns: DISCO_INFO }, xml("identity", { category: "component", type: "generic", name: "Broadcast service" }), xml("feature", { var: DISCO_INFO }), xml("feature", { var: DISCO_ITEMS }))), true;
    if (ns === DISCO_INFO && node) {
      if (node === "all") return reply(xml("query", { xmlns: DISCO_INFO }, xml("identity", { category: "component", type: "generic", name: "Broadcast all connected users" }), xml("feature", { var: DISCO_INFO }))), true;
      if (node in groups && canSendGroup(node, from)) return reply(xml("query", { xmlns: DISCO_INFO }, xml("identity", { category: "component", type: "generic", name: `Broadcast ${node}` }), xml("feature", { var: DISCO_INFO }))), true;
      return error("item-not-found"), true;
    }
    if (ns === DISCO_ITEMS && !node) {
      const items = usableGroups(from).map((g) => xml("item", { jid: `${g}@${service}`, name: g }));
      if (canSendAll(from)) items.push(xml("item", { jid: `all@${service}`, name: "all" }));
      return reply(xml("query", { xmlns: DISCO_ITEMS }, ...items)), true;
    }
    return error("service-unavailable"), true;
  }

  // ---- modo «line» (bot de chat con «!ping <grupo>») ----
  const line = config.line;
  const lineCan = (from, group) => (line.permissions[localOf(from)] || []).includes(group);

  function lineMessage(st, from, send) {
    const body = st.getChildText("body");
    if (st.attrs.type === "error" || body == null) return true;
    const answer = (text) => send(xml("message", { from: `${botJid}/bot`, to: from, type: "chat", id: `bot${now()}${Math.random().toString(36).slice(2, 6)}` }, xml("body", {}, text)));
    const nl = body.indexOf("\n");
    const first = (nl < 0 ? body : body.slice(0, nl)).trim();
    const text = nl < 0 ? "" : body.slice(nl + 1);
    const m = first.match(/^(\S+)\s+(\S+)\s*$/);
    if (!m || m[1].toLowerCase() !== line.command || !text.trim()) return answer(`Usage: ${line.command} <group> on the first line, then the ping text`), true;
    const group = m[2].toLowerCase();
    if (group !== "all" && !(group in groups)) return log("bot: grupo desconocido", clean(group)), answer(`Unknown group: ${group}`), true;
    if (!lineCan(from, group)) return log("bot: sin permiso", clean(from), "→", clean(group)), answer(`You are not allowed to broadcast to ${group}`), true;
    if (line.silent.includes(group)) return log("bot: aceptado sin respuesta", clean(from), "→", clean(group)), true;
    const footer = `~~~ This was a coord broadcast from ${localOf(from)} to ${group} at ${eveStamp(now())} EVE ~~~`;
    // El texto va tal cual (con sus invisibles), con una línea en blanco y el pie, como los bots reales.
    const ping = `${text.replace(/\n+$/, "")}\n\n${footer}`;
    const users = group === "all" ? [...new Set(online().map(bareOf))] : (groups[group] || []).map((u) => `${u}@${domain}`);
    const targets = group === "all" ? online() : membersOnline(group);
    log("bot: broadcast", clean(from), "→", group + ":", users.length, "usuarios,", targets.length, "sesiones");
    deliver(targets, (j) => xml("message", { from: `${botJid}/bot`, to: j, type: "chat", id: `bc${now()}${Math.random().toString(36).slice(2, 6)}` }, xml("body", {}, ping)));
    answer(`Broadcast sent to ${users.length} users`);
    return true;
  }

  return {
    service,
    botJid,
    // Elemento para el disco#items del dominio (Openfire anuncia sus componentes).
    discoItem: () => (addr.enabled ? xml("item", { jid: service, name: "Broadcast service" }) : null),
    register(fullJid, send) {
      sessions.set(fullJid, send);
    },
    unregister(fullJid) {
      sessions.delete(fullJid);
    },
    // true si el mensaje era para un bot (y ya está atendido).
    onMessage(st, from, send) {
      const to = bareOf(st.attrs.to);
      if (addr.enabled && to.endsWith(`@${service}`)) return addressMessage(st, from, send);
      if (line.enabled && to === botJid) return lineMessage(st, from, send);
      return false;
    },
    onIq(st, from, send) {
      const to = bareOf(st.attrs.to);
      if (addr.enabled && (to === service || to.endsWith(`@${service}`))) return addressIq(st, from, send);
      return false;
    },
  };
}
