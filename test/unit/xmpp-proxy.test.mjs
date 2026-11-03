// Prueba de integración: XmppAccount conectando a través de un proxy de prueba (SOCKS5 y HTTP CONNECT) hasta el
// servidor XMPP simulado. Comprueba que el proxy recibe el nombre del servidor (sin resolverlo aquí) y que si el proxy
// falla no se conecta directo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { XmppAccount } from "../../src/main/xmpp-account.js";
import { startFakeProxy } from "../fake-proxy.mjs";
import { tempDir } from "./helpers.mjs";

const PORT = 16299 + Math.floor(Math.random() * 500);
let mock;

before(async () => {
  mock = spawn(process.execPath, [fileURLToPath(new URL("../mock-xmpp.mjs", import.meta.url))], { env: { ...process.env, MOCK_PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    mock.once("exit", (code) => reject(new Error(`el servidor simulado terminó (${code})`)));
    mock.stdout.on("data", (d) => String(d).includes("mock XMPP en") && resolve());
  });
});

after(() => mock?.kill());

function account(t, getProxy) {
  // "localhost" como servidor: el proxy de prueba lo resuelve él; aquí solo se conecta a 127.0.0.1 (el reenvío local).
  const acc = new XmppAccount({ id: "p1", jid: "usuario@test.local", host: "localhost", port: PORT, security: "opportunistic" }, { avatarDir: tempDir(t), version: "1", getProxy });
  t.after(() => acc.disconnect(true).catch(() => {}));
  return acc;
}

for (const type of ["socks5", "http"]) {
  test(`conecta por un proxy ${type} con usuario y contraseña`, async (t) => {
    const proxy = await startFakeProxy({ type, auth: { username: "u", password: "p" } });
    const acc = account(t, async () => ({ type, host: "127.0.0.1", port: proxy.port, username: "u", password: "p" }));
    // Primero se desconecta la cuenta y luego se cierra el proxy (que espera a que no quede ninguna conexión).
    t.after(async () => {
      await acc.disconnect(true);
      await proxy.close();
    });
    await acc.connect("test");
    assert.equal(acc.state, "online");
    assert.ok(proxy.targets.some((x) => x === `localhost:${PORT}`), `el proxy debe recibir el nombre: ${proxy.targets.join(", ")}`);
  });
}

test("si el proxy rechaza las credenciales, la cuenta no conecta directo", async (t) => {
  const proxy = await startFakeProxy({ type: "socks5", auth: { username: "u", password: "p" } });
  t.after(() => proxy.close());
  const acc = account(t, async () => ({ type: "socks5", host: "127.0.0.1", port: proxy.port, username: "u", password: "mal" }));
  await assert.rejects(acc.connect("test"));
  assert.notEqual(acc.state, "online");
});

test("un proxy apagado da error y no conecta directo", async (t) => {
  const proxy = await startFakeProxy({ type: "http" });
  const port = proxy.port;
  await proxy.close();
  const acc = account(t, async () => ({ type: "http", host: "127.0.0.1", port }));
  await assert.rejects(acc.connect("test"));
  assert.notEqual(acc.state, "online");
});

// Espera a que se cumpla una condición, mirando cada 100 ms.
async function until(pred, ms = 10000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (pred()) return;
  throw new Error("tiempo agotado");
}

test("si el proxy se cae, la cuenta sigue reintentando y vuelve cuando el proxy vuelve", async (t) => {
  const first = await startFakeProxy({ type: "socks5" });
  let current = { type: "socks5", host: "127.0.0.1", port: first.port };
  const acc = account(t, async () => current);
  const later = {}; // el segundo proxy, cuando exista
  t.after(async () => {
    await acc.disconnect(true);
    await later.second?.close();
  });
  await acc.connect("test");
  // Que respondan las consultas de la conexión (roster…): una perdida en el corte espera 30 s y alarga el proceso.
  await new Promise((r) => setTimeout(r, 1000));
  // El proxy se cae (se cortan sus conexiones) y, mientras, no hay ninguno escuchando en ese puerto.
  first.close();
  await until(() => acc.state === "reconnecting");
  await new Promise((r) => setTimeout(r, 2500)); // varios intentos fallidos contra el proxy caído
  assert.ok(["reconnecting", "connecting"].includes(acc.state), `sigue intentándolo, sin error definitivo (${acc.state})`);
  const second = (later.second = await startFakeProxy({ type: "socks5" }));
  current = { ...current, port: second.port };
  await until(() => acc.state === "online", 15000);
  assert.ok(second.targets.includes(`localhost:${PORT}`));
  // Que respondan las consultas que lanza la cuenta al volver (si no, su espera de 30 s retrasa el final del proceso).
  await new Promise((r) => setTimeout(r, 1500));
});

test("un usuario rechazado por el proxy es un error definitivo (no reintenta sin fin)", async (t) => {
  const proxy = await startFakeProxy({ type: "http", auth: { username: "u", password: "p" } });
  const acc = account(t, async () => ({ type: "http", host: "127.0.0.1", port: proxy.port, username: "u", password: "mal" }));
  t.after(async () => {
    await acc.disconnect(true);
    await proxy.close();
  });
  await assert.rejects(acc.connect("test"), /usuario o la contraseña/);
  assert.equal(acc.state, "error");
  const tries = proxy.targets.length;
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(proxy.targets.length, tries, "no vuelve a intentarlo");
});

test("sin proxy (getProxy devuelve null) conecta directo", async (t) => {
  const acc = account(t, async () => null);
  await acc.connect("test");
  assert.equal(acc.state, "online");
});
