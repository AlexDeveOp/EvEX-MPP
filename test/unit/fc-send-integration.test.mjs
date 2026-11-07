// Modo FC de punta a punta: XmppAccount + sendPlan (fc-ipc.js) contra los bots del servidor simulado (test/mock-bots.mjs).
// También comprueba que la respuesta del bot se marca (markFcReply) y que un ping de verdad con su pie sigue siendo ping.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { client } from "@xmpp/client";
import { XmppAccount } from "../../src/main/xmpp-account.js";
import { sendPlan, markFcReply } from "../../src/main/fc-ipc.js";
import { Logs } from "../../src/main/logs.js";
import { isBroadcastEcho } from "../../src/renderer/js/fc-send.js";
import { tempDir } from "./helpers.mjs";

const PORT = 19750 + Math.floor(Math.random() * 400);
const D = "test.local";
const SVC = `broadcast.${D}`;
const BOT = `pingbot@${D}`;
const ZWSP = String.fromCharCode(0x200b);
let mock;

before(async () => {
  mock = spawn(process.execPath, [fileURLToPath(new URL("../mock-xmpp.mjs", import.meta.url))], { env: { ...process.env, MOCK_PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    mock.once("exit", (code) => reject(new Error(`el servidor simulado terminó (${code})`)));
    mock.stdout.on("data", (d) => String(d).includes("mock XMPP en") && resolve());
  });
});
after(() => mock?.kill());

// Cuenta conectada. Como main.js, un oyente registrado ANTES del envío llama a markFcReply y apunta los mensajes.
async function account(t, user) {
  const x = new XmppAccount({ id: user, jid: `${user}@${D}`, host: "127.0.0.1", port: PORT, security: "opportunistic" }, { avatarDir: tempDir(t), version: "1" });
  x.seen = [];
  x.on("event", (ev) => {
    markFcReply(x, ev);
    if (ev.type === "message") x.seen.push(ev);
  });
  t.after(() => x.disconnect(true).catch(() => {}));
  await x.connect("test");
  for (let i = 0; i < 60 && x.state !== "online"; i++) await wait(50);
  return x;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const address = (name) => ({ name, address: `${name}@${SVC}` });
const opts = { timeoutMs: 1500 };

// ---- «una dirección por grupo» (Broadcast de Openfire) ----

test("address con copia propia: «delivered» en cuanto llega, sin esperar al final del plazo", async (t) => {
  const x = await account(t, "usuario");
  const text = `Caps fleet up${ZWSP}\nFormup: home`;
  const t0 = Date.now();
  const [r] = await sendPlan(x, { mode: "address", groups: [address("caps")], text }, opts);
  assert.equal(r.status, "delivered");
  assert.equal(r.echo, true, "usuario es miembro de caps: le llega su copia");
  assert.ok(Date.now() - t0 < opts.timeoutMs, "no espera al final del plazo");
  const copy = x.seen.find((e) => e.conv === `usuario@${D}`);
  assert.equal(copy.body, text, "tal cual, con sus invisibles");
  assert.ok(!copy.fcReply, "la copia propia no es la respuesta del bot");
});

test("address aceptado sin copia (no es miembro): «accepted», nunca «sent» ni «delivered»", async (t) => {
  const x = await account(t, "fc_ana");
  const [r] = await sendPlan(x, { mode: "address", groups: [address("caps")], text: "Caps up" }, opts);
  assert.equal(r.status, "accepted");
  assert.equal(r.echo, false);
});

test("address sin permiso: rechazado con el motivo que da el servicio", async (t) => {
  const x = await account(t, "usuario");
  const [r] = await sendPlan(x, { mode: "address", groups: [address("supers")], text: "Supers up" }, opts);
  assert.equal(r.status, "rejected");
  assert.equal(r.reason, `Not allowed to send a broadcast message to supers@${SVC}`);
});

// El servicio de broadcast copia el mensaje con todos sus hijos: con una petición de recibo, cada miembro que lo
// recibe devolvería un recibo al FC (cientos con «all»). Comprobado contra Openfire 5.1.2 con Broadcast 1.9.3.
// (El simulado no reenvía mensajes entre usuarios, así que aquí se mira la copia que llega a un miembro.)
test("address: los envíos del Modo FC van sin petición de recibo ni estado de escritura", async (t) => {
  const bob = await account(t, "fc_bob");
  const member = client({ service: `xmpp://127.0.0.1:${PORT}`, domain: D, resource: "raw", credentials: (auth) => auth({ username: "usuario", password: "test" }, "PLAIN") });
  member.on("error", () => {});
  const copies = [];
  member.on("stanza", (s) => s.is("message") && s.getChildText("body") && copies.push(s));
  await member.start();
  t.after(() => member.stop().catch(() => {}));
  const extras = (body) => {
    const m = copies.find((s) => s.getChildText("body") === body);
    return m && { receipt: !!m.getChild("request", "urn:xmpp:receipts"), chatstate: !!m.getChild("active", "http://jabber.org/protocol/chatstates") };
  };
  // Control: un mensaje normal llega con los dos, porque el servicio lo copia todo (como Openfire).
  await bob.sendMessage({ to: `all@${SVC}`, body: "mensaje normal", type: "chat" });
  const [r] = await sendPlan(bob, { mode: "address", groups: [address("all")], text: "Ping a todos" }, opts);
  assert.equal(r.status, "delivered");
  for (let i = 0; i < 40 && copies.length < 2; i++) await wait(50);
  assert.deepEqual(extras("mensaje normal"), { receipt: true, chatstate: true });
  assert.deepEqual(extras("Ping a todos"), { receipt: false, chatstate: false });
});

test("address con varios grupos: cada uno con su resultado, en orden", async (t) => {
  const x = await account(t, "usuario");
  const rs = await sendPlan(x, { mode: "address", groups: [address("supers"), address("nadie")], text: "x" }, opts);
  assert.deepEqual(rs.map((r) => [r.group, r.status]), [["supers", "rejected"], ["nadie", "rejected"]]);
});

// ---- «línea al principio» (pingbot con «!ping <grupo>») ----

test("line aceptado: «Broadcast sent…» es enviado y se marca como respuesta; el ping con pie sigue siendo ping", async (t) => {
  const x = await account(t, "usuario");
  const text = `Caps fleet up${ZWSP}\nFormup: home`;
  const [r] = await sendPlan(x, { mode: "line", groups: [{ name: "caps" }], botJid: BOT, linePrefix: "!ping {grupo}", text }, opts);
  assert.equal(r.status, "sent", "la respuesta de éxito del bot manda sobre la copia");
  assert.match(r.reply, /^Broadcast sent to \d+ users$/);
  assert.equal(r.echo, true, "usuario es miembro de caps: le llega el ping con su pie");
  const fromBot = x.seen.filter((e) => e.conv === BOT);
  const reply = fromBot.find((e) => e.body === r.reply);
  // (El simulado manda además un ping de bienvenida; el nuestro es el que lleva nuestro texto.)
  const ping = fromBot.find((e) => isBroadcastEcho(e.body) && e.body.startsWith(text));
  assert.equal(reply.fcReply, true, "la respuesta no es un ping");
  assert.ok(ping, "llega el ping, tal cual y con su pie");
  assert.ok(!ping.fcReply, "un ping de verdad durante el envío sigue siendo ping");
  assert.ok(fromBot.filter((e) => isBroadcastEcho(e.body)).every((e) => !e.fcReply), "ningún ping con pie se marca");
});

test("line sin permiso o grupo desconocido: rechazado y marcado como respuesta", async (t) => {
  const x = await account(t, "usuario");
  const rs = await sendPlan(x, { mode: "line", groups: [{ name: "supers" }, { name: "nadie" }], botJid: BOT, text: "x" }, opts);
  assert.deepEqual(rs.map((r) => [r.status, r.reason]), [["rejected", "You are not allowed to broadcast to supers"], ["rejected", "Unknown group: nadie"]]);
  assert.ok(x.seen.filter((e) => e.conv === BOT && rs.some((r) => r.reply === e.body)).every((e) => e.fcReply));
});

test("line con un formato que el bot no entiende: «Usage…» es rechazo", async (t) => {
  const x = await account(t, "usuario");
  const [r] = await sendPlan(x, { mode: "line", groups: [{ name: "caps" }], botJid: BOT, linePrefix: "!pingear {grupo}", text: "x" }, opts);
  assert.equal(r.status, "rejected");
  assert.match(r.reason, /^Usage:/);
});

test("line a un grupo que el bot no confirma: sin confirmar, y después ya no se marca nada", async (t) => {
  const x = await account(t, "usuario");
  const [r] = await sendPlan(x, { mode: "line", groups: [{ name: "silent" }], botJid: BOT, text: "x" }, opts);
  assert.equal(r.status, "unconfirmed");
  // Pasado el envío, lo que diga el bot vuelve a ser lo de siempre.
  const ev = { type: "message", conv: BOT, body: "Broadcast sent to 3 users" };
  assert.equal(markFcReply(x, ev), false);
  assert.ok(!ev.fcReply);
});

// ---- guardado ----

test("logs: la respuesta marcada se guarda con fc y lo demás sin él", (t) => {
  const logs = new Logs(tempDir(t));
  const a = logs.append("A", BOT, { nick: "pingbot", body: "Broadcast sent to 3 users", ts: 1, fcReply: true });
  const b = logs.append("A", BOT, { nick: "pingbot", body: "Ping de verdad", ts: 2 });
  assert.equal(a.fc, 1);
  assert.ok(!("fc" in b));
});

test("modo por defecto: address espera 5 s y line 15 s", async () => {
  const { FC_ADDRESS_MS, FC_REPLY_MS } = await import("../../src/main/fc-ipc.js");
  assert.equal(FC_ADDRESS_MS, 5e3);
  assert.equal(FC_REPLY_MS, 15e3);
});
