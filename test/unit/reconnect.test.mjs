// Reconexión tras cortes de red: un relé TCP entre la cuenta y el servidor simulado imita cortes reales
// (red que deja de pasar datos sin cerrar el socket, reintentos que abren TCP pero nadie contesta, arranque sin red).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { XmppAccount, RECONNECT, isNetworkError } from "../../src/main/xmpp-account.js";
import { tempDir } from "./helpers.mjs";

const MOCK = 18299 + Math.floor(Math.random() * 500);
let mock;
const saved = { ...RECONNECT };

before(async () => {
  // Tiempos cortos para que las pruebas tarden segundos.
  Object.assign(RECONNECT, { PING_EVERY: 400, PING_TIMEOUT: 400, STALL: 1200, SUPERVISE_EVERY: 200, MAX_DELAY: 800 });
  mock = spawn(process.execPath, [fileURLToPath(new URL("../mock-xmpp.mjs", import.meta.url))], { env: { ...process.env, MOCK_PORT: String(MOCK) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    mock.once("exit", (code) => reject(new Error(`el servidor simulado terminó (${code})`)));
    mock.stdout.on("data", (d) => String(d).includes("mock XMPP en") && resolve());
  });
});
after(() => {
  Object.assign(RECONNECT, saved);
  mock?.kill();
});

// Relé con modos: «pasar» reenvía; «mudo» acepta conexiones nuevas sin contestar nunca y deja mudas las existentes.
async function relay(t, port = 0) {
  const r = { mode: "pass", pairs: new Set() };
  r.server = net.createServer((cli) => {
    cli.on("error", () => {});
    const pair = { cli, srv: null, mute: r.mode !== "pass" };
    r.pairs.add(pair);
    cli.on("close", () => (r.pairs.delete(pair), pair.srv?.destroy()));
    if (pair.mute) return;
    pair.srv = net.connect(MOCK, "127.0.0.1");
    pair.srv.on("error", () => {});
    pair.srv.on("close", () => !pair.mute && cli.destroy());
    cli.on("data", (d) => !pair.mute && pair.srv.write(d));
    pair.srv.on("data", (d) => !pair.mute && cli.write(d));
  });
  await new Promise((res) => r.server.listen(port, "127.0.0.1", res));
  r.port = r.server.address().port;
  r.close = () => new Promise((res) => {
    for (const p of r.pairs) (p.cli.destroy(), p.srv?.destroy());
    r.server.close(() => res());
  });
  t.after(() => r.close());
  return r;
}

function account(t, port, extra = {}) {
  const acc = new XmppAccount({ id: "rc", jid: "usuario@test.local", host: "127.0.0.1", port, security: "opportunistic", ...extra }, { avatarDir: tempDir(t), version: "1" });
  const states = [];
  acc.on("event", (e) => e.type === "status" && states.push(e.state));
  acc.states = states;
  t.after(() => acc.disconnect(true).catch(() => {}));
  return acc;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (pred()) return;
  throw new Error("tiempo agotado");
}

test("si un reintento abre TCP pero nadie contesta, no se queda atascado: al volver la red, conecta", async (t) => {
  const r = await relay(t);
  const acc = account(t, r.port);
  await acc.connect("test");
  await sleep(300);
  r.mode = "mute";
  for (const p of r.pairs) p.cli.destroy(); // se corta, y los reintentos abren TCP sin respuesta
  await until(() => acc.state !== "online", 2000);
  await sleep(2500); // más que STALL: con el código anterior se quedaba aquí para siempre
  assert.notEqual(acc.state, "online");
  r.mode = "pass"; // vuelve la red
  await until(() => acc.state === "online", 8000);
});

test("si la conexión muere en silencio (sin cerrar el socket), el ping lo detecta y reconecta", async (t) => {
  const r = await relay(t);
  const acc = account(t, r.port);
  await acc.connect("test");
  await sleep(300);
  for (const p of r.pairs) p.mute = true; // no pasa nada, pero nadie cierra
  await until(() => acc.states.includes("reconnecting"), 3000);
  await until(() => acc.state === "online", 8000); // el reintento ya pasa por el relé en modo normal
});

test("al arrancar sin red sigue intentándolo y conecta cuando aparece el servidor", async (t) => {
  const free = await relay(t);
  const port = free.port;
  await free.close(); // nadie escucha: ECONNREFUSED
  const acc = account(t, port);
  await assert.rejects(acc.connect("test"));
  assert.equal(acc.state, "reconnecting", "no se rinde con un error de red");
  await sleep(1500);
  await relay(t, port); // la red (el servidor) vuelve
  await until(() => acc.state === "online", 8000);
});

test("una contraseña mala sigue siendo un error definitivo: sin reintentos", async (t) => {
  const r = await relay(t);
  const acc = account(t, r.port);
  await assert.rejects(acc.connect("mala"));
  assert.equal(acc.state, "error");
  const tries = acc.states.filter((s) => s === "connecting").length;
  await sleep(2000);
  assert.equal(acc.states.filter((s) => s === "connecting").length, tries);
});

test("el aviso de red (nudge) reintenta ya, aunque la espera entre intentos haya crecido", async (t) => {
  const free = await relay(t);
  const port = free.port;
  await free.close();
  const acc = account(t, port);
  await assert.rejects(acc.connect("test"));
  Object.assign(RECONNECT, { MAX_DELAY: 60000 });
  t.after(() => Object.assign(RECONNECT, { MAX_DELAY: 800 }));
  acc.xmpp.reconnect.delay = 60000; // como tras muchos fallos seguidos
  await relay(t, port);
  await sleep(700);
  assert.notEqual(acc.state, "online", "sin aviso esperaría un minuto");
  acc.nudge();
  await until(() => acc.state === "online", 4000);
});

test("qué errores cuentan como de red", () => {
  assert.equal(isNetworkError(Object.assign(new Error("x"), { code: "ENOTFOUND" })), true);
  assert.equal(isNetworkError(Object.assign(new Error("x"), { name: "TimeoutError" })), true);
  assert.equal(isNetworkError(new Error("envoltorio", { cause: Object.assign(new Error("x"), { code: "ECONNRESET" }) })), true);
  assert.equal(isNetworkError(Object.assign(new Error("x"), { condition: "not-authorized" })), false);
  assert.equal(isNetworkError(Object.assign(new Error("x"), { code: "ECONNREFUSED", fatal: true })), false);
  assert.equal(isNetworkError(new Error("otro")), false);
});
