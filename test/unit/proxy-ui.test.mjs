import { test } from "node:test";
import assert from "node:assert/strict";
import { S } from "../../src/renderer/js/state.js";
import { DEFAULT_PORTS, PROXY_DEFAULTS, PROXY_TYPES, globalProxy, globalProxySummary, xmppTarget, testResultText } from "../../src/renderer/js/settings/network.js";
import { TEST_SETTINGS } from "./helpers.mjs";

test("puertos por defecto de cada tipo y valores iniciales", () => {
  assert.deepEqual(DEFAULT_PORTS, { socks5: 1080, http: 8080, https: 443 });
  assert.deepEqual(PROXY_TYPES.map(([k]) => k), ["socks5", "http", "https"]);
  assert.equal(PROXY_DEFAULTS.port, DEFAULT_PORTS[PROXY_DEFAULTS.type]);
});

test("globalProxy rellena lo que falte y el resumen solo aparece si está activado y tiene servidor", () => {
  S.settings = structuredClone(TEST_SETTINGS);
  assert.deepEqual(globalProxy(), { enabled: false, type: "socks5", host: "", port: 1080, username: "" });
  assert.equal(globalProxySummary(), "");
  S.settings.proxy = { enabled: true, type: "http", host: "proxy.ejemplo.com", port: 8080 };
  assert.equal(globalProxySummary(), "HTTP proxy.ejemplo.com:8080");
  S.settings.proxy.host = "";
  assert.equal(globalProxySummary(), "", "sin servidor no hay proxy general que usar");
  S.settings.proxy = { enabled: false, host: "proxy.ejemplo.com" };
  assert.equal(globalProxySummary(), "");
});

test("xmppTarget: servidor de conexión o dominio de la dirección, con su puerto", () => {
  assert.deepEqual(xmppTarget({ jid: "piloto@ejemplo.com", host: "", port: 5222 }), { host: "ejemplo.com", port: 5222 });
  assert.deepEqual(xmppTarget({ jid: "piloto@ejemplo.com", host: " xmpp.ejemplo.com ", port: "5223" }), { host: "xmpp.ejemplo.com", port: 5223 });
  assert.deepEqual(xmppTarget({ jid: "piloto@ejemplo.com" }), { host: "ejemplo.com", port: 5222 }, "sin puerto, el de XMPP");
  assert.equal(xmppTarget({ jid: "" }), null);
  assert.equal(xmppTarget(undefined), null);
});

test("testResultText: proxy solo, servidor alcanzable, no alcanzable y respuesta antigua sin target", () => {
  const dest = { host: "ejemplo.com", port: 5222 };
  assert.deepEqual(testResultText({ ms: 44.6 }, null), { kind: "good", text: "Proxy: responde (45 ms)" });
  assert.deepEqual(testResultText({ ms: 40 }, dest), { kind: "good", text: "Proxy: responde (40 ms)" }, "main que aún no comprueba el servidor");
  assert.deepEqual(testResultText({ ms: 40, target: { ok: true, ms: 120 } }, dest), { kind: "good", text: "Proxy: responde (40 ms) · Servidor XMPP ejemplo.com:5222: se llega (120 ms)" });
  const bad = testResultText({ ms: 40, target: { ok: false, error: "conexión rechazada" } }, dest);
  assert.equal(bad.kind, "bad");
  assert.match(bad.text, /no se llega \(conexión rechazada\)/);
  assert.match(testResultText({ ms: 40, target: { ok: false } }, dest).text, /error desconocido/);
});
