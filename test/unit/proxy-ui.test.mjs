import { test } from "node:test";
import assert from "node:assert/strict";
import { S } from "../../src/renderer/js/state.js";
import { DEFAULT_PORTS, PROXY_DEFAULTS, PROXY_TYPES, globalProxy, globalProxySummary } from "../../src/renderer/js/settings/network.js";
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
