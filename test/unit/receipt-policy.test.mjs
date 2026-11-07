// A los pings no se les devuelve recibo de entrega: receipt-policy.js y XmppAccount contra el broadcast del simulado.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { client, xml } from "@xmpp/client";
import { XmppAccount } from "../../src/main/xmpp-account.js";
import { skipReceipt } from "../../src/main/receipt-policy.js";
import { tempDir } from "./helpers.mjs";

const FOOTER = "~~~ This was a coord broadcast from bob to caps at 2026-11-07 18:00:00.000000 EVE ~~~";

test("skipReceipt: remitentes de pings (con o sin dominio) y textos con el pie de un ping repartido", () => {
  const base = { pingSenders: ["pingbot", "avisos@pings.ejemplo.com"], accountJid: "piloto@ejemplo.com" };
  assert.equal(skipReceipt({ ...base, from: "pingbot@ejemplo.com/bot", body: "hola" }), true, "pingbot en el servidor de la cuenta");
  assert.equal(skipReceipt({ ...base, from: "avisos@pings.ejemplo.com", body: "x" }), true);
  assert.equal(skipReceipt({ ...base, from: "pingbot@otro.ejemplo.net/bot", body: "x" }), false, "sin dominio, solo el de la cuenta");
  assert.equal(skipReceipt({ ...base, from: "fc_bob@ejemplo.com/pc", body: `Caps up\n\n${FOOTER}` }), true, "el pie lo delata");
  assert.equal(skipReceipt({ ...base, from: "fc_bob@ejemplo.com/pc", body: "¿vienes a la flota?" }), false, "un mensaje normal sí");
  assert.equal(skipReceipt({ pingSenders: [], accountJid: "piloto@ejemplo.com", from: "alice@ejemplo.com", body: null }), false);
});

// ---- contra el simulado: la copia de Openfire Broadcast lleva la petición de recibo del original ----

const PORT = 19950 + Math.floor(Math.random() * 40);
const D = "test.local";
let mock;
before(async () => {
  mock = spawn(process.execPath, [fileURLToPath(new URL("../mock-xmpp.mjs", import.meta.url))], { env: { ...process.env, MOCK_PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    mock.once("exit", (code) => reject(new Error(`el servidor simulado terminó (${code})`)));
    mock.stdout.on("data", (d) => String(d).includes("mock XMPP en") && resolve());
  });
});
after(() => mock?.kill());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("XmppAccount no devuelve recibo a un ping repartido ni a un remitente de pings; a un mensaje normal, sí", async (t) => {
  // fc_bob (miembro de caps) con EvEX-MPP; usuario manda a caps@broadcast desde otro cliente que pide recibo.
  let pingSenders = [];
  const x = new XmppAccount({ id: "a", jid: `fc_bob@${D}`, host: "127.0.0.1", port: PORT, security: "opportunistic" }, { avatarDir: tempDir(t), version: "1" });
  x.skipReceipt = (from, body) => skipReceipt({ pingSenders, accountJid: x.acc.jid, from, body });
  const receipts = [];
  const send = x.send.bind(x);
  x.send = (st) => (st.getChild?.("received", "urn:xmpp:receipts") && receipts.push(st.getChild("received", "urn:xmpp:receipts").attrs.id), send(st));
  const got = [];
  x.on("event", (ev) => ev.type === "message" && !ev.outgoing && got.push(ev.id));
  t.after(() => x.disconnect(true).catch(() => {}));
  await x.connect("test");
  for (let i = 0; i < 60 && x.state !== "online"; i++) await wait(50);

  const fc = client({ service: `xmpp://127.0.0.1:${PORT}`, domain: D, resource: "otro", credentials: (auth) => auth({ username: "usuario", password: "test" }, "PLAIN") });
  fc.on("error", () => {});
  await fc.start();
  t.after(() => fc.stop().catch(() => {}));
  const ask = async (id, body) => {
    await fc.send(xml("message", { to: `caps@broadcast.${D}`, type: "chat", id }, xml("body", {}, body), xml("request", "urn:xmpp:receipts")));
    for (let i = 0; i < 40 && !got.includes(id); i++) await wait(50);
    await wait(150);
    assert.ok(got.includes(id), `llega ${id}`);
  };
  await ask("normal", "¿vienes a la flota?");
  await ask("ping", `Caps up\n\n${FOOTER}`);
  pingSenders = ["usuario"];
  await ask("lista", "Caps up, sin pie");
  assert.deepEqual(receipts, ["normal"], "solo el mensaje normal lleva recibo");
});
