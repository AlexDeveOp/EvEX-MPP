// Servidor XMPP simulado y mínimo para probar EvEX-MPP sin una cuenta real (sin TLS, contraseña "test").
// Uso: node test/mock-xmpp.mjs  → cuenta usuario@test.local, servidor 127.0.0.1:5299 (o MOCK_PORT), seguridad «TLS si está disponible».
// Ofrece roster, salas MUC (general, operaciones, entrenamiento y "secret" con contraseña "pw"), historial, marcadores
// y un ping de pingbot@test.local en cada conexión (añade «pingbot» a los remitentes de pings).
// Permisos del tema (y de la administración) por sala, para probar la etiqueta «editar» y los comandos:
//   general: los participantes pueden cambiar el tema · operaciones: no pueden (la información de la sala lo dice)
//   entrenamiento: eres propietario y moderador (/config, /role, /affiliate…) · anuncios: la sala no dice nada y el
//   servidor rechaza el cambio de tema. /ping a bob devuelve «service-unavailable» y /buzz a alice te llama de vuelta.
//   En cualquier sala, escribir «!ascender» te hace administrador (y moderador) y «!degradar» te devuelve a miembro.
// Alice tiene avatar XEP-0084 (PEP): como un servidor real, si la presencia lleva capacidades (XEP-0115) se le pregunta
//   al cliente su disco#info con node#ver y, si anuncia «urn:xmpp:avatar:metadata+notify», se le manda. Escribirle
//   «!avatar» le pone otro y «!sinavatar» se lo quita.
// Con MOCK_MAM=1 anuncia archivo de mensajes (XEP-0313) y guarda en él un ping de hace 40 minutos que nunca se entregó,
// como si hubiera llegado con la app cerrada.
// Con MOCK_DEMO=1 (npm run demo) usa datos de ejemplo genéricos: dominio ejemplo.com, salas general, capitales y
// logistica, textos en inglés como los pings reales, menciones al entrar en general y capitales, y un ping nuevo al
// minuto de conectar. El historial de antes lo escribe test/demo/profile.mjs en el perfil de la demo.
// Bots de pings para el «Modo FC» (enviar pings): broadcast.<dominio> como el complemento Broadcast de Openfire y
// pingbot@<dominio> con «!ping <grupo>» en la primera línea. Usuarios, grupos y permisos en test/mock-bots.mjs
// (MOCK_BOTS=<json> los cambia y MOCK_BOTS=off los apaga).
import net from "node:net";
import zlib from "node:zlib";
import crypto from "node:crypto";
import Parser from "@xmpp/xml/lib/Parser.js";
import xml from "@xmpp/xml";
import { createBots, loadBotsConfig } from "./mock-bots.mjs";

const PORT = Number(process.env.MOCK_PORT) || 5299;
const DEMO = !!process.env.MOCK_DEMO;
const DOMAIN = DEMO ? "ejemplo.com" : "test.local";
const CONF = `conference.${DOMAIN}`;
const MEMBER = { affiliation: "member", role: "participant" };
const DEMO_ROOMS = {
  general: { name: "general", subject: "General chat · be nice · fleet pings go to the bot", occupants: ["alice", "bob", "carol", "dave"], changeSubject: "1", me: MEMBER },
  capitales: { name: "capitales", subject: "Capital pilots · check your fuel before every op", occupants: ["fc_bob", "erin", "frank"], changeSubject: "0", me: MEMBER },
  logistica: { name: "logistica", subject: "Hauling and contracts", occupants: ["erin", "carol"], changeSubject: "0", me: MEMBER },
};
const ROOMS = DEMO ? DEMO_ROOMS : {
  general: { name: "general", subject: "Bienvenidos a general — sala de pruebas", occupants: ["piloto_uno", "piloto_dos", "piloto_tres"], changeSubject: "1", me: MEMBER },
  operaciones: { name: "Operaciones", subject: "Sala de pruebas", occupants: ["comandante_x"], changeSubject: "0", me: MEMBER },
  entrenamiento: { name: "entrenamiento", subject: "", occupants: ["instructor_y"], changeSubject: "0", me: { affiliation: "owner", role: "moderator" } },
  anuncios: { name: "anuncios", subject: "Solo los moderadores cambian este tema", occupants: ["portavoz"], me: MEMBER, rejectSubject: true },
  secret: { name: "secret", subject: "", occupants: [], password: "pw", me: MEMBER },
};
// Ping nuevo de la demo: formup dentro de 45 minutos, con la hora EVE en el campo y en el pie.
function demoPing() {
  const pad = (n) => String(n).padStart(2, "0");
  const eve = (ts) => {
    const d = new Date(ts);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  };
  const now = Date.now();
  return ["Subcap fleet forming NOW, undock soon!", "FC Name: Bob FC", `Formup Time: ${eve(now + 45 * 60e3)}`, "Formup Location: Jita", "Doctrine: Ferox", "", `~~~ This was a coord broadcast from bob to all at ${eve(now)}:00.000000 EVE ~~~`].join(String.fromCharCode(10));
}
// Otros servicios del dominio, para el descubrimiento de servidores de salas: un segundo servidor de salas (chat.),
// una pasarela IRC (conference/irc, no cuenta como servidor de salas) y servicios que no son de salas.
const CHAT = `chat.${DOMAIN}`;
const SERVICES = {
  [CONF]: { category: "conference", type: "text", name: "Salas de test.local" },
  [CHAT]: { category: "conference", type: "text", name: "Salas de la alianza" },
  [`irc.${DOMAIN}`]: { category: "conference", type: "irc", name: "Pasarela IRC" },
  [`upload.${DOMAIN}`]: { category: "store", type: "file", name: "Subida de archivos" },
  [`pubsub.${DOMAIN}`]: { category: "pubsub", type: "service" },
};
const CHAT_ROOMS = {
  logistica: { name: "Logística", occupants: 12 },
  mineria: { name: "Minería", occupants: 4 },
  general: { name: "General de la alianza", occupants: 40 },
};
// Listas de afiliación de cada sala (las que guarda el servidor aunque no estén dentro): el primer ocupante es
// propietario, los demás miembros, y hay un vetado de ejemplo.
for (const r of Object.values(ROOMS)) {
  r.affs = { owner: [], admin: [], member: [], outcast: [`spammer@${DOMAIN}`] };
  r.occupants.forEach((o, i) => r.affs[i === 0 ? "owner" : "member"].push(`${o}@${DOMAIN}`));
}
const setAff = (r, jid, aff) => {
  for (const list of Object.values(r.affs)) list.splice(0, list.length, ...list.filter((j) => j !== jid));
  if (aff !== "none") r.affs[aff].push(jid);
};
const affOf = (r, jid) => Object.keys(r.affs).find((a) => r.affs[a].includes(jid)) || "none";
const STANZAS = "urn:ietf:params:xml:ns:xmpp-stanzas";
const MUC_USER = "http://jabber.org/protocol/muc#user";
// Formulario de configuración de sala (muc#owner), con un campo de cada tipo habitual.
const configForm = (r) =>
  xml(
    "x",
    { xmlns: "jabber:x:data", type: "form" },
    xml("title", {}, `Configuration for ${r.name}`),
    xml("instructions", {}, "Complete this form to change the room settings."),
    xml("field", { var: "FORM_TYPE", type: "hidden" }, xml("value", {}, "http://jabber.org/protocol/muc#roomconfig")),
    xml("field", { var: "muc#roomconfig_roomname", type: "text-single", label: "Room name" }, xml("value", {}, r.name)),
    xml("field", { var: "muc#roomconfig_roomdesc", type: "text-single", label: "Description" }, xml("value", {}, `Descripción de ${r.name}`)),
    xml("field", { type: "fixed" }, xml("value", {}, "Permissions")),
    xml("field", { var: "muc#roomconfig_changesubject", type: "boolean", label: "Allow occupants to change the subject" }, xml("value", {}, r.changeSubject === "1" ? "1" : "0")),
    xml("field", { var: "muc#roomconfig_persistentroom", type: "boolean", label: "Persistent room" }, xml("value", {}, "1")),
    xml(
      "field",
      { var: "muc#roomconfig_whois", type: "list-single", label: "Who may discover real JIDs" },
      xml("value", {}, "moderators"),
      xml("option", { label: "Moderators only" }, xml("value", {}, "moderators")),
      xml("option", { label: "Anyone" }, xml("value", {}, "anyone")),
    ),
    xml("field", { var: "muc#roomconfig_roomadmins", type: "jid-multi", label: "Room admins" }, xml("desc", {}, "One address per line")),
    xml("field", { var: "muc#roomconfig_roomsecret", type: "text-private", label: "Password" }),
  );
// Lo que se registra puede venir del cliente: se quitan los saltos de línea para que no pueda fingir líneas del registro.
const log = (...a) => console.log(`${new Date().toISOString().slice(11, 19)} ${a.map(String).join(" ")}`.replace(/\n|\r/g, ""));
const MAM = "urn:xmpp:mam:2";
const bots = createBots({ domain: DOMAIN, log, config: loadBotsConfig() });
// vCard y avatar XEP-0084 de cada usuario, en memoria mientras dure el servidor (para probar el avatar propio).
// Cuentas a las que el servidor ya ha retirado el acceso (usuario de prueba «revocable»).
const REVOKED = new Set();
const VCARDS = new Map();
const PEP = new Map();

// PNG de 64×64 hecho a mano (círculo de color sobre fondo de otro) para el avatar XEP-0084 de Alice.
function makePng(size, [r1, g1, b1], [r2, g2, b2]) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const inside = (x - size / 2) ** 2 + (y - size / 2) ** 2 < (size / 3) ** 2;
      raw.set(inside ? [r2, g2, b2] : [r1, g1, b1], y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const ALICE_AVATARS = [makePng(64, [233, 30, 99], [255, 235, 59]), makePng(64, [33, 150, 243], [255, 255, 255]), makePng(64, [76, 175, 80], [33, 33, 33])];
let aliceAvatar = 0; // índice en ALICE_AVATARS, o -1 sin avatar
const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");
const AVATAR_META = "urn:xmpp:avatar:metadata";
const aliceMetaEvent = (to) => {
  const png = ALICE_AVATARS[aliceAvatar];
  const meta = png ? xml("metadata", { xmlns: AVATAR_META }, xml("info", { id: sha1(png), type: "image/png", bytes: String(png.length), width: "64", height: "64" })) : xml("metadata", { xmlns: AVATAR_META });
  return xml("message", { from: `alice@${DOMAIN}`, to, type: "headline" }, xml("event", { xmlns: "http://jabber.org/protocol/pubsub#event" }, xml("items", { node: AVATAR_META }, xml("item", { id: png ? sha1(png) : "current" }, meta))));
};
const ARCHIVE = process.env.MOCK_MAM
  ? [{ id: "arch-1", from: `pingbot@${DOMAIN}/bot`, ts: Date.now() - 40 * 60e3, body: "Fleet up in 20 minutes\nFC Name: Bob FC\nFormup Location: Amarr\nDoctrine: Ferox\n\n~~~ This was a coord broadcast from bob to all ~~~" }]
  : [];

net
  .createServer((sock) => {
    let parser;
    let authed = false;
    let jid = null;
    let user = null;
    const joined = new Map();
    const send = (el) => {
      const s = typeof el === "string" ? el : el.toString();
      if (process.env.MOCK_VERBOSE) log("S>", s.slice(0, 300));
      sock.write(s);
    };
    const reset = () => {
      parser = new Parser();
      parser.on("start", () => {
        send(`<?xml version='1.0'?><stream:stream xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' from='${DOMAIN}' id='${Math.random().toString(36).slice(2)}' version='1.0' xml:lang='en'>`);
        if (!authed) send(`<stream:features><mechanisms xmlns='urn:ietf:params:xml:ns:xmpp-sasl'><mechanism>PLAIN</mechanism></mechanisms></stream:features>`);
        else send(`<stream:features><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'/></stream:features>`);
      });
      parser.on("element", onElement);
      parser.on("error", (e) => log("parse error", e.message));
      // El cliente cierra la sesión con </stream:stream>: se responde igual y se cierra, como un servidor real.
      parser.on("end", () => {
        send("</stream:stream>");
        sock.end();
      });
    };
    reset();
    sock.on("data", (d) => {
      if (process.env.MOCK_VERBOSE) log("C>", d.toString().slice(0, 300));
      // XML mal formado (p. ej. un cierre de flujo sin apertura): se corta ese cliente, no se cae el servidor.
      try {
        parser.write(d.toString());
      } catch (err) {
        log("XML no válido, se cierra la conexión:", err.message);
        sock.destroy();
      }
    });
    sock.on("error", () => {});
    sock.on("close", () => {
      bots.unregister(jid);
      log("desconectado", jid);
    });

    const result = (st, ...children) => send(xml("iq", { type: "result", id: st.attrs.id, to: st.attrs.from || jid, from: st.attrs.to || DOMAIN }, ...children));

    function onElement(st) {
      if (st.is("auth")) {
        const [, u, p] = Buffer.from(st.text(), "base64").toString().split("\0");
        // Usuarios de prueba para una posible revocación: el servidor rechaza la cuenta aunque la contraseña sea buena.
        // «revocable»: entra la primera vez, a los 1,5 s el servidor corta la conexión y desde entonces la rechaza
        // (acceso revocado mientras estaba conectada: lo que se encuentra la reconexión automática).
        if (u === "revocable" && !REVOKED.has(u)) {
          REVOKED.add(u);
          setTimeout(() => sock.destroy(), 1500);
        } else if (u === "revocable") {
          log("auth rechazada", u, "account-disabled");
          return send(`<failure xmlns='urn:ietf:params:xml:ns:xmpp-sasl'><account-disabled/></failure>`);
        }
        const revoked = { desactivado: "account-disabled", caducado: "credentials-expired" }[u];
        if (revoked) {
          log("auth rechazada", u, revoked);
          return send(`<failure xmlns='urn:ietf:params:xml:ns:xmpp-sasl'><${revoked}/></failure>`);
        }
        if (p !== "test") {
          log("auth rechazada", u, "not-authorized");
          return send(`<failure xmlns='urn:ietf:params:xml:ns:xmpp-sasl'><not-authorized/></failure>`);
        }
        user = u;
        authed = true;
        send(`<success xmlns='urn:ietf:params:xml:ns:xmpp-sasl'/>`);
        reset();
        return;
      }
      // Respuesta del cliente a nuestra consulta de capacidades: si pide +notify, se le manda el avatar de Alice.
      if (st.is("iq") && st.attrs.id === "caps-1") {
        const notify = st.getChild("query")?.getChildren("feature").some((f) => f.attrs.var === `${AVATAR_META}+notify`);
        log("disco#info del cliente:", st.getChild("query")?.attrs.node, notify ? "pide avatares XEP-0084" : "sin +notify");
        // Un servidor real solo cachea la respuesta si trae el mismo node#ver que preguntó.
        if (notify && st.getChild("query")?.attrs.node?.includes("#")) setTimeout(() => send(aliceMetaEvent(jid)), 100);
        return;
      }
      if (st.is("iq")) return onIq(st);
      if (st.is("presence")) return onPresence(st);
      if (st.is("message")) return onMessage(st);
    }

    function onIq(st) {
      const q = st.getChildElements()[0];
      const to = st.attrs.to || DOMAIN;
      if (q?.is("bind")) {
        jid = `${user}@${DOMAIN}/${q.getChildText("resource") || "mock"}`;
        log("login", jid);
        bots.register(jid, send);
        return result(st, xml("bind", { xmlns: "urn:ietf:params:xml:ns:xmpp-bind" }, xml("jid", {}, jid)));
      }
      const ns = q?.attrs.xmlns;
      if (bots.onIq(st, jid, send)) return;
      if (ns === "jabber:iq:roster" && st.attrs.type === "get")
        return result(
          st,
          xml(
            "query",
            { xmlns: ns },
            xml("item", { jid: `alice@${DOMAIN}`, name: "Alice", subscription: "both" }, xml("group", {}, "Amigos")),
            xml("item", { jid: `bob@${DOMAIN}`, name: "Bob FC", subscription: "both" }, xml("group", {}, "Flota")),
            xml("item", { jid: `pingbot@${DOMAIN}`, subscription: "from" }),
          ),
        );
      // Descubrimiento de servicios del dominio y del segundo servidor de salas.
      if (ns === "http://jabber.org/protocol/disco#items" && to === DOMAIN)
        return result(st, xml("query", { xmlns: ns }, [...Object.entries(SERVICES).map(([j, s]) => xml("item", { jid: j, name: s.name })), bots.discoItem()].filter(Boolean)));
      if (ns === "http://jabber.org/protocol/disco#info" && SERVICES[to])
        return result(st, xml("query", { xmlns: ns }, xml("identity", SERVICES[to]), SERVICES[to].category === "conference" ? xml("feature", { var: "http://jabber.org/protocol/muc" }) : null));
      if (ns === "http://jabber.org/protocol/disco#items" && to === CHAT)
        return result(st, xml("query", { xmlns: ns }, Object.entries(CHAT_ROOMS).map(([id, r]) => xml("item", { jid: `${id}@${CHAT}`, name: r.name }))));
      if (ns === "http://jabber.org/protocol/disco#info" && to.endsWith(`@${CHAT}`) && CHAT_ROOMS[to.split("@")[0]]) {
        const r = CHAT_ROOMS[to.split("@")[0]];
        return result(st, xml("query", { xmlns: ns }, xml("identity", { category: "conference", type: "text", name: r.name }), xml("feature", { var: "muc_public" }), xml("x", { xmlns: "jabber:x:data", type: "result" }, xml("field", { var: "muc#roominfo_occupants" }, xml("value", {}, String(r.occupants))))));
      }
      if (ns === "http://jabber.org/protocol/disco#items" && to === CONF)
        return result(st, xml("query", { xmlns: ns }, Object.entries(ROOMS).map(([id, r]) => xml("item", { jid: `${id}@${CONF}`, name: r.name }))));
      if (ns === "http://jabber.org/protocol/disco#info" && to.endsWith(`@${CONF}`)) {
        const r = ROOMS[to.split("@")[0]];
        if (!r) return send(xml("iq", { type: "error", id: st.attrs.id, to: jid, from: to }, xml("error", { type: "cancel" }, xml("item-not-found", "urn:ietf:params:xml:ns:xmpp-stanzas"))));
        return result(
          st,
          xml(
            "query",
            { xmlns: ns },
            xml("identity", { category: "conference", type: "text", name: r.name }),
            xml("feature", { var: "http://jabber.org/protocol/muc" }),
            xml("feature", { var: r.password ? "muc_passwordprotected" : "muc_unsecured" }),
            xml("feature", { var: "muc_persistent" }),
            xml(
              "x",
              { xmlns: "jabber:x:data", type: "result" },
              xml("field", { var: "muc#roominfo_description" }, xml("value", {}, `Descripción de ${r.name}`)),
              xml("field", { var: "muc#roominfo_occupants" }, xml("value", {}, String(r.occupants.length))),
              r.changeSubject ? xml("field", { var: "muc#roominfo_changesubject" }, xml("value", {}, r.changeSubject)) : null,
            ),
          ),
        );
      }
      // El archivo de mensajes se anuncia en la dirección del usuario, no en la del servidor (como Prosody o ejabberd).
      if (ns === "http://jabber.org/protocol/disco#info" && to === `${user}@${DOMAIN}`)
        return result(st, xml("query", { xmlns: ns }, xml("identity", { category: "account", type: "registered" }), process.env.MOCK_MAM ? xml("feature", { var: MAM }) : null));
      if (ns === "http://jabber.org/protocol/disco#info")
        return result(st, xml("query", { xmlns: ns }, xml("identity", { category: "server", type: "im" }), xml("feature", { var: "urn:xmpp:carbons:2" })));
      if (ns === MAM && st.attrs.type === "set" && process.env.MOCK_MAM) {
        const fields = Object.fromEntries(q.getChild("x")?.getChildren("field").map((f) => [f.attrs.var, f.getChildText("value")]) || []);
        const start = fields.start ? Date.parse(fields.start) : 0;
        const found = ARCHIVE.filter((m) => (!fields.with || m.from.startsWith(fields.with)) && m.ts >= start);
        log("archivo: with", String(fields.with).replace(/\n|\r/g, ""), "desde", String(fields.start).replace(/\n|\r/g, ""), "→", found.length);
        for (const m of found)
          send(
            xml(
              "message",
              { to: jid },
              xml("result", { xmlns: MAM, queryid: q.attrs.queryid, id: m.id }, xml("forwarded", { xmlns: "urn:xmpp:forward:0" }, xml("delay", { xmlns: "urn:xmpp:delay", stamp: new Date(m.ts).toISOString() }), xml("message", { from: m.from, to: jid, type: "chat" }, xml("body", {}, m.body)))),
            ),
          );
        return result(st, xml("fin", { xmlns: MAM, complete: "true" }, xml("set", { xmlns: "http://jabber.org/protocol/rsm" }, found.length ? xml("last", {}, found.at(-1).id) : null)));
      }
      const err = (cond) => send(xml("iq", { type: "error", id: st.attrs.id, to: jid, from: to }, xml("error", { type: cond === "service-unavailable" ? "cancel" : "auth" }, xml(cond, STANZAS))));
      const roomOf = ROOMS[to.split("@")[0]];
      if (ns === "http://jabber.org/protocol/muc#owner" && roomOf) {
        if (roomOf.me.affiliation !== "owner") return err("forbidden");
        if (st.attrs.type === "get") return result(st, xml("query", { xmlns: ns }, configForm(roomOf)));
        const values = Object.fromEntries(q.getChild("x")?.getChildren("field").map((x) => [x.attrs.var, x.getChildren("value").map((v) => v.text())]) || []);
        log("configuración de", to, JSON.stringify(values));
        if (values["muc#roomconfig_roomname"]) roomOf.name = values["muc#roomconfig_roomname"][0];
        if (values["muc#roomconfig_changesubject"]) roomOf.changeSubject = values["muc#roomconfig_changesubject"][0] === "1" ? "1" : "0";
        return result(st);
      }
      if (ns === "http://jabber.org/protocol/muc#admin" && roomOf && st.attrs.type === "get") {
        if (!["owner", "admin"].includes(roomOf.me.affiliation)) return err("forbidden");
        const aff = q.getChild("item")?.attrs.affiliation;
        return result(st, xml("query", { xmlns: ns }, ...(roomOf.affs[aff] || []).map((j) => xml("item", { affiliation: aff, jid: j }))));
      }
      if (ns === "http://jabber.org/protocol/muc#admin" && roomOf && st.attrs.type === "set") {
        if (roomOf.me.role !== "moderator") return err("forbidden");
        const item = q.getChild("item");
        log("admin", to, JSON.stringify(item.attrs));
        if (item.attrs.jid && item.attrs.affiliation) setAff(roomOf, item.attrs.jid.split("/")[0], item.attrs.affiliation);
        const roomJid = to.split("/")[0];
        const nick = item.attrs.nick || roomOf.occupants.find((o) => item.attrs.jid?.startsWith(`${o}@`));
        if (nick && item.attrs.role !== "none" && item.attrs.affiliation !== "outcast") {
          // Los administradores y propietarios son moderadores; si no, se mantiene el rol que se pide o el de participante.
          const aff = affOf(roomOf, `${nick}@${DOMAIN}`);
          const role = item.attrs.role || (["owner", "admin"].includes(aff) ? "moderator" : "participant");
          send(xml("presence", { from: `${roomJid}/${nick}`, to: jid }, xml("x", { xmlns: MUC_USER }, xml("item", { affiliation: aff, role, jid: `${nick}@${DOMAIN}/x` }))));
        }
        else if (nick) send(xml("presence", { from: `${roomJid}/${nick}`, to: jid, type: "unavailable" }, xml("x", { xmlns: MUC_USER }, xml("item", { affiliation: item.attrs.affiliation || "none", role: "none" }), xml("status", { code: item.attrs.affiliation === "outcast" ? "301" : "307" }))));
        return result(st);
      }
      if (q?.is("ping") && to.startsWith(`bob@${DOMAIN}`)) return err("service-unavailable");
      if (ns === "jabber:iq:private" && st.attrs.type === "set") {
        log("marcadores guardados:", q.getChild("storage").getChildren("conference").map((x) => `${x.attrs.jid.split("@")[0]}${x.attrs.autojoin === "true" ? "⚡" : ""}`).join(", "));
        return result(st);
      }
      if (ns === "jabber:iq:private")
        return result(
          st,
          xml("query", { xmlns: ns }, xml("storage", { xmlns: "storage:bookmarks" }, xml("conference", { jid: `entrenamiento@${CONF}`, name: "entrenamiento", autojoin: "true" }, xml("nick", {}, user)))),
        );
      if (q?.is("vCard")) {
        const owner = st.attrs.to ? st.attrs.to.split("/")[0] : `${user}@${DOMAIN}`;
        if (st.attrs.type === "set") {
          VCARDS.set(owner, q);
          const photo = q.getChild("PHOTO");
          log("vCard guardada de", owner, photo ? `con foto ${photo.getChildText("TYPE")} ${Buffer.from(photo.getChildText("BINVAL") || "", "base64").length} bytes` : "sin foto");
          return result(st);
        }
        return result(st, VCARDS.get(owner) || xml("vCard", { xmlns: "vcard-temp" }));
      }
      if (ns === "http://jabber.org/protocol/pubsub" && st.attrs.type === "get" && to === `alice@${DOMAIN}`) {
        const id = q.getChild("items")?.getChild("item")?.attrs.id;
        const png = ALICE_AVATARS.find((b) => sha1(b) === id);
        log("PEP datos de alice pedidos", png ? `${png.length} bytes` : "(no existe)");
        if (!png) return send(xml("iq", { type: "error", id: st.attrs.id, to: jid, from: to }, xml("error", { type: "cancel" }, xml("item-not-found", STANZAS))));
        return result(st, xml("pubsub", { xmlns: ns }, xml("items", { node: "urn:xmpp:avatar:data" }, xml("item", { id }, xml("data", { xmlns: "urn:xmpp:avatar:data" }, png.toString("base64"))))));
      }
      if (ns === "http://jabber.org/protocol/pubsub" && st.attrs.type === "set") {
        const pub = q.getChild("publish");
        const item = pub?.getChild("item");
        PEP.set(`${user}@${DOMAIN} ${pub?.attrs.node}`, item);
        const info = item?.getChild("metadata")?.getChild("info");
        log("PEP", pub?.attrs.node, info ? `info ${info.attrs.type} ${info.attrs.width}×${info.attrs.height} ${info.attrs.bytes} bytes` : item?.getChild("data") ? `datos ${Buffer.from(item.getChildText("data") || "", "base64").length} bytes` : "vacío (sin avatar)");
        return result(st);
      }
      return result(st);
    }

    function onPresence(st) {
      const to = st.attrs.to;
      if (!to) {
        // Presencia inicial: los contactos aparecen conectados
        send(xml("presence", { from: `alice@${DOMAIN}/phone`, to: jid }, xml("show", {}, "away"), xml("status", {}, DEMO ? "At work" : "En el trabajo")));
        // Como un servidor real: con +notify en las capacidades, manda el último avatar XEP-0084 de cada contacto.
        const caps = st.getChild("c", "http://jabber.org/protocol/caps");
        if (caps && !sock.pepSent) {
          sock.pepSent = true;
          send(xml("iq", { type: "get", id: "caps-1", to: jid, from: DOMAIN }, xml("query", { xmlns: "http://jabber.org/protocol/disco#info", node: `${caps.attrs.node}#${caps.attrs.ver}` })));
        }
        send(xml("presence", { from: `bob@${DOMAIN}/pc`, to: jid }, xml("status", {}, "FCing")));
        if (!sock.pinged) {
          sock.pinged = true;
          setTimeout(
            () =>
              send(
                xml(
                  "message",
                  { from: `pingbot@${DOMAIN}/bot`, to: jid, type: "chat" },
                  xml("body", {}, DEMO ? demoPing() : "Capital fleet up now!!\nFC Name:\u200b\u200c Bob FC\nFormup Location: Jita\nPAP Type: Strategic\nComms: Op 1 https://example.com/comms\nDoctrine: Typhoons\n\n~~~ This was a coord broadcast from bob to all at 2026-11-02 12:00:00.000000 EVE ~~~"),
                ),
              ),
            DEMO ? 60e3 : 2500,
          );
        }
        return;
      }
      const [roomId, rest] = to.split("@");
      const nick = to.split("/")[1];
      const room = ROOMS[roomId];
      if (!room || !rest?.startsWith(CONF)) return;
      const roomJid = `${roomId}@${CONF}`;
      if (st.attrs.type === "unavailable") {
        joined.delete(roomJid);
        return send(xml("presence", { from: `${roomJid}/${nick}`, to: jid, type: "unavailable" }, xml("x", { xmlns: "http://jabber.org/protocol/muc#user" }, xml("item", { affiliation: "none", role: "none" }), xml("status", { code: "110" }))));
      }
      if (joined.has(roomJid)) {
        // cambio de estado o de apodo
        const old = joined.get(roomJid);
        if (old !== nick) {
          send(xml("presence", { from: `${roomJid}/${old}`, to: jid, type: "unavailable" }, xml("x", { xmlns: "http://jabber.org/protocol/muc#user" }, xml("item", { affiliation: "member", role: "participant", nick }), xml("status", { code: "303" }), xml("status", { code: "110" }))));
          joined.set(roomJid, nick);
        }
        return send(xml("presence", { from: `${roomJid}/${nick}`, to: jid }, xml("x", { xmlns: "http://jabber.org/protocol/muc#user" }, xml("item", room.me), xml("status", { code: "110" }))));
      }
      if (room.password && st.getChild("x")?.getChildText("password") !== room.password) {
        return send(xml("presence", { from: `${roomJid}/${nick}`, to: jid, type: "error" }, xml("error", { type: "auth" }, xml("not-authorized", "urn:ietf:params:xml:ns:xmpp-stanzas"))));
      }
      if (room.occupants.includes(nick)) {
        return send(xml("presence", { from: `${roomJid}/${nick}`, to: jid, type: "error" }, xml("error", { type: "cancel" }, xml("conflict", "urn:ietf:params:xml:ns:xmpp-stanzas"))));
      }
      joined.set(roomJid, nick);
      log("join", roomJid, nick);
      room.occupants.forEach((o, i) =>
        send(xml("presence", { from: `${roomJid}/${o}`, to: jid }, i === 2 ? xml("show", {}, "away") : null, xml("x", { xmlns: "http://jabber.org/protocol/muc#user" }, xml("item", { affiliation: i === 0 ? "owner" : "member", role: i === 0 ? "moderator" : "participant", jid: `${o}@${DOMAIN}/x` })))),
      );
      send(xml("presence", { from: `${roomJid}/${nick}`, to: jid }, xml("x", { xmlns: "http://jabber.org/protocol/muc#user" }, xml("item", room.me), xml("status", { code: "110" }))));
      const since = st.getChild("x")?.getChild("history")?.attrs.since;
      const histTs = Date.now() - 3600e3;
      if (!DEMO && (!since || Date.parse(since) < histTs))
        send(xml("message", { from: `${roomJid}/${room.occupants[0] || "ghost"}`, to: jid, type: "groupchat" }, xml("body", {}, `Mensaje de historial en ${room.name} :) con https://example.com/foto.png`), xml("delay", { xmlns: "urn:xmpp:delay", stamp: new Date(histTs).toISOString() })));
      send(xml("message", { from: roomJid, to: jid, type: "groupchat" }, xml("subject", {}, room.subject)));
      // Demo: menciones sin ver en dos salas al entrar.
      if (DEMO && roomId === "general") setTimeout(() => send(xml("message", { from: `${roomJid}/alice`, to: jid, type: "groupchat", id: "d1" }, xml("body", {}, `hey ${nick}, welcome back o7`))), 1500);
      if (DEMO && roomId === "capitales") setTimeout(() => send(xml("message", { from: `${roomJid}/fc_bob`, to: jid, type: "groupchat", id: "d2" }, xml("body", {}, `${nick} can you bring your dread to the next op?`))), 2500);
      if (!DEMO && roomId === "general") {
        setTimeout(() => send(xml("message", { from: `${roomJid}/piloto_dos`, to: jid, type: "groupchat", id: "m1" }, xml("body", {}, `hola ${nick}, *bienvenido* a la sala 🚀 :thumbsup:`))), 1200);
        setTimeout(() => send(xml("presence", { from: `${roomJid}/novato`, to: jid }, xml("x", { xmlns: "http://jabber.org/protocol/muc#user" }, xml("item", { affiliation: "none", role: "visitor" })))), 1600);
      }
    }

    function onMessage(st) {
      if (bots.onMessage(st, jid, send)) return;
      const to = st.attrs.to || "";
      const body = st.getChildText("body");
      const roomJid = to.split("/")[0];
      if (st.attrs.type === "groupchat" && joined.has(roomJid)) {
        if (!body && !st.getChild("subject")) return;
        const room = ROOMS[roomJid.split("@")[0]];
        const subject = st.getChild("subject");
        if (subject && !body) {
          const allowed = room.me.role === "moderator" || (room.me.role === "participant" && room.changeSubject === "1" && !room.rejectSubject);
          log("tema", roomJid, allowed ? "aceptado" : "rechazado");
          if (!allowed) return send(xml("message", { from: roomJid, to: jid, type: "error", id: st.attrs.id }, subject, xml("error", { type: "auth" }, xml("forbidden", STANZAS))));
          room.subject = subject.text();
        }
        const out = xml("message", { from: `${roomJid}/${joined.get(roomJid)}`, to: jid, type: "groupchat", id: st.attrs.id }, ...st.getChildElements().filter((c) => ["body", "subject", "replace"].includes(c.name)));
        send(out);
        // Cambiar nuestros propios permisos para probar los avisos y la etiqueta «editar».
        if (body === "!ascender" || body === "!degradar") {
          room.me = body === "!ascender" ? { affiliation: "admin", role: "moderator" } : { ...MEMBER };
          log("permisos propios en", roomJid, JSON.stringify(room.me));
          setTimeout(() => send(xml("presence", { from: `${roomJid}/${joined.get(roomJid)}`, to: jid }, xml("x", { xmlns: MUC_USER }, xml("item", room.me), xml("status", { code: "110" })))), 500);
        }
        return;
      }
      if (to.startsWith(`alice@${DOMAIN}`) && st.getChild("attention", "urn:xmpp:attention:0")) {
        log("buzz a alice");
        setTimeout(() => send(xml("message", { from: `alice@${DOMAIN}/phone`, to: jid, type: "headline" }, xml("attention", "urn:xmpp:attention:0"))), 1000);
        return;
      }
      if (to.startsWith(`alice@${DOMAIN}`) && (body === "!avatar" || body === "!sinavatar")) {
        aliceAvatar = body === "!avatar" ? (Math.max(aliceAvatar, 0) + 1) % ALICE_AVATARS.length : -1;
        log("alice cambia su avatar XEP-0084:", aliceAvatar < 0 ? "sin avatar" : `nº ${aliceAvatar}`);
        setTimeout(() => send(aliceMetaEvent(jid)), 300);
      }
      if (to.startsWith(`alice@${DOMAIN}`) && body) {
        const req = st.getChild("request", "urn:xmpp:receipts");
        if (req) send(xml("message", { from: `alice@${DOMAIN}/phone`, to: jid }, xml("received", { xmlns: "urn:xmpp:receipts", id: st.attrs.id })));
        send(xml("message", { from: `alice@${DOMAIN}/phone`, to: jid, type: "chat" }, xml("composing", "http://jabber.org/protocol/chatstates")));
        setTimeout(() => send(xml("message", { from: `alice@${DOMAIN}/phone`, to: jid, type: "chat", id: `r${Date.now()}` }, xml("body", {}, `eco: ${body}`), xml("active", "http://jabber.org/protocol/chatstates"))), 900);
      }
    }
  })
  .listen(PORT, "127.0.0.1", () => log(`mock XMPP en 127.0.0.1:${PORT}`));
