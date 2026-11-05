// fetch del proceso principal sobre net.request (net-fetch.js): respuesta estándar, límite de tamaño, credenciales
// solo para el proxy, errores de red en palabras y cancelación. net es el del stub de electron.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { net } from "electron";
import { createNetFetch } from "../../src/main/net-fetch.js";

// Contesta una petición como lo haría Chromium: cabeceras, trozos del cuerpo y fin.
function respond(req, { status = 200, statusMessage = "OK", headers = {}, chunks = [] } = {}) {
  const res = new EventEmitter();
  Object.assign(res, { statusCode: status, statusMessage, headers });
  req.emit("response", res);
  for (const c of chunks) res.emit("data", Buffer.from(c));
  res.emit("end");
  return res;
}

let auths;
beforeEach(() => {
  net.requests.length = 0;
  net.onRequest = null;
  auths = [];
});
const fetchWith = (auth = () => null, opts) =>
  createNetFetch((info) => {
    auths.push(info);
    return auth(info);
  }, opts);

test("devuelve un Response con estado, cabeceras repetidas y el cuerpo entero", async () => {
  net.onRequest = (req) => respond(req, { status: 201, statusMessage: "Created", headers: { "content-type": "application/json", "set-cookie": ["a=1", "b=2"] }, chunks: ['{"ok":', "true}"] });
  const res = await fetchWith()(new URL("https://ejemplo.com/api"), { method: "POST", headers: { Accept: "application/json", "X-Prueba": "1" } });
  assert.equal(res.status, 201);
  assert.equal(res.statusText, "Created");
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal(res.headers.get("set-cookie"), "a=1, b=2");
  assert.deepEqual(await res.json(), { ok: true });
  const [req] = net.requests;
  assert.deepEqual(req.options, { url: "https://ejemplo.com/api", method: "POST", redirect: "follow" });
  assert.deepEqual(req.headers, { Accept: "application/json", "X-Prueba": "1" });
  assert.ok(req.ended);
});

test("GET por defecto, redirect manual si se pide, y sin cuerpo en 204 y 304", async () => {
  net.onRequest = (req) => respond(req, { status: 204, statusMessage: "" });
  const res = await fetchWith()("https://ejemplo.com/vacio", { redirect: "manual" });
  assert.equal(res.status, 204);
  assert.equal(res.body, null);
  assert.deepEqual(net.requests[0].options, { url: "https://ejemplo.com/vacio", method: "GET", redirect: "manual" });
  net.onRequest = (req) => respond(req, { status: 304, chunks: ["ignorado"] });
  assert.equal((await fetchWith()("https://ejemplo.com/cache")).body, null);
});

test("corta la descarga y falla si la respuesta pasa del máximo", async () => {
  net.onRequest = (req) => respond(req, { chunks: ["12345", "67890", "abc"] });
  await assert.rejects(fetchWith(undefined, { maxBytes: 8 })("https://ejemplo.com/grande"), /demasiado grande/);
  assert.equal(net.requests[0].aborted, true);
  // Justo en el límite sí vale.
  net.onRequest = (req) => respond(req, { chunks: ["1234", "5678"] });
  assert.equal(await (await fetchWith(undefined, { maxBytes: 8 })("https://ejemplo.com/justo")).text(), "12345678");
});

test("da credenciales solo al proxy que las pide, nunca a un servidor web", async () => {
  const answers = [];
  net.onRequest = (req) => {
    req.emit("login", { isProxy: true, host: "127.0.0.1", port: 9000 }, (...a) => answers.push(["proxy", ...a]));
    req.emit("login", { isProxy: false, host: "ejemplo.com" }, (...a) => answers.push(["web", ...a]));
    respond(req, { chunks: ["ok"] });
  };
  await fetchWith(() => ({ username: "puente", password: "aleatoria" }))("https://ejemplo.com/");
  assert.deepEqual(answers, [["proxy", "puente", "aleatoria"], ["web"]]);
  // Al servidor web ni se le pregunta a getProxyAuth.
  assert.deepEqual(
    auths.map((a) => a.isProxy),
    [true],
  );
  // Un proxy que no es el nuestro (getProxyAuth da null) se queda sin credenciales.
  answers.length = 0;
  await fetchWith(() => null)("https://ejemplo.com/");
  assert.deepEqual(answers, [["proxy"], ["web"]]);
});

test("los errores de red de Chromium se explican en palabras y conservan el código", async () => {
  net.onRequest = (req) => req.emit("error", new Error("net::ERR_PROXY_CONNECTION_FAILED"));
  await assert.rejects(fetchWith()("https://ejemplo.com/"), (e) => e.code === "ERR_PROXY_CONNECTION_FAILED" && /proxy/.test(e.message) && /ERR_PROXY/.test(e.cause.message));
  net.onRequest = (req) => req.emit("error", new Error("net::ERR_NAME_NOT_RESOLVED"));
  await assert.rejects(fetchWith()("https://ejemplo.com/"), (e) => e.code === "ERR_NAME_NOT_RESOLVED");
  // Uno que no se reconoce se devuelve tal cual.
  const raw = new Error("algo raro");
  net.onRequest = (req) => req.emit("error", raw);
  await assert.rejects(fetchWith()("https://ejemplo.com/"), (e) => e === raw);
  // Un error a mitad de la respuesta también rechaza.
  net.onRequest = (req) => {
    const res = new EventEmitter();
    Object.assign(res, { statusCode: 200, headers: {} });
    req.emit("response", res);
    res.emit("data", Buffer.from("a medias"));
    res.emit("error", new Error("cortada"));
    res.emit("end");
  };
  await assert.rejects(fetchWith()("https://ejemplo.com/"), /cortada/);
});

test("con la señal ya cancelada no se hace la petición", async () => {
  const ctrl = new AbortController();
  ctrl.abort(new Error("cancelada antes"));
  await assert.rejects(fetchWith()("https://ejemplo.com/", { signal: ctrl.signal }), /cancelada antes/);
  assert.equal(net.requests.length, 0);
  const plain = new AbortController();
  plain.abort();
  await assert.rejects(fetchWith()("https://ejemplo.com/", { signal: plain.signal }), (e) => e.name === "AbortError");
});

test("cancelar a mitad aborta la petición; cancelar después de terminar no hace nada", async () => {
  const ctrl = new AbortController();
  net.onRequest = () => ctrl.abort();
  await assert.rejects(fetchWith()("https://ejemplo.com/lenta", { signal: ctrl.signal }), (e) => e.name === "AbortError");
  assert.equal(net.requests[0].aborted, true);
  // Una respuesta que llega tras cancelar no cambia el resultado.
  respond(net.requests[0], { chunks: ["tarde"] });

  const done = new AbortController();
  net.onRequest = (req) => respond(req, { chunks: ["ok"] });
  const res = await fetchWith()("https://ejemplo.com/", { signal: done.signal });
  done.abort();
  assert.equal(await res.text(), "ok");
  assert.equal(net.requests[1].aborted, false);
});
