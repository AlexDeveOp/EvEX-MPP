// Prueba de integración: XmppAccount contra el servidor XMPP simulado (test/mock-xmpp.mjs), sin red externa.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { xml } from "@xmpp/client";
import { XmppAccount } from "../../src/main/xmpp-account.js";
import { tempDir } from "./helpers.mjs";

const PORT = 15299 + Math.floor(Math.random() * 500);
let mock;

before(async () => {
  mock = spawn(process.execPath, [fileURLToPath(new URL("../mock-xmpp.mjs", import.meta.url))], { env: { ...process.env, MOCK_PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    mock.once("exit", (code) => reject(new Error(`el servidor simulado terminó (${code})`)));
    mock.stdout.on("data", (d) => String(d).includes("mock XMPP en") && resolve());
  });
});

after(() => mock?.kill());

function account(t, extra = {}) {
  const acc = new XmppAccount({ id: "t1", jid: "usuario@test.local", host: "127.0.0.1", port: PORT, security: "opportunistic", ...extra }, { avatarDir: tempDir(t), version: "9.8.7" });
  const events = [];
  acc.on("event", (e) => events.push(e));
  t.after(() => acc.disconnect(true).catch(() => {}));
  // Espera al primer evento que cumpla la condición (los ya recibidos también cuentan).
  const waitFor = (pred, ms = 8000) =>
    new Promise((resolve, reject) => {
      const found = events.find(pred);
      if (found) return resolve(found);
      const timer = setTimeout(() => reject(new Error(`sin evento esperado; recibidos: ${events.map((e) => e.type).join(", ")}`)), ms);
      const onEvent = (e) => {
        if (!pred(e)) return;
        clearTimeout(timer);
        acc.off("event", onEvent);
        resolve(e);
      };
      acc.on("event", onEvent);
    });
  return { acc, events, waitFor };
}

test("conecta, recibe el roster y el ping del bot", async (t) => {
  const { acc, waitFor } = account(t);
  await acc.connect("test");
  await waitFor((e) => e.type === "status" && e.state === "online");
  const roster = await waitFor((e) => e.type === "roster");
  assert.deepEqual(roster.items.map((i) => i.jid).sort(), ["alice@test.local", "bob@test.local", "pingbot@test.local"]);
  const ping = await waitFor((e) => e.type === "message" && e.conv === "pingbot@test.local");
  assert.match(ping.body, /Formup Location: Jita/);
});

test("una contraseña incorrecta deja la cuenta en error sin reintentar", async (t) => {
  const { acc, waitFor } = account(t);
  await assert.rejects(acc.connect("mala"));
  const st = await waitFor((e) => e.type === "status" && e.state === "error");
  assert.ok(st.error);
  assert.equal(acc.wantOnline, false);
});

test("exige TLS salvo que la cuenta permita conexiones sin cifrar", async (t) => {
  const { acc } = account(t, { security: "starttls" });
  await assert.rejects(acc.connect("test"), /TLS/);
});

test("entra en una sala, recibe ocupantes e historial y envía mensajes", async (t) => {
  const { acc, waitFor } = account(t);
  await acc.connect("test");
  await waitFor((e) => e.type === "status" && e.state === "online");
  await acc.joinRoom("general@conference.test.local", "probador");
  const joined = await waitFor((e) => e.type === "room-joined");
  assert.equal(joined.nick, "probador");
  assert.ok(joined.occupants.some((o) => o.nick === "piloto_uno"));
  const hist = await waitFor((e) => e.type === "message" && e.conv === "general@conference.test.local" && e.delayed);
  assert.match(hist.body, /historial/);
  await acc.sendMessage({ to: "general@conference.test.local", body: "hola sala", type: "groupchat" });
  const echo = await waitFor((e) => e.type === "message" && e.body === "hola sala");
  assert.equal(echo.nick, "probador");
});

// Regresión: entrar en una sala nada más conectar (como la autounión) hacía que onOnline volviera a entrar,
// lo que vaciaba la lista de ocupantes y dejaba la sala mostrando solo al propio usuario.
test("entrar en una sala al conectar no la vuelve a unir ni pierde los ocupantes", async (t) => {
  const { acc, waitFor } = account(t);
  const sent = [];
  acc.on("event", (e) => {
    if (e.type === "status" && e.state === "online") acc.joinRoom("general@conference.test.local", "probador");
  });
  const origSend = acc.send.bind(acc);
  acc.send = (st) => {
    // Solo cuentan las entradas en la sala (llevan <x xmlns=".../muc">), no las actualizaciones de estado.
    if (st.name === "presence" && st.attrs.to?.startsWith("general@") && st.getChild("x", "http://jabber.org/protocol/muc")) sent.push(st.attrs.to);
    return origSend(st);
  };
  await acc.connect("test");
  await waitFor((e) => e.type === "room-joined");
  // Margen para que onOnline termine (roster, presencia y reentrada en salas).
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(sent.length, 1, `entradas enviadas a la sala: ${sent.join(", ")}`);
  const nicks = [...acc.rooms.get("general@conference.test.local").occupants.keys()].sort();
  assert.deepEqual(nicks, ["piloto_dos", "piloto_tres", "piloto_uno", "probador"]);
});

test("responde a la consulta de versión (XEP-0092) con la versión de la app", async (t) => {
  const { acc, waitFor } = account(t);
  await acc.connect("test");
  await waitFor((e) => e.type === "status" && e.state === "online");
  const replies = [];
  const origSend = acc.xmpp.send.bind(acc.xmpp);
  acc.xmpp.send = (el) => {
    if (el.attrs?.id === "v1") replies.push(el);
    return origSend(el);
  };
  // Simula que otro cliente pregunta la versión.
  acc.xmpp.emit("element", xml("iq", { type: "get", id: "v1", from: "alice@test.local/phone", to: acc.ownJid }, xml("query", { xmlns: "jabber:iq:version" })));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(replies.length, 1);
  const q = replies[0].getChild("query", "jabber:iq:version");
  assert.equal(q?.getChildText("name"), "EvEX-MPP");
  assert.equal(q?.getChildText("version"), "9.8.7");
});

test("un GIF se envía con la URL en el cuerpo y como adjunto XEP-0066", async (t) => {
  const { acc, waitFor } = account(t);
  await acc.connect("test");
  await waitFor((e) => e.type === "status" && e.state === "online");
  const sent = [];
  const origSend = acc.send.bind(acc);
  acc.send = (st) => (st.name === "message" && sent.push(st), origSend(st));
  const url = "https://ejemplo.com/o7.gif";
  await acc.sendMessage({ to: "alice@test.local", body: url, oob: url, type: "chat" });
  await acc.sendMessage({ to: "alice@test.local", body: "javascript:alert(1)", oob: "javascript:alert(1)", type: "chat" });
  assert.equal(sent[0].getChildText("body"), url);
  assert.equal(sent[0].getChild("x", "jabber:x:oob")?.getChildText("url"), url);
  assert.equal(sent[1].getChild("x", "jabber:x:oob"), undefined, "solo se adjuntan URL http(s)");
});

test("una sala con contraseña rechaza la entrada sin ella", async (t) => {
  const { acc, waitFor } = account(t);
  await acc.connect("test");
  await waitFor((e) => e.type === "status" && e.state === "online");
  await acc.joinRoom("secret@conference.test.local", "probador").catch(() => {});
  const err = await waitFor((e) => e.type === "room-error");
  assert.equal(err.condition, "not-authorized");
});
