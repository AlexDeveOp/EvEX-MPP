import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { once } from "node:events";
import { PROXY_TYPES, DEFAULT_PORTS, normalizeProxy, openTunnel, createForwarder, startBridge, testProxy, proxyCAs } from "../../src/main/proxy.js";
import { startFakeProxy, makeSelfSignedCert } from "../fake-proxy.mjs";

const AUTH = { username: "piloto", password: "s3cr3to" };
const CERT = makeSelfSignedCert();
const TLS = { ca: [CERT.cert] };
let echo;
let echoPort;
let web;
let webPort;
const closers = [];

before(async () => {
  // Eco TCP: devuelve todo lo que recibe.
  echo = net.createServer((s) => {
    s.on("error", () => {});
    s.pipe(s);
  });
  echo.listen(0, "127.0.0.1");
  await once(echo, "listening");
  echoPort = echo.address().port;
  // Web de destino: responde con el método, la ruta y las cabeceras que le llegaron.
  web = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.setHeader("set-cookie", ["a=1", "b=2"]); // cabeceras repetidas: el puente debe dejarlas tal cual
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }));
    });
  });
  web.listen(0, "127.0.0.1");
  await once(web, "listening");
  webPort = web.address().port;
});
after(() => {
  echo.close();
  web.close();
  for (const c of closers) c();
});

async function fake(opts) {
  const p = await startFakeProxy({ ...opts, tls: opts.type === "https" ? CERT : undefined });
  closers.push(p.close);
  return p;
}
const proxyFor = (fp, type, auth) => ({ type, host: "localhost", port: fp.port, ...(auth || {}) });
const optsFor = (type) => (type === "https" ? { tlsOptions: TLS, timeout: 5000 } : { timeout: 5000 });

async function roundTrip(sock, text = "hola o7") {
  const got = once(sock, "data");
  sock.resume();
  sock.write(text);
  const [data] = await got;
  return data.toString();
}

// Un puerto donde no escucha nadie.
async function deadPort() {
  const s = net.createServer().listen(0, "127.0.0.1");
  await once(s, "listening");
  const { port } = s.address();
  s.close();
  await once(s, "close");
  return port;
}

test("normalizeProxy sanea el tipo, el servidor y el puerto", () => {
  assert.deepEqual(PROXY_TYPES, ["socks5", "http", "https"]);
  assert.deepEqual(DEFAULT_PORTS, { socks5: 1080, http: 8080, https: 443 });
  assert.deepEqual(normalizeProxy({ type: " HTTP ", host: "  proxy.ejemplo.com ", port: "3128", username: " ana " }), { type: "http", host: "proxy.ejemplo.com", port: 3128, username: "ana" });
  assert.deepEqual(normalizeProxy({ type: "https", host: "p", port: 0 }), { type: "https", host: "p", port: 443, username: "" });
  assert.deepEqual(normalizeProxy({ type: "gopher", host: "[::1]", port: 70000 }), { type: "socks5", host: "::1", port: 1080, username: "" });
  assert.deepEqual(normalizeProxy(null), { type: "socks5", host: "", port: 1080, username: "" });
});

for (const type of PROXY_TYPES) {
  for (const withAuth of [false, true]) {
    test(`eco a través de un proxy ${type} ${withAuth ? "con" : "sin"} usuario, y el destino va por nombre`, async () => {
      const fp = await fake({ type, auth: withAuth ? AUTH : null });
      const sock = await openTunnel(proxyFor(fp, type, withAuth ? AUTH : null), "localhost", echoPort, optsFor(type));
      assert.equal(await roundTrip(sock), "hola o7");
      sock.destroy();
      // El proxy recibió el NOMBRE del destino, no una IP resuelta aquí.
      assert.deepEqual(fp.targets, [`localhost:${echoPort}`]);
    });
  }
}

for (const type of PROXY_TYPES) {
  test(`proxy ${type}: credenciales malas o ausentes → PROXY_AUTH`, async () => {
    const fp = await fake({ type, auth: AUTH });
    await assert.rejects(openTunnel(proxyFor(fp, type, { username: "piloto", password: "mala" }), "localhost", echoPort, optsFor(type)), { code: "PROXY_AUTH" });
    await assert.rejects(openTunnel(proxyFor(fp, type), "localhost", echoPort, optsFor(type)), { code: "PROXY_AUTH" });
  });

  test(`proxy ${type}: destino caído → PROXY_TARGET con el motivo`, async () => {
    const fp = await fake({ type });
    const port = await deadPort();
    const err = await openTunnel(proxyFor(fp, type), "localhost", port, optsFor(type)).catch((e) => e);
    assert.equal(err.code, "PROXY_TARGET");
    assert.match(err.message, type === "socks5" ? /conexión rechazada/ : /HTTP 502/);
  });
}

test("SOCKS5: una IP literal de destino va como IPv4 o IPv6 (ATYP 1 o 4), bien codificada", async () => {
  const fp = await fake({ type: "socks5" });
  const port = await deadPort();
  for (const ip of ["127.0.0.1", "2001:db8::1", "::ffff:10.0.0.1", "fe80::"]) {
    await openTunnel(proxyFor(fp, "socks5"), ip, port, { timeout: 500 }).catch(() => {}); // el destino se apunta antes de conectar
  }
  assert.deepEqual(fp.targets, [
    `127.0.0.1:${port}`,
    `2001:0db8:0000:0000:0000:0000:0000:0001:${port}`,
    `0000:0000:0000:0000:0000:ffff:0a00:0001:${port}`,
    `fe80:0000:0000:0000:0000:0000:0000:0000:${port}`,
  ]);
});

test("proxy inalcanzable → PROXY_CONNECT; sin servidor → PROXY_CONNECT", async () => {
  const port = await deadPort();
  await assert.rejects(openTunnel({ type: "socks5", host: "127.0.0.1", port }, "localhost", echoPort), (err) => {
    assert.equal(err.code, "PROXY_CONNECT");
    // En el idioma de la app, sin «connect ECONNREFUSED …».
    assert.match(err.message, /rechaza la conexión/);
    assert.doesNotMatch(err.message, /ECONNREFUSED/);
    return true;
  });
  await assert.rejects(openTunnel({ type: "http", host: "" }, "localhost", echoPort), { code: "PROXY_CONNECT" });
});

test("proxy https con un certificado en el que no se confía → PROXY_CONNECT", async () => {
  const fp = await fake({ type: "https" });
  const err = await openTunnel(proxyFor(fp, "https"), "localhost", echoPort, { timeout: 5000 }).catch((e) => e);
  assert.equal(err.code, "PROXY_CONNECT");
  // Mensaje para el usuario, sin el inglés de Node ni sus pistas para programadores (--use-system-ca…).
  assert.match(err.message, /certificado del proxy .* no es de confianza: es autofirmado/);
  assert.doesNotMatch(err.message, /Node|--use|certificate/);
});

test("proxy que no contesta → PROXY_TIMEOUT", async () => {
  const mute = net.createServer((s) => s.on("error", () => {}));
  mute.listen(0, "127.0.0.1");
  await once(mute, "listening");
  closers.push(() => mute.close());
  const start = Date.now();
  await assert.rejects(openTunnel({ type: "http", host: "127.0.0.1", port: mute.address().port }, "localhost", echoPort, { timeout: 300 }), { code: "PROXY_TIMEOUT" });
  assert.ok(Date.now() - start < 3000);
});

test("respuestas que no son de un proxy → PROXY_PROTOCOL", async () => {
  const liar = net.createServer((s) => {
    s.on("error", () => {});
    s.once("data", () => s.end("SSH-2.0-OpenSSH_9.6\r\n\r\n"));
  });
  liar.listen(0, "127.0.0.1");
  await once(liar, "listening");
  closers.push(() => liar.close());
  for (const type of ["http", "socks5"]) {
    await assert.rejects(openTunnel({ type, host: "127.0.0.1", port: liar.address().port }, "localhost", echoPort, { timeout: 3000 }), { code: "PROXY_PROTOCOL" }, type);
  }
});

test("los bytes que llegan pegados a la respuesta del CONNECT no se pierden", async () => {
  const eager = net.createServer((s) => {
    s.on("error", () => {});
    s.once("data", () => s.write("HTTP/1.1 200 Connection established\r\n\r\nBIENVENIDO"));
  });
  eager.listen(0, "127.0.0.1");
  await once(eager, "listening");
  closers.push(() => eager.close());
  const sock = await openTunnel({ type: "http", host: "127.0.0.1", port: eager.address().port }, "destino.ejemplo", 5222);
  const [data] = await once(sock, "data");
  assert.equal(data.toString(), "BIENVENIDO");
  sock.destroy();
});

test("createForwarder: un puerto local de una sola conexión que va por el proxy", async () => {
  const fp = await fake({ type: "socks5", auth: AUTH });
  const fw = await createForwarder(proxyFor(fp, "socks5", AUTH), "localhost", echoPort, { timeout: 5000 });
  const sock = net.connect(fw.port, "127.0.0.1");
  await once(sock, "connect");
  assert.equal(await roundTrip(sock, "<stream:stream>"), "<stream:stream>");
  // Una segunda conexión ya no se acepta.
  const second = net.connect(fw.port, "127.0.0.1");
  const [err] = await once(second, "error").catch((e) => [e]);
  assert.ok(err, "la segunda conexión falla");
  // Al cerrar el cliente se cierra el túnel.
  sock.destroy();
  fw.close();
});

test("createForwarder: si el túnel falla lanza el error, y si nadie se conecta a tiempo lo cierra todo", async () => {
  const fp = await fake({ type: "http", auth: AUTH });
  await assert.rejects(createForwarder(proxyFor(fp, "http"), "localhost", echoPort), { code: "PROXY_AUTH" });
  const fw = await createForwarder(proxyFor(fp, "http", AUTH), "localhost", echoPort, { timeout: 200 });
  await new Promise((r) => setTimeout(r, 400));
  const late = net.connect(fw.port, "127.0.0.1");
  const [err] = await once(late, "error").catch((e) => [e]);
  assert.equal(err.code, "ECONNREFUSED");
});

// Petición en crudo al puente; devuelve la primera línea, las cabeceras y el resto.
// (Con eventos y no con for await: salir de un for await destruye el socket, y el túnel se sigue usando).
async function rawRequest(port, text) {
  const s = net.connect(port, "127.0.0.1");
  await once(s, "connect");
  s.write(text);
  let buf = "";
  await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      buf += chunk.toString();
      if (buf.includes("\r\n\r\n") && (/^HTTP\/1\.1 200 Connection/.test(buf) || /content-length: 0/i.test(buf) || buf.endsWith("}"))) {
        s.off("data", onData);
        s.pause();
        resolve();
      }
    };
    s.on("data", onData);
    s.once("error", reject);
    s.once("end", resolve);
  });
  return { s, text: buf };
}

test("puente para Chromium: exige sus credenciales; CONNECT y GET absoluto por el proxy; 502 sin proxy", async () => {
  const fp = await fake({ type: "socks5", auth: AUTH });
  let current = proxyFor(fp, "socks5", AUTH);
  const bridge = await startBridge(() => current);
  closers.push(bridge.close);
  assert.ok(bridge.port > 0);
  assert.ok(bridge.username && bridge.password.length >= 24, "credenciales aleatorias");
  const basic = (u, p) => `Proxy-Authorization: Basic ${Buffer.from(`${u}:${p}`).toString("base64")}\r\n`;
  const auth = basic(bridge.username, bridge.password);

  // Sin credenciales o con otras: 407, y no se abre nada en el proxy (otro programa del PC no puede usarlo).
  for (const extra of ["", basic(bridge.username, "otra"), basic("x", "y")]) {
    for (const req of [`CONNECT localhost:${echoPort} HTTP/1.1\r\n${extra}\r\n`, `GET http://localhost:${webPort}/ HTTP/1.1\r\nHost: x\r\n${extra}\r\n`]) {
      const r = await rawRequest(bridge.port, req);
      assert.match(r.text, /^HTTP\/1\.1 407/);
      assert.match(r.text, /Proxy-Authenticate: Basic/i);
      r.s.destroy();
    }
  }
  assert.deepEqual(fp.targets, []);

  // CONNECT (HTTPS): túnel hasta el eco por el proxy (con su usuario y contraseña, que pone el puente).
  const c = await rawRequest(bridge.port, `CONNECT localhost:${echoPort} HTTP/1.1\r\nHost: localhost:${echoPort}\r\n${auth}\r\n`);
  assert.match(c.text, /^HTTP\/1\.1 200 Connection Established/);
  assert.equal(await roundTrip(c.s, "dentro del túnel"), "dentro del túnel");
  c.s.destroy();

  // GET con URI absoluta: llega en forma de origen y sin las cabeceras del proxy.
  const g = await rawRequest(bridge.port, `GET http://localhost:${webPort}/ruta?a=1 HTTP/1.1\r\nHost: localhost:${webPort}\r\n${auth}Proxy-Connection: keep-alive\r\n\r\n`);
  assert.match(g.text, /^HTTP\/1\.1 200 OK/);
  const body = JSON.parse(g.text.slice(g.text.indexOf("{")));
  assert.equal(body.url, "/ruta?a=1");
  assert.equal(body.headers["proxy-authorization"], undefined);
  assert.equal(body.headers["proxy-connection"], undefined);
  g.s.destroy();
  assert.deepEqual(fp.targets, [`localhost:${echoPort}`, `localhost:${webPort}`]);
  // La respuesta llega tal cual, sin reinterpretar: las cabeceras repetidas siguen ahí.
  assert.match(g.text, /set-cookie: a=1\r\nset-cookie: b=2/i);

  // Cuerpos: con longitud fija y troceado (chunked), que el puente vuelve a trocear hacia el servidor.
  const post = await rawRequest(bridge.port, `POST http://localhost:${webPort}/p HTTP/1.1\r\nHost: localhost:${webPort}\r\n${auth}Content-Length: 5\r\n\r\nhola!`);
  assert.equal(JSON.parse(post.text.slice(post.text.indexOf("{"))).body, "hola!");
  post.s.destroy();
  const ch = await rawRequest(bridge.port, `POST http://localhost:${webPort}/c HTTP/1.1\r\nHost: localhost:${webPort}\r\n${auth}Transfer-Encoding: chunked\r\n\r\n4\r\nhola\r\n6\r\n mundo\r\n0\r\n\r\n`);
  const chBody = JSON.parse(ch.text.slice(ch.text.indexOf("{")));
  assert.equal(chBody.body, "hola mundo");
  assert.equal(chBody.headers["transfer-encoding"], "chunked");
  ch.s.destroy();

  // Sin proxy configurado: 502 y nunca conexión directa.
  current = null;
  const before = fp.targets.length;
  for (const req of [`CONNECT localhost:${echoPort} HTTP/1.1\r\n${auth}\r\n`, `GET http://localhost:${webPort}/ HTTP/1.1\r\nHost: x\r\n${auth}\r\n`]) {
    const r = await rawRequest(bridge.port, req);
    assert.match(r.text, /^HTTP\/1\.1 502/);
    r.s.destroy();
  }
  assert.equal(fp.targets.length, before);

  // El proxy de verdad falla (credenciales malas): también 502.
  current = proxyFor(fp, "socks5", { username: "piloto", password: "mala" });
  const bad = await rawRequest(bridge.port, `CONNECT localhost:${echoPort} HTTP/1.1\r\n${auth}\r\n`);
  assert.match(bad.text, /^HTTP\/1\.1 502/);
  bad.s.destroy();
});

test("testProxy mide el tiempo del túnel y lanza el mismo error que openTunnel", async () => {
  const fp = await fake({ type: "http" });
  const { ms } = await testProxy(proxyFor(fp, "http"), "localhost", echoPort);
  assert.ok(Number.isInteger(ms) && ms >= 0 && ms < 5000);
  await assert.rejects(testProxy(proxyFor(fp, "http"), "localhost", await deadPort()), { code: "PROXY_TARGET" });
});

test("el certificado de un proxy HTTPS se comprueba también con las raíces del sistema (CA de empresa)", async () => {
  const tls = await import("node:tls");
  const cas = proxyCAs();
  assert.ok(Array.isArray(cas) && cas.length > 0);
  for (const c of tls.getCACertificates("default")) assert.ok(cas.includes(c), "incluye las de Node");
  for (const c of tls.getCACertificates("system")) assert.ok(cas.includes(c), "incluye las del sistema");
  assert.equal(proxyCAs(), cas, "se calcula una sola vez");
});
