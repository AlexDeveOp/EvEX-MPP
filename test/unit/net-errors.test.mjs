import { test } from "node:test";
import assert from "node:assert/strict";
import { describeNetError } from "../../src/main/net-errors.js";

test("los errores de proxy de Chromium salen en palabras, con su código", () => {
  for (const code of ["ERR_TUNNEL_CONNECTION_FAILED", "ERR_PROXY_CONNECTION_FAILED"]) {
    const original = new Error(`net::${code}`);
    const err = describeNetError(original);
    assert.equal(err.code, code);
    assert.match(err.message, /proxy configurado/);
    assert.doesNotMatch(err.message, /net::/);
    assert.equal(err.cause, original);
  }
  assert.match(describeNetError(new Error("net::ERR_NAME_NOT_RESOLVED")).message, /No se encuentra el servidor/);
});

test("un error desconocido o sin código de Chromium se devuelve tal cual", () => {
  const raro = new Error("net::ERR_ALGO_RARO");
  assert.equal(describeNetError(raro), raro);
  const otro = new Error("otra cosa");
  assert.equal(describeNetError(otro), otro);
});
