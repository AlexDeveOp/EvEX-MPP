// Bots de pings del servidor simulado (test/mock-bots.mjs) para el Modo FC: modo «address» (como el complemento
// Broadcast de Openfire) y modo «line» (pingbot con «!ping <grupo>»). Con @xmpp/client, sin el código de la app.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { client, xml } from "@xmpp/client";
import { eveStamp, createBots, DEFAULT_BOTS } from "../mock-bots.mjs";

const PORT = 19350 + Math.floor(Math.random() * 400);
const D = "test.local";
const SVC = `broadcast.${D}`;
const BOT = `pingbot@${D}`;
let mock;

before(async () => {
  mock = spawn(process.execPath, [fileURLToPath(new URL("../mock-xmpp.mjs", import.meta.url))], { env: { ...process.env, MOCK_PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    mock.once("exit", (code) => reject(new Error(`el servidor simulado terminó (${code})`)));
    mock.stdout.on("data", (d) => String(d).includes("mock XMPP en") && resolve());
  });
});
after(() => mock?.kill());

// Cliente conectado que guarda los mensajes que le llegan (sin el ping de bienvenida del pingbot: no manda presencia).
async function user(t, name) {
  // El simulado solo ofrece PLAIN sin TLS (como en la app con «TLS si está disponible»).
  const c = client({ service: `xmpp://127.0.0.1:${PORT}`, domain: D, resource: "t", credentials: (auth) => auth({ username: name, password: "test" }, "PLAIN") });
  c.on("error", () => {});
  c.inbox = [];
  c.on("stanza", (s) => s.is("message") && c.inbox.push(s));
  await c.start();
  t.after(() => c.stop().catch(() => {}));
  return c;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bodies = (c) => c.inbox.filter((m) => m.getChildText("body")).map((m) => m.getChildText("body"));
async function until(fn, ms = 3000) {
  for (let i = 0; i < ms / 50; i++) {
    if (fn()) return true;
    await wait(50);
  }
  return false;
}

// ---- modo «address» ----

test("address: un miembro envía a su grupo; llega a los miembros tal cual, con from del remitente, y al remitente no le vuelve confirmación", async (t) => {
  const [u, bob, p1, ana] = [await user(t, "usuario"), await user(t, "fc_bob"), await user(t, "piloto1"), await user(t, "fc_ana")];
  const text = "Caps fleet up\u200b\nFormup: home";
  await u.send(xml("message", { to: `caps@${SVC}`, type: "chat", id: "s1" }, xml("body", {}, text)));
  assert.ok(await until(() => bodies(bob).length));
  const got = bob.inbox.at(-1);
  assert.equal(got.attrs.from, `usuario@${D}/t`, "from = el remitente, como Openfire");
  assert.equal(got.attrs.type, "chat", "conserva el tipo");
  assert.equal(got.getChildText("body"), text, "sin pie y con sus invisibles");
  await wait(400);
  assert.deepEqual(bodies(p1), [], "no es miembro");
  assert.deepEqual(bodies(ana), [], "no es miembro de caps");
  // usuario es miembro: recibe su copia, pero ningún mensaje de confirmación ni error.
  assert.deepEqual(bodies(u), [text]);
  assert.equal(u.inbox.filter((m) => m.attrs.type === "error").length, 0);
});

test("address: sin permiso, error not-allowed con el mismo id y el texto de Openfire", async (t) => {
  const u = await user(t, "usuario");
  await u.send(xml("message", { to: `supers@${SVC}`, type: "chat", id: "s2" }, xml("body", {}, "hola")));
  assert.ok(await until(() => u.inbox.some((m) => m.attrs.type === "error")));
  const e = u.inbox.find((m) => m.attrs.type === "error");
  assert.equal(e.attrs.id, "s2");
  assert.equal(e.attrs.from, `supers@${SVC}`);
  assert.equal(e.getChildText("subject"), "Error sending broadcast message");
  assert.equal(e.getChildText("body"), `Not allowed to send a broadcast message to supers@${SVC}`);
  assert.equal(e.getChild("error").attrs.type, "cancel");
  assert.ok(e.getChild("error").getChild("not-allowed", "urn:ietf:params:xml:ns:xmpp-stanzas"));
});

test("address: grupo que no existe y «all» sin estar en allowedUsers", async (t) => {
  const u = await user(t, "usuario");
  await u.send(xml("message", { to: `nadie@${SVC}`, id: "s3" }, xml("body", {}, "x")));
  await u.send(xml("message", { to: `all@${SVC}`, id: "s4" }, xml("body", {}, "x")));
  assert.ok(await until(() => u.inbox.filter((m) => m.attrs.type === "error").length === 2));
  const byId = Object.fromEntries(u.inbox.filter((m) => m.attrs.type === "error").map((m) => [m.attrs.id, m.getChildText("body")]));
  assert.equal(byId.s3, `Address not valid: nadie@${SVC}`);
  assert.equal(byId.s4, `Not allowed to send a broadcast message to all@${SVC}`);
});

test("address: allowedUsers envía a all (llega a todos los conectados, también a él) y a un grupo del que no es miembro", async (t) => {
  const [bob, u, p1, ana] = [await user(t, "fc_bob"), await user(t, "usuario"), await user(t, "piloto1"), await user(t, "fc_ana")];
  await bob.send(xml("message", { to: `all@${SVC}`, type: "chat" }, xml("body", {}, "a todos")));
  assert.ok(await until(() => [bob, u, p1, ana].every((c) => bodies(c).includes("a todos"))));
  await bob.send(xml("message", { to: `supers@${SVC}`, type: "chat" }, xml("body", {}, "a supers")));
  assert.ok(await until(() => bodies(ana).includes("a supers")));
  await wait(300);
  assert.ok(!bodies(bob).includes("a supers"), "no es miembro de supers: no recibe copia");
  assert.equal(bob.inbox.filter((m) => m.attrs.type === "error").length, 0);
});

test("address: «silent» (su único miembro no está conectado) se acepta y no vuelve nada, como en Openfire", async (t) => {
  const bob = await user(t, "fc_bob");
  await bob.send(xml("message", { to: `silent@${SVC}`, type: "chat", id: "s5" }, xml("body", {}, "¿hay alguien?")));
  await wait(1200);
  assert.deepEqual(bob.inbox, []);
  // Quien no es miembro ni está en allowedUsers sí recibe el error.
  const u = await user(t, "usuario");
  await u.send(xml("message", { to: `silent@${SVC}`, type: "chat", id: "s6" }, xml("body", {}, "x")));
  assert.ok(await until(() => u.inbox.some((m) => m.attrs.type === "error" && m.attrs.id === "s6")));
});

test("address: disco del servicio como Openfire", async (t) => {
  const u = await user(t, "usuario");
  const bob = await user(t, "fc_bob");
  const info = await u.iqCaller.request(xml("iq", { type: "get", to: SVC }, xml("query", { xmlns: "http://jabber.org/protocol/disco#info" })));
  assert.equal(info.getChild("query").getChild("identity").attrs.name, "Broadcast service");
  const items = async (c) => (await c.iqCaller.request(xml("iq", { type: "get", to: SVC }, xml("query", { xmlns: "http://jabber.org/protocol/disco#items" })))).getChild("query").getChildren("item").map((i) => i.attrs.jid);
  assert.deepEqual((await items(u)).sort(), [`caps@${SVC}`].sort(), "usuario solo puede caps (es miembro; no está en allowedUsers)");
  assert.deepEqual((await items(bob)).sort(), [`all@${SVC}`, `caps@${SVC}`, `silent@${SVC}`, `supers@${SVC}`].sort());
  await assert.rejects(u.iqCaller.request(xml("iq", { type: "get", to: `supers@${SVC}` }, xml("query", { xmlns: "http://jabber.org/protocol/disco#info" }))), (e) => e.condition === "item-not-found");
  // El dominio anuncia el servicio, como hace Openfire con sus componentes.
  const domainItems = (await u.iqCaller.request(xml("iq", { type: "get", to: D }, xml("query", { xmlns: "http://jabber.org/protocol/disco#items" })))).getChild("query").getChildren("item").map((i) => i.attrs.jid);
  assert.ok(domainItems.includes(SVC));
});

// ---- modo «line» ----

const ping = (group, text) => `!ping ${group}\n${text}`;

test("line: aceptado; los miembros reciben el ping de pingbot con el pie y el remitente «Broadcast sent to N users»", async (t) => {
  const [bob, u, p1, ana] = [await user(t, "fc_bob"), await user(t, "usuario"), await user(t, "piloto1"), await user(t, "fc_ana")];
  const text = "Caps fleet forming\u200b\u200c\nFC Name: Bob FC\nFormup Location: home";
  await bob.send(xml("message", { to: BOT, type: "chat", id: "l1" }, xml("body", {}, ping("caps", text))));
  assert.ok(await until(() => bodies(u).length && bodies(bob).some((b) => b.startsWith("Broadcast sent"))));
  const got = u.inbox.find((m) => m.getChildText("body"));
  assert.equal(got.attrs.from, `${BOT}/bot`);
  assert.equal(got.attrs.type, "chat");
  assert.match(got.getChildText("body"), new RegExp(`^${text}\\n\\n~~~ This was a coord broadcast from fc_bob to caps at \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d\\.000000 EVE ~~~$`), "texto tal cual (invisibles incluidos), línea en blanco y pie");
  // caps tiene 4 miembros (usuario, piloto, fc_bob, piloto_dos), estén o no conectados.
  assert.ok(bodies(bob).includes("Broadcast sent to 4 users"));
  assert.equal(bob.inbox.find((m) => m.getChildText("body") === "Broadcast sent to 4 users").attrs.from, `${BOT}/bot`);
  await wait(300);
  assert.deepEqual(bodies(p1), []);
  assert.deepEqual(bodies(ana), []);
});

test("line: sin permiso, grupo desconocido y sin «!ping»", async (t) => {
  const p1 = await user(t, "piloto1");
  const bob = await user(t, "fc_bob");
  await p1.send(xml("message", { to: BOT, type: "chat" }, xml("body", {}, ping("caps", "x"))));
  await bob.send(xml("message", { to: BOT, type: "chat" }, xml("body", {}, ping("supers", "x"))));
  await bob.send(xml("message", { to: BOT, type: "chat" }, xml("body", {}, ping("nadie", "x"))));
  await bob.send(xml("message", { to: BOT, type: "chat" }, xml("body", {}, "Fleet up sin línea")));
  await bob.send(xml("message", { to: BOT, type: "chat" }, xml("body", {}, "!ping caps")));
  assert.ok(await until(() => bodies(bob).length === 4 && bodies(p1).length === 1));
  assert.deepEqual(bodies(p1), ["You are not allowed to broadcast to caps"]);
  assert.deepEqual(bodies(bob), [
    "You are not allowed to broadcast to supers",
    "Unknown group: nadie",
    "Usage: !ping <group> on the first line, then the ping text",
    "Usage: !ping <group> on the first line, then the ping text",
  ]);
});

test("line: «silent» se acepta y nunca contesta ni lo reparte", async (t) => {
  const u = await user(t, "usuario");
  await u.send(xml("message", { to: BOT, type: "chat" }, xml("body", {}, ping("silent", "¿hay alguien?"))));
  await wait(1200);
  assert.deepEqual(bodies(u), []);
});

test("line: all llega a todos los conectados y cuenta usuarios, no sesiones", async (t) => {
  const ana = await user(t, "fc_ana");
  const u = await user(t, "usuario");
  const p1 = await user(t, "piloto1");
  await ana.send(xml("message", { to: BOT, type: "chat" }, xml("body", {}, ping("ALL", "Everyone undock"))));
  assert.ok(await until(() => [u, p1].every((c) => bodies(c).some((b) => b.startsWith("Everyone undock"))) && bodies(ana).some((b) => b.startsWith("Broadcast sent"))));
  assert.match(bodies(u)[0], / to all at /);
  const n = Number(bodies(ana).find((b) => b.startsWith("Broadcast sent")).match(/\d+/)[0]);
  assert.ok(n >= 3, `al menos los 3 conectados (${n})`);
});

// ---- piezas sin servidor ----

test("eveStamp: hora UTC con el formato del pie", () => {
  assert.equal(eveStamp(Date.UTC(2026, 10, 2, 9, 5, 7)), "2026-11-02 09:05:07.000000");
});

test("createBots: no atiende lo que no es para los bots, y con los bots apagados nada", () => {
  const bots = createBots({ domain: D });
  const sent = [];
  const msg = (to) => xml("message", { to }, xml("body", {}, "x"));
  assert.equal(bots.onMessage(msg(`alice@${D}`), `usuario@${D}/t`, (s) => sent.push(s)), false);
  assert.equal(bots.onMessage(msg(`caps@${SVC}`), `usuario@${D}/t`, (s) => sent.push(s)), true);
  const off = createBots({ domain: D, config: { ...DEFAULT_BOTS, address: { ...DEFAULT_BOTS.address, enabled: false }, line: { ...DEFAULT_BOTS.line, enabled: false } } });
  assert.equal(off.onMessage(msg(`caps@${SVC}`), `usuario@${D}/t`, () => {}), false);
  assert.equal(off.onMessage(msg(BOT), `usuario@${D}/t`, () => {}), false);
  assert.equal(off.discoItem(), null);
});
