import { test } from "node:test";
import assert from "node:assert/strict";
import { globalProxy, accountProxy } from "../../src/main/proxy-settings.js";
import { normalizeAccount, normalizeAccountProxy, normalizeProxySettings, DEFAULT_SETTINGS } from "../../src/main/store.js";

const secrets = { global: "g-pass", acc1: "a-pass" };
const getPassword = async (id) => secrets[id] ?? null;
const settings = (proxy) => ({ ...DEFAULT_SETTINGS, proxy: { ...DEFAULT_SETTINGS.proxy, ...proxy } });

test("el proxy general desactivado no se usa", async () => {
  assert.equal(await globalProxy(settings({ enabled: false, host: "proxy.ejemplo.com" }), getPassword), null);
});

test("el proxy general activado trae su contraseña solo si tiene usuario", async () => {
  assert.deepEqual(await globalProxy(settings({ enabled: true, type: "http", host: "proxy.ejemplo.com", port: 3128, username: "yo" }), getPassword), {
    type: "http",
    host: "proxy.ejemplo.com",
    port: 3128,
    username: "yo",
    password: "g-pass",
  });
  assert.equal((await globalProxy(settings({ enabled: true, host: "proxy.ejemplo.com" }), getPassword)).password, "");
});

test("un proxy activado sin servidor falla en vez de conectar directo", async () => {
  await assert.rejects(globalProxy(settings({ enabled: true, host: "" }), getPassword), { code: "PROXY_CONFIG" });
  await assert.rejects(accountProxy({ id: "acc1", proxy: { mode: "custom", host: "" } }, settings({}), getPassword), { code: "PROXY_CONFIG" });
});

test("cada cuenta elige: general, ninguno o el suyo", async () => {
  const s = settings({ enabled: true, host: "general.ejemplo.com", port: 1080 });
  assert.equal((await accountProxy({ id: "acc1", proxy: { mode: "global" } }, s, getPassword)).host, "general.ejemplo.com");
  assert.equal((await accountProxy({ id: "acc1" }, s, getPassword)).host, "general.ejemplo.com", "sin configurar = general");
  assert.equal(await accountProxy({ id: "acc1", proxy: { mode: "none" } }, s, getPassword), null);
  assert.deepEqual(await accountProxy({ id: "acc1", proxy: { mode: "custom", type: "https", host: "propio.ejemplo.com", port: 443, username: "u" } }, s, getPassword), {
    type: "https",
    host: "propio.ejemplo.com",
    port: 443,
    username: "u",
    password: "a-pass",
  });
});

test("los datos del proxy se sanean al guardar", () => {
  assert.deepEqual(normalizeProxySettings({ type: "ftp", host: "  p.ejemplo.com ", port: "99999" }), { type: "socks5", host: "p.ejemplo.com", port: 1080, username: "" });
  assert.equal(normalizeProxySettings({ type: "http" }).port, 8080);
  assert.equal(normalizeProxySettings({ type: "https", port: "8443" }).port, 8443);
  assert.equal(normalizeAccountProxy(undefined).mode, "global");
  assert.equal(normalizeAccountProxy({ mode: "raro" }).mode, "global");
  assert.deepEqual(normalizeAccount({ jid: "a@ejemplo.com" }).proxy, { mode: "global", type: "socks5", host: "", port: 1080, username: "" });
});
