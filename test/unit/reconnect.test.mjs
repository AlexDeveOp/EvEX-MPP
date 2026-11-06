// Reconexión tras cortes de red: un relé TCP entre la cuenta y el servidor simulado imita cortes reales
// (red que deja de pasar datos sin cerrar el socket, reintentos que abren TCP pero nadie contesta, arranque sin red).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { XmppAccount, RECONNECT, NEGOTIATION_GRACE, DISCONNECT_MS, isNetworkError } from "../../src/main/xmpp-account.js";
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

test("un aviso de red no corta un intento que ya está negociando con el servidor, y queda en el registro", async (t) => {
  const r = await relay(t);
  r.mode = "mute"; // el TCP se abre pero el servidor tarda en contestar, como uno lejano en plena negociación
  const lines = [];
  const acc = new XmppAccount({ id: "rn", jid: "usuario@test.local", host: "127.0.0.1", port: r.port, security: "opportunistic" }, { avatarDir: tempDir(t), version: "1", log: (id, text) => lines.push(`${id} ${text}`) });
  t.after(() => acc.disconnect(true).catch(() => {}));
  acc.connect("test").catch(() => {});
  await until(() => ["opening", "open"].includes(acc.xmpp?.status), 2000);
  const sockets = r.pairs.size;
  acc.nudge("prueba");
  await sleep(300);
  assert.equal(r.pairs.size, sockets, "no se abre otra conexión");
  assert.ok([...r.pairs].every((p) => !p.cli.destroyed), "ni se corta la que estaba negociando");
  assert.ok(lines.some((l) => l.startsWith("rn connect (")));
  assert.ok(lines.some((l) => l.includes("prueba (opening)") || l.includes("prueba (open)")));
  assert.ok(!lines.some((l) => l.includes("restart connection")));
});

test("un intento que lleva tiempo quieto sí se rehace con el aviso de red (puede ir por una ruta muerta)", async (t) => {
  const r = await relay(t);
  r.mode = "mute";
  const acc = account(t, r.port);
  acc.connect("test").catch(() => {});
  await until(() => ["opening", "open"].includes(acc.xmpp?.status), 2000);
  const lines = [];
  acc.connLog = (id, text) => lines.push(text);
  acc.lastProgress = Date.now() - NEGOTIATION_GRACE - 1;
  acc.nudge("prueba");
  // (El relé mudo no lee su lado, así que no se entera del cierre: se comprueba por el registro y el estado.)
  assert.ok(lines.some((l) => /^restart connection \((opening|open)\): prueba$/.test(l)), lines.join("\n"));
  await until(() => lines.some((l) => l.startsWith("disconnect (")), 1000);
});

test("un reset a mitad del login no deja un rechazo sin capturar (la promesa «online» de xmpp.js)", async (t) => {
  const rejected = [];
  const onRejection = (e) => rejected.push(e);
  process.on("unhandledRejection", onRejection);
  t.after(() => process.off("unhandledRejection", onRejection));
  const socks = [];
  const server = net.createServer((c) => (c.on("error", () => {}), socks.push(c)));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const acc = account(t, server.address().port);
  acc.connect("test").catch(() => {});
  await until(() => acc.xmpp?.status === "opening", 2000);
  for (const s of socks) s.resetAndDestroy(); // el servidor corta durante la negociación
  await sleep(500);
  assert.deepEqual(rejected.map((e) => e?.code), []);
});

test("desconectar con el servidor sin contestar y un reset después: ni excepción sin capturar ni estado «error»", async (t) => {
  const socks = [];
  const server = net.createServer((c) => (c.on("error", () => {}), socks.push(c)));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const acc = account(t, server.address().port);
  const connecting = acc.connect("test").catch(() => {});
  await until(() => acc.xmpp?.status === "opening", 2000);
  await acc.disconnect(); // espera 3 s al servidor y deja de esperar
  for (const s of socks) s.resetAndDestroy(); // antes: «Uncaught ECONNRESET» en el proceso principal
  await connecting;
  await sleep(300);
  assert.equal(acc.state, "offline", "el fallo del intento viejo no pone la cuenta en «error»");
});

test("qué errores cuentan como de red", () => {
  assert.equal(isNetworkError(Object.assign(new Error("x"), { code: "ENOTFOUND" })), true);
  assert.equal(isNetworkError(Object.assign(new Error("x"), { name: "TimeoutError" })), true);
  assert.equal(isNetworkError(new Error("envoltorio", { cause: Object.assign(new Error("x"), { code: "ECONNRESET" }) })), true);
  assert.equal(isNetworkError(Object.assign(new Error("x"), { condition: "not-authorized" })), false);
  assert.equal(isNetworkError(Object.assign(new Error("x"), { code: "ECONNREFUSED", fatal: true })), false);
  assert.equal(isNetworkError(new Error("otro")), false);
});

// Con proxy: la app habla con un reenvío local (ver useProxy) y el reenvío con el proxy.
test("por proxy SOCKS5: si el proxy deja de contestar en silencio, el ping lo detecta y reconecta", async (t) => {
  const { startFakeProxy } = await import("../fake-proxy.mjs");
  const r = await relay(t); // el relé hace de red entre el proxy y el servidor
  const proxy = await startFakeProxy({ type: "socks5" });
  t.after(() => proxy.close());
  const acc = new XmppAccount({ id: "rp", jid: "usuario@test.local", host: "localhost", port: r.port, security: "opportunistic" }, { avatarDir: tempDir(t), version: "1", getProxy: async () => ({ type: "socks5", host: "127.0.0.1", port: proxy.port }) });
  const states = [];
  acc.on("event", (e) => e.type === "status" && states.push(e.state));
  t.after(() => acc.disconnect(true).catch(() => {}));
  await acc.connect("test");
  await sleep(300);
  for (const p of r.pairs) p.mute = true; // detrás del proxy deja de pasar nada, sin cerrar
  await until(() => states.includes("reconnecting"), 3000);
  await until(() => acc.state === "online", 8000);
  assert.ok(proxy.targets.filter((x) => x === `localhost:${r.port}`).length >= 2, "el reintento también va por el proxy");
});

test("por proxy: si el proxy se cae, no es un error definitivo y reconecta cuando vuelve", async (t) => {
  const { startFakeProxy } = await import("../fake-proxy.mjs");
  const r = await relay(t);
  const first = await startFakeProxy({ type: "socks5" });
  const port = first.port;
  let current = { type: "socks5", host: "127.0.0.1", port };
  const acc = new XmppAccount({ id: "rq", jid: "usuario@test.local", host: "localhost", port: r.port, security: "opportunistic" }, { avatarDir: tempDir(t), version: "1", getProxy: async () => current });
  t.after(() => acc.disconnect(true).catch(() => {}));
  await acc.connect("test");
  await sleep(300);
  first.close(); // el proxy se cae: los reintentos dan PROXY_CONNECT
  await until(() => acc.state !== "online", 3000);
  await sleep(1500);
  assert.notEqual(acc.state, "error", "un proxy caído no es un error definitivo");
  const second = await startFakeProxy({ type: "socks5" }); // vuelve (otro puerto: se le indica a la cuenta)
  t.after(() => second.close());
  current = { ...current, port: second.port };
  acc.nudge();
  await until(() => acc.state === "online", 6000);
});

test("con TLS directo se corta el socket de verdad, que va dentro del envoltorio", () => {
  const acc = new XmppAccount({ id: "rt", jid: "u@ejemplo.com", security: "direct" }, { avatarDir: ".", version: "1" });
  let destroyed = 0;
  acc.wantOnline = true;
  acc.xmpp = { status: "online", socket: { socket: { destroy: () => destroyed++ } }, reconnect: { delay: 1000 } }; // envoltorio de @xmpp/tls
  acc.restartConnection();
  assert.equal(destroyed, 1);
  acc.xmpp = { status: "online", socket: { destroy: () => destroyed++ }, reconnect: { delay: 1000 } }; // net.Socket o TLSSocket (STARTTLS)
  acc.restartConnection();
  assert.equal(destroyed, 2);
  acc.xmpp = null;
});

// Al cerrar la app con la red caída, despedirse no debe colgarla: presencia y cierre, como mucho DISCONNECT_MS en total.
function fakeClient({ hang }) {
  const sent = [];
  const never = () => new Promise(() => {});
  return {
    sent,
    status: "online",
    reconnect: { stop() {} },
    send: (st) => (sent.push(st), hang ? never() : Promise.resolve()),
    stop: () => (hang ? never() : Promise.resolve()),
    removeAllListeners() {},
    on() {},
  };
}

test("desconectar con la red caída (nada contesta) termina en DISCONNECT_MS, sin quedarse esperando", async () => {
  const acc = new XmppAccount({ id: "rd", jid: "u@ejemplo.com" }, { avatarDir: ".", version: "1" });
  const x = fakeClient({ hang: true });
  acc.xmpp = x;
  const t0 = Date.now();
  await acc.disconnect(true);
  const took = Date.now() - t0;
  assert.ok(took >= DISCONNECT_MS - 50 && took < DISCONNECT_MS + 1000, `tardó ${took} ms`);
  assert.equal(x.sent.length, 1, "se intentó mandar la presencia «unavailable»");
});

test("desconectar con red normal manda la presencia «unavailable» y no espera de más", async () => {
  const acc = new XmppAccount({ id: "re", jid: "u@ejemplo.com" }, { avatarDir: ".", version: "1" });
  const x = fakeClient({ hang: false });
  acc.xmpp = x;
  const t0 = Date.now();
  await acc.disconnect(true);
  assert.ok(Date.now() - t0 < 500);
  assert.equal(x.sent[0]?.name, "presence");
  assert.equal(x.sent[0]?.attrs.type, "unavailable");
});

// La causa de la CI colgada (reconnect.test.mjs terminaba sus pruebas y el proceso no acababa nunca): una prueba se
// desconecta justo al quedar «online», mientras onOnline() aún espera al roster; al seguir, onOnline() creaba el
// intervalo del ping DESPUÉS de disconnect(), sin nadie que lo parase.
test("desconectar mientras onOnline() espera al roster no deja el intervalo del ping vivo", async () => {
  const acc = new XmppAccount({ id: "ro", jid: "u@ejemplo.com" }, { avatarDir: ".", version: "1" });
  let releaseRoster;
  acc.fetchRoster = () => new Promise((r) => (releaseRoster = r));
  acc.sendPresence = async () => {};
  acc.discoverServer = async () => {};
  acc.loadOwnAvatar = async () => {};
  acc.xmpp = fakeClient({ hang: false });
  acc.wantOnline = true;
  const online = acc.onOnline({ toString: () => "u@ejemplo.com/EvEX-MPP" });
  await acc.disconnect(true);
  releaseRoster();
  await online;
  const leaked = acc.pingTimer;
  clearInterval(leaked); // por si falla: que no cuelgue también esta prueba
  assert.equal(leaked ?? null, null, "no queda un intervalo del ping sin parar");
});
