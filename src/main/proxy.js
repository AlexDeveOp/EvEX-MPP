// Proxies de salida (SOCKS5, HTTP y HTTPS): túneles a un destino, un reenviador local de una sola conexión
// para xmpp.js y un puente HTTP local para Chromium. Solo usa módulos de Node; nunca conecta directo si el proxy falla.
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import crypto from "node:crypto";
import { once } from "node:events";
import { t, tk } from "./i18n.js";

export const PROXY_TYPES = ["socks5", "http", "https"];
export const DEFAULT_PORTS = { socks5: 1080, http: 8080, https: 443 };

// Tipo válido (si no lo es, socks5), servidor recortado (sin corchetes de IPv6), puerto 1-65535 o el del tipo.
export function normalizeProxy(p) {
  const raw = String(p?.type || "").trim().toLowerCase();
  const type = PROXY_TYPES.includes(raw) ? raw : "socks5";
  const host = String(p?.host || "").trim().replace(/^\[(.*)\]$/, "$1");
  const n = Number(p?.port);
  const port = Number.isInteger(n) && n >= 1 && n <= 65535 ? n : DEFAULT_PORTS[type];
  return { type, host, port, username: String(p?.username || "").trim() };
}

function proxyError(code, message) {
  return Object.assign(new Error(message), { code });
}

const hostPort = (host, port) => `${net.isIPv6(host) ? `[${host}]` : host}:${port}`;
const basicAuth = (user, pass) => `Basic ${Buffer.from(`${user}:${pass ?? ""}`).toString("base64")}`;

const SOCKS_REPLIES = {
  1: tk("fallo general del servidor SOCKS"),
  2: tk("conexión no permitida por las reglas del proxy"),
  3: tk("red inaccesible"),
  4: tk("equipo inaccesible"),
  5: tk("conexión rechazada"),
  6: tk("tiempo agotado"),
  7: tk("orden no admitida"),
  8: tk("tipo de dirección no admitido"),
};

// Lector con búfer sobre un socket durante el saludo con el proxy. release() lo deja en pausa y devuelve
// al socket (unshift) los bytes que sobraron, para que el primero que lo lea después no pierda nada.
function reader(sock) {
  let buf = Buffer.alloc(0);
  let ended = null;
  let check = null;
  const onData = (d) => {
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    check?.();
  };
  const onEnd = () => {
    ended ??= proxyError("PROXY_PROTOCOL", t("Respuesta no válida del proxy: {detail}", { detail: t("el proxy cerró la conexión") }));
    check?.();
  };
  sock.on("data", onData);
  sock.on("end", onEnd);
  sock.on("close", onEnd);
  const wait = (take) =>
    new Promise((resolve, reject) => {
      check = () => {
        let r;
        try {
          r = take();
        } catch (err) {
          check = null;
          return reject(err);
        }
        if (r !== undefined) {
          check = null;
          resolve(r);
        } else if (ended) {
          check = null;
          reject(ended);
        }
      };
      check();
    });
  const cut = (n) => {
    const out = buf.subarray(0, n);
    buf = buf.subarray(n);
    return out;
  };
  return {
    bytes: (n) => wait(() => (buf.length >= n ? cut(n) : undefined)),
    // Hasta la línea en blanco de una respuesta HTTP (incluida), con un tope para no crecer sin fin.
    headers: () =>
      wait(() => {
        const i = buf.indexOf("\r\n\r\n");
        if (i >= 0) return cut(i + 4).toString("latin1");
        if (buf.length > 16384) throw proxyError("PROXY_PROTOCOL", t("Respuesta no válida del proxy: {detail}", { detail: t("cabecera HTTP demasiado larga") }));
        return undefined;
      }),
    release() {
      sock.pause();
      sock.off("data", onData);
      sock.off("end", onEnd);
      sock.off("close", onEnd);
      if (buf.length) sock.unshift(buf);
      buf = Buffer.alloc(0);
      // Queda en pausa explícita, y así un on("data") normal no lo haría fluir: se reanuda en cuanto alguien
      // empieza a leer (pipe() lo hace por su cuenta; reanudar dos veces no hace daño).
      const resumeOnRead = (event) => {
        if (event !== "data") return;
        sock.off("newListener", resumeOnRead);
        process.nextTick(() => sock.isPaused() && sock.resume());
      };
      sock.on("newListener", resumeOnRead);
    },
  };
}

async function socks5Handshake(sock, rd, proxy, host, port) {
  const user = proxy.username || "";
  const pass = proxy.password ?? "";
  sock.write(Buffer.from(user ? [5, 2, 0, 2] : [5, 1, 0]));
  const [ver, method] = await rd.bytes(2);
  if (ver !== 5) throw proxyError("PROXY_PROTOCOL", t("Respuesta no válida del proxy: {detail}", { detail: t("no es un servidor SOCKS5") }));
  if (method === 0xff) throw proxyError("PROXY_AUTH", user ? t("El proxy ha rechazado el usuario o la contraseña") : t("El proxy pide usuario y contraseña"));
  if (method === 2) {
    if (!user) throw proxyError("PROXY_AUTH", t("El proxy pide usuario y contraseña"));
    const u = Buffer.from(user);
    const p = Buffer.from(pass);
    if (u.length > 255 || p.length > 255) throw proxyError("PROXY_AUTH", t("El usuario o la contraseña del proxy son demasiado largos"));
    sock.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([p.length]), p]));
    const [, status] = await rd.bytes(2);
    if (status !== 0) throw proxyError("PROXY_AUTH", t("El proxy ha rechazado el usuario o la contraseña"));
  } else if (method !== 0) {
    throw proxyError("PROXY_PROTOCOL", t("Respuesta no válida del proxy: {detail}", { detail: t("método SOCKS5 desconocido") }));
  }
  // El destino va por nombre (ATYP 3): lo resuelve el proxy. Solo una IP literal va como IP.
  let addr;
  if (net.isIPv4(host)) addr = Buffer.from([1, ...host.split(".").map(Number)]);
  else if (net.isIPv6(host)) addr = Buffer.concat([Buffer.from([4]), ipv6Bytes(host)]);
  else {
    const name = Buffer.from(host);
    if (name.length > 255) throw proxyError("PROXY_TARGET", t("El proxy no ha podido conectar con {target}: {reason}", { target: host, reason: t("nombre demasiado largo") }));
    addr = Buffer.concat([Buffer.from([3, name.length]), name]);
  }
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(port);
  sock.write(Buffer.concat([Buffer.from([5, 1, 0]), addr, portBuf]));
  const [v, rep, , atyp] = await rd.bytes(4);
  if (v !== 5) throw proxyError("PROXY_PROTOCOL", t("Respuesta no válida del proxy: {detail}", { detail: t("no es un servidor SOCKS5") }));
  if (rep !== 0) {
    const reason = SOCKS_REPLIES[rep] ? t(SOCKS_REPLIES[rep]) : t("código {code}", { code: rep });
    throw proxyError("PROXY_TARGET", t("El proxy no ha podido conectar con {target}: {reason}", { target: hostPort(host, port), reason }));
  }
  // Dirección y puerto con los que el proxy se conectó: se leen para descartarlos.
  const addrLen = atyp === 1 ? 4 : atyp === 4 ? 16 : atyp === 3 ? (await rd.bytes(1))[0] : -1;
  if (addrLen < 0) throw proxyError("PROXY_PROTOCOL", t("Respuesta no válida del proxy: {detail}", { detail: t("tipo de dirección desconocido") }));
  await rd.bytes(addrLen + 2);
}

function ipv6Bytes(ip) {
  const [head, tail = ""] = ip.split("::");
  const parts = (s) => (s ? s.split(":") : []);
  const h = parts(head);
  const tl = parts(tail);
  const v4 = (arr) => {
    const last = arr.at(-1);
    if (last && last.includes(".")) {
      const b = last.split(".").map(Number);
      arr.splice(-1, 1, ((b[0] << 8) | b[1]).toString(16), ((b[2] << 8) | b[3]).toString(16));
    }
  };
  if (ip.includes("::")) v4(tl);
  else v4(h);
  const fill = Array(8 - h.length - tl.length).fill("0");
  const words = ip.includes("::") ? [...h, ...fill, ...tl] : h;
  const out = Buffer.alloc(16);
  words.forEach((w, i) => out.writeUInt16BE(parseInt(w || "0", 16), i * 2));
  return out;
}

async function httpConnectHandshake(sock, rd, proxy, host, port) {
  const target = hostPort(host, port);
  let req = `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n`;
  if (proxy.username) req += `Proxy-Authorization: ${basicAuth(proxy.username, proxy.password)}\r\n`;
  sock.write(`${req}\r\n`);
  const head = await rd.headers();
  const m = /^HTTP\/1\.[01] (\d{3})/.exec(head);
  if (!m) throw proxyError("PROXY_PROTOCOL", t("Respuesta no válida del proxy: {detail}", { detail: t("línea de estado no válida") }));
  const status = Number(m[1]);
  if (status === 407) throw proxyError("PROXY_AUTH", proxy.username ? t("El proxy ha rechazado el usuario o la contraseña") : t("El proxy pide usuario y contraseña"));
  if (status < 200 || status > 299) {
    throw proxyError("PROXY_TARGET", t("El proxy no ha podido conectar con {target}: {reason}", { target, reason: t("respuesta HTTP {status}", { status }) }));
  }
}

// Autoridades con las que se comprueba el certificado de un proxy HTTPS: las que trae Node y, además, las raíces
// instaladas en el sistema (almacén de Windows, llavero de macOS o /etc/ssl en Linux), como hace el navegador.
// Así vale el proxy de una empresa con su propia autoridad instalada en el PC; un certificado autofirmado sigue fallando.
// Se calcula una vez: leer el almacén del sistema cuesta un poco.
let trustedCAs = null;
export function proxyCAs() {
  if (!trustedCAs) {
    try {
      trustedCAs = [...new Set([...tls.getCACertificates("default"), ...tls.getCACertificates("system")])];
    } catch {
      trustedCAs = undefined; // Node sin getCACertificates: las raíces por defecto de Node
    }
  }
  return trustedCAs || undefined;
}

// Motivo comprensible de un certificado rechazado (el mensaje de Node va en inglés y trae pistas para programadores),
// o null si el error no es de certificado.
function certProblem(err) {
  switch (err?.code) {
    case "CERT_HAS_EXPIRED":
      return t("ha caducado");
    case "CERT_NOT_YET_VALID":
      return t("todavía no es válido");
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return t("es de otro servidor");
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return t("es autofirmado");
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "UNABLE_TO_GET_ISSUER_CERT":
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
      return t("lo emite una autoridad que este equipo no reconoce");
    case "CERT_REVOKED":
      return t("está revocado");
    default:
      return /CERT|certificate/i.test(`${err?.code} ${err?.message}`) ? t("no se ha podido verificar") : null;
  }
}

// Motivo comprensible de un fallo al llegar al proxy; si no se conoce, el mensaje de Node.
function netProblem(err) {
  switch (err?.code) {
    case "ECONNREFUSED":
      return t("rechaza la conexión (¿está encendido y es el puerto correcto?)");
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return t("no se encuentra ese servidor");
    case "ETIMEDOUT":
      return t("no responde");
    case "ECONNRESET":
    case "EPIPE":
      return t("ha cortado la conexión");
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return t("no se puede llegar a esa red");
    default:
      return err?.message || String(err);
  }
}

// Abre un túnel hasta targetHost:targetPort a través del proxy y devuelve el socket ya conectado al destino
// (para https, el TLSSocket con el proxy). Los errores llevan .code: PROXY_CONNECT, PROXY_AUTH, PROXY_TARGET,
// PROXY_TIMEOUT o PROXY_PROTOCOL. El nombre del destino nunca se resuelve aquí: lo resuelve el proxy.
export async function openTunnel(proxy, targetHost, targetPort, { timeout = 15000, tlsOptions } = {}) {
  const p = { ...normalizeProxy(proxy), password: proxy?.password ?? "" };
  if (!p.host) throw proxyError("PROXY_CONNECT", t("Falta el servidor del proxy"));
  const host = String(targetHost).trim().replace(/^\[(.*)\]$/, "$1");
  const port = Number(targetPort);
  const connectEvent = p.type === "https" ? "secureConnect" : "connect";
  const sock =
    p.type === "https"
      ? tls.connect({ host: p.host, port: p.port, servername: net.isIP(p.host) ? undefined : p.host, ALPNProtocols: ["http/1.1"], ca: proxyCAs(), ...tlsOptions })
      : net.connect({ host: p.host, port: p.port });
  let connected = false;
  let timer;
  const rd = reader(sock);
  const failed = new Promise((_, reject) => {
    sock.on("error", (err) =>
      reject(
        connected
          ? proxyError("PROXY_PROTOCOL", t("Respuesta no válida del proxy: {detail}", { detail: err.message }))
          : certProblem(err)
            ? proxyError("PROXY_CONNECT", t("El certificado del proxy {proxy} no es de confianza: {reason}", { proxy: hostPort(p.host, p.port), reason: certProblem(err) }))
            : proxyError("PROXY_CONNECT", t("No se pudo conectar con el proxy {proxy}: {reason}", { proxy: hostPort(p.host, p.port), reason: netProblem(err) })),
      ),
    );
    timer = setTimeout(() => reject(proxyError("PROXY_TIMEOUT", t("El proxy no ha respondido a tiempo ({seconds} s)", { seconds: Math.round(timeout / 1000) }))), timeout);
  });
  failed.catch(() => {});
  try {
    await Promise.race([once(sock, connectEvent), failed]);
    connected = true;
    const handshake = p.type === "socks5" ? socks5Handshake(sock, rd, p, host, port) : httpConnectHandshake(sock, rd, p, host, port);
    await Promise.race([handshake, failed]);
  } catch (err) {
    sock.destroy();
    throw err;
  } finally {
    clearTimeout(timer);
  }
  rd.release();
  sock.removeAllListeners("error");
  sock.on("error", () => {}); // a partir de aquí los errores los ve quien use el túnel
  return sock;
}

// Une dos sockets en ambos sentidos y cierra uno cuando el otro se cierra o falla.
function join(a, b) {
  a.pipe(b);
  b.pipe(a);
  const end = () => {
    a.destroy();
    b.destroy();
  };
  a.on("error", end);
  b.on("error", end);
  a.on("close", end);
  b.on("close", end);
}

// Reenviador local de una sola conexión: abre el túnel y escucha en 127.0.0.1 hasta que alguien se conecta.
// xmpp.js se conecta con un socket normal a ese puerto, así que STARTTLS y la negociación siguen como siempre.
export async function createForwarder(proxy, host, port, opts = {}) {
  const tunnel = await openTunnel(proxy, host, port, opts);
  const server = net.createServer();
  let client = null;
  const close = () => {
    clearTimeout(timer);
    server.close();
    tunnel.destroy();
    client?.destroy();
  };
  server.on("connection", (sock) => {
    if (client) return sock.destroy(); // solo una conexión
    client = sock;
    clearTimeout(timer);
    server.close();
    join(sock, tunnel);
  });
  server.on("error", close);
  const timer = setTimeout(() => !client && close(), opts.timeout ?? 15000);
  tunnel.once("close", () => !client && close());
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
  } catch (err) {
    close();
    throw err;
  }
  return { port: server.address().port, close };
}

// Nombre de cabecera HTTP válido (token de RFC 9110).
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

// Proxy HTTP local para Chromium (session.setProxy): atiende CONNECT y peticiones http:// con URI absoluta y las
// manda por el proxy que devuelva getProxy() en ese momento. Si no hay proxy o falla, responde 502: nunca conecta directo.
// Escucha solo en 127.0.0.1 y exige un usuario y una contraseña aleatorios, creados al arrancar y guardados solo en
// memoria: otro programa del PC no puede salir por el proxy configurado. La app se los da a Chromium con el evento
// «login» (ventanas y net.request; net.fetch no lo admite, ver net-fetch.js). La contraseña del proxy real la añade
// aquí y nunca sale de este proceso. Las cabeceras Proxy-* que lleguen se quitan antes de reenviar.
export async function startBridge(getProxy) {
  const sockets = new Set();
  const raw502 = "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
  const raw407 = 'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="EvEX-MPP"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n';
  const username = `evex-${crypto.randomBytes(6).toString("hex")}`;
  const password = crypto.randomBytes(24).toString("base64url");
  const expected = Buffer.from(`Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`);
  // Comparación en tiempo constante.
  const authorized = (req) => {
    const got = Buffer.from(String(req.headers["proxy-authorization"] || ""));
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  };
  const upstream = () => {
    try {
      return getProxy() || null;
    } catch {
      return null;
    }
  };
  const track = (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  };

  const server = http.createServer(async (req, res) => {
    if (!authorized(req)) {
      res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="EvEX-MPP"', Connection: "close" });
      return res.end();
    }
    let url;
    try {
      url = new URL(req.url);
    } catch {
      url = null;
    }
    if (!url || url.protocol !== "http:") {
      res.writeHead(400, { Connection: "close" });
      return res.end();
    }
    const p = upstream();
    if (!p) {
      res.writeHead(502, { Connection: "close" });
      return res.end();
    }
    let tunnel;
    try {
      tunnel = await openTunnel(p, url.hostname, Number(url.port) || 80);
    } catch {
      res.writeHead(502, { Connection: "close" });
      return res.end();
    }
    track(tunnel);
    const headers = { ...req.headers, connection: "close" };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    // Sin «agent»: con agent:false Node crea un agente propio que ignora createConnection y conectaría DIRECTO.
    // Sin host ni puerto en las opciones, por si acaso, para que no haya destino al que ir que no sea el túnel.
    const out = http.request({ method: req.method, path: `${url.pathname}${url.search}`, headers, createConnection: () => tunnel });
    out.on("response", (up) => {
      // Los nombres vienen del servidor remoto: se reenvía la lista [nombre, valor, …] (sin pasar por las propiedades de
      // un objeto, y conservando las repetidas) y solo con nombres válidos según HTTP (token de RFC 9110).
      const back = [];
      for (let i = 0; i + 1 < up.rawHeaders.length; i += 2) {
        const name = up.rawHeaders[i];
        if (HEADER_NAME.test(name)) back.push(name, up.rawHeaders[i + 1]);
      }
      res.writeHead(up.statusCode, up.statusMessage, back);
      up.pipe(res);
    });
    out.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { Connection: "close" });
      res.end();
      tunnel.destroy();
    });
    req.pipe(out);
  });

  server.on("connect", async (req, sock, head) => {
    sock.on("error", () => {});
    if (!authorized(req)) return sock.end(raw407);
    const m =/^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(req.url || "");
    const p = m && upstream();
    if (!p) return sock.end(raw502);
    let tunnel;
    try {
      tunnel = await openTunnel(p, m[1], Number(m[2]));
    } catch {
      return sock.end(raw502);
    }
    if (sock.destroyed) return tunnel.destroy();
    track(tunnel);
    sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head?.length) tunnel.write(head);
    join(sock, tunnel);
  });
  server.on("connection", track);
  server.on("clientError", (_err, sock) => sock.destroy());

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    port: server.address().port,
    username,
    password,
    close() {
      server.close();
      for (const s of sockets) s.destroy();
    },
  };
}

// Prueba un proxy abriendo un túnel hasta host:port y cerrándolo. Devuelve lo que tardó; si falla, el error de openTunnel.
export async function testProxy(proxy, host = "example.com", port = 443, opts) {
  const start = process.hrtime.bigint();
  const sock = await openTunnel(proxy, host, port, opts);
  const ms = Number((process.hrtime.bigint() - start) / 1000000n);
  sock.destroy();
  return { ms };
}
