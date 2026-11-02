// Servidor XMPP simulado y mínimo para probar EvEX-MPP sin una cuenta real (sin TLS, contraseña "test").
// Uso: node test/mock-xmpp.mjs  → cuenta usuario@test.local, servidor 127.0.0.1:5299 (o MOCK_PORT), seguridad «TLS si está disponible».
// Ofrece roster, salas MUC (general, operaciones, entrenamiento y "secret" con contraseña "pw"), historial, marcadores
// y un ping de pingbot@test.local en cada conexión (añade «pingbot» a los remitentes de pings).
import net from "node:net";
import Parser from "@xmpp/xml/lib/Parser.js";
import xml from "@xmpp/xml";

const PORT = Number(process.env.MOCK_PORT) || 5299;
const DOMAIN = "test.local";
const CONF = `conference.${DOMAIN}`;
const ROOMS = {
  general: { name: "general", subject: "Bienvenidos a general — sala de pruebas", occupants: ["piloto_uno", "piloto_dos", "piloto_tres"] },
  operaciones: { name: "Operaciones", subject: "Sala de pruebas", occupants: ["comandante_x"] },
  entrenamiento: { name: "entrenamiento", subject: "", occupants: ["instructor_y"] },
  secret: { name: "secret", subject: "", occupants: [], password: "pw" },
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

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
      parser.write(d.toString());
    });
    sock.on("error", () => {});
    sock.on("close", () => log("desconectado", jid));

    const result = (st, ...children) => send(xml("iq", { type: "result", id: st.attrs.id, to: st.attrs.from || jid, from: st.attrs.to || DOMAIN }, ...children));

    function onElement(st) {
      if (st.is("auth")) {
        const [, u, p] = Buffer.from(st.text(), "base64").toString().split("\0");
        if (p !== "test") return send(`<failure xmlns='urn:ietf:params:xml:ns:xmpp-sasl'><not-authorized/></failure>`);
        user = u;
        authed = true;
        send(`<success xmlns='urn:ietf:params:xml:ns:xmpp-sasl'/>`);
        reset();
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
        return result(st, xml("bind", { xmlns: "urn:ietf:params:xml:ns:xmpp-bind" }, xml("jid", {}, jid)));
      }
      const ns = q?.attrs.xmlns;
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
            ),
          ),
        );
      }
      if (ns === "http://jabber.org/protocol/disco#info")
        return result(st, xml("query", { xmlns: ns }, xml("identity", { category: "server", type: "im" }), xml("feature", { var: "urn:xmpp:carbons:2" })));
      if (ns === "jabber:iq:private" && st.attrs.type === "set") {
        log("marcadores guardados:", q.getChild("storage").getChildren("conference").map((x) => `${x.attrs.jid.split("@")[0]}${x.attrs.autojoin === "true" ? "⚡" : ""}`).join(", "));
        return result(st);
      }
      if (ns === "jabber:iq:private")
        return result(
          st,
          xml("query", { xmlns: ns }, xml("storage", { xmlns: "storage:bookmarks" }, xml("conference", { jid: `entrenamiento@${CONF}`, name: "entrenamiento", autojoin: "true" }, xml("nick", {}, user)))),
        );
      if (q?.is("vCard")) return result(st, xml("vCard", { xmlns: "vcard-temp" }));
      return result(st);
    }

    function onPresence(st) {
      const to = st.attrs.to;
      if (!to) {
        // Presencia inicial: los contactos aparecen conectados
        send(xml("presence", { from: `alice@${DOMAIN}/phone`, to: jid }, xml("show", {}, "away"), xml("status", {}, "En el trabajo")));
        send(xml("presence", { from: `bob@${DOMAIN}/pc`, to: jid }, xml("status", {}, "FCing")));
        if (!sock.pinged) {
          sock.pinged = true;
          setTimeout(
            () =>
              send(
                xml(
                  "message",
                  { from: `pingbot@${DOMAIN}/bot`, to: jid, type: "chat" },
                  xml("body", {}, "Capital fleet up now!!\nFC Name:\u200b\u200c Bob FC\nFormup Location: Jita\nPAP Type: Strategic\nComms: Op 1 https://example.com/comms\nDoctrine: Typhoons\n\n~~~ This was a coord broadcast from bob to all at 2026-11-02 12:00:00.000000 EVE ~~~"),
                ),
              ),
            2500,
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
        return send(xml("presence", { from: `${roomJid}/${nick}`, to: jid }, xml("x", { xmlns: "http://jabber.org/protocol/muc#user" }, xml("item", { affiliation: "member", role: "participant" }), xml("status", { code: "110" }))));
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
      send(xml("presence", { from: `${roomJid}/${nick}`, to: jid }, xml("x", { xmlns: "http://jabber.org/protocol/muc#user" }, xml("item", { affiliation: "member", role: "participant" }), xml("status", { code: "110" }))));
      const since = st.getChild("x")?.getChild("history")?.attrs.since;
      const histTs = Date.now() - 3600e3;
      if (!since || Date.parse(since) < histTs)
        send(xml("message", { from: `${roomJid}/${room.occupants[0] || "ghost"}`, to: jid, type: "groupchat" }, xml("body", {}, `Mensaje de historial en ${room.name} :) con https://example.com/foto.png`), xml("delay", { xmlns: "urn:xmpp:delay", stamp: new Date(histTs).toISOString() })));
      send(xml("message", { from: roomJid, to: jid, type: "groupchat" }, xml("subject", {}, room.subject)));
      if (roomId === "general") {
        setTimeout(() => send(xml("message", { from: `${roomJid}/piloto_dos`, to: jid, type: "groupchat", id: "m1" }, xml("body", {}, `hola ${nick}, *bienvenido* a la sala 🚀 :thumbsup:`))), 1200);
        setTimeout(() => send(xml("presence", { from: `${roomJid}/novato`, to: jid }, xml("x", { xmlns: "http://jabber.org/protocol/muc#user" }, xml("item", { affiliation: "none", role: "visitor" })))), 1600);
      }
    }

    function onMessage(st) {
      const to = st.attrs.to || "";
      const body = st.getChildText("body");
      const roomJid = to.split("/")[0];
      if (st.attrs.type === "groupchat" && joined.has(roomJid)) {
        if (!body && !st.getChild("subject")) return;
        const out = xml("message", { from: `${roomJid}/${joined.get(roomJid)}`, to: jid, type: "groupchat", id: st.attrs.id }, ...st.getChildElements().filter((c) => ["body", "subject", "replace"].includes(c.name)));
        return send(out);
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
