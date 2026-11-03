// Proxy de pruebas (SOCKS5, HTTP o HTTPS con CONNECT), con usuario y contraseña opcionales.
// startFakeProxy({ type, auth: { username, password }?, tls: { key, cert }? }) → { port, close(), targets }
// targets apunta cada destino pedido tal y como llegó («host:port»), para comprobar que va por nombre.
// makeSelfSignedCert() crea un certificado autofirmado para localhost/127.0.0.1 con node:crypto (sin openssl).
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";
import { once } from "node:events";

export async function startFakeProxy({ type = "socks5", auth = null, tls: tlsOpts = null } = {}) {
  const targets = [];
  const sockets = new Set();
  const onConn = (sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => {});
    (type === "socks5" ? socks : connect)(sock, { auth, targets, sockets }).catch(() => sock.destroy());
  };
  const server = type === "https" ? tls.createServer({ ...(tlsOpts || makeSelfSignedCert()) }, onConn) : net.createServer(onConn);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    port: server.address().port,
    targets,
    close() {
      server.close();
      for (const s of sockets) s.destroy();
    },
  };
}

// Lee exactamente n bytes (o hasta \r\n\r\n si n es null) y devuelve también lo que sobró.
function readFrom(sock) {
  let buf = Buffer.alloc(0);
  let waiting = null;
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    waiting?.();
  });
  sock.on("end", () => waiting?.(true));
  return {
    read: (n) =>
      new Promise((resolve, reject) => {
        waiting = (ended) => {
          const i = n === null ? buf.indexOf("\r\n\r\n") : -1;
          if (n === null ? i >= 0 : buf.length >= n) {
            const k = n === null ? i + 4 : n;
            const out = buf.subarray(0, k);
            buf = buf.subarray(k);
            waiting = null;
            resolve(out);
          } else if (ended) reject(new Error("cerrado"));
        };
        waiting();
      }),
    rest: () => {
      sock.pause(); // lo que llegue hasta unirlo al destino se queda en el socket
      sock.removeAllListeners("data");
      const r = buf;
      buf = Buffer.alloc(0);
      return r;
    },
  };
}

function pipeTo(sock, rest, host, port, sockets, onFail, onOk) {
  const up = net.connect({ host, port });
  sockets.add(up);
  up.on("close", () => sockets.delete(up));
  up.once("error", (err) => onFail(err));
  up.once("connect", () => {
    onOk();
    if (rest.length) up.write(rest);
    sock.pipe(up);
    up.pipe(sock);
    up.on("close", () => sock.destroy());
    sock.on("close", () => up.destroy());
  });
}

async function socks(sock, { auth, targets, sockets }) {
  const r = readFrom(sock);
  const [ver, nm] = await r.read(2);
  if (ver !== 5) return sock.destroy();
  const methods = [...(await r.read(nm))];
  const want = auth ? 2 : 0;
  if (!methods.includes(want)) return sock.end(Buffer.from([5, 0xff]));
  sock.write(Buffer.from([5, want]));
  if (auth) {
    const [, ulen] = await r.read(2);
    const user = (await r.read(ulen)).toString();
    const [plen] = await r.read(1);
    const pass = (await r.read(plen)).toString();
    const ok = user === auth.username && pass === auth.password;
    sock.write(Buffer.from([1, ok ? 0 : 1]));
    if (!ok) return sock.end();
  }
  const [, cmd, , atyp] = await r.read(4);
  let host;
  if (atyp === 1) host = [...(await r.read(4))].join(".");
  else if (atyp === 3) host = (await r.read((await r.read(1))[0])).toString();
  else host = (await r.read(16)).toString("hex").match(/.{4}/g).join(":");
  const port = (await r.read(2)).readUInt16BE(0);
  targets.push(`${host}:${port}`);
  const reply = (rep) => Buffer.from([5, rep, 0, 1, 0, 0, 0, 0, 0, 0]);
  if (cmd !== 1) return sock.end(reply(7));
  const rest = r.rest();
  pipeTo(sock, rest, host, port, sockets, (err) => sock.end(reply(err.code === "ECONNREFUSED" ? 5 : 4)), () => sock.write(reply(0)));
}

async function connect(sock, { auth, targets, sockets }) {
  const r = readFrom(sock);
  const head = (await r.read(null)).toString("latin1");
  const [line, ...lines] = head.split("\r\n");
  const m = /^CONNECT (\S+) HTTP\/1\.[01]$/.exec(line);
  if (!m) return sock.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  if (auth) {
    const h = lines.find((l) => /^proxy-authorization:/i.test(l));
    const expected = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`;
    if (!h || h.slice(h.indexOf(":") + 1).trim() !== expected) return sock.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="fake"\r\n\r\n');
  }
  targets.push(m[1]);
  const hp = /^\[?([^\]]+?)\]?:(\d+)$/.exec(m[1]);
  const rest = r.rest();
  pipeTo(sock, rest, hp[1], Number(hp[2]), sockets, () => sock.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"), () => sock.write("HTTP/1.1 200 Connection established\r\n\r\n"));
}

// ---------- certificado autofirmado (X.509 v3, ECDSA P-256) escrito a mano en DER ----------

const derLen = (n) => {
  if (n < 128) return Buffer.from([n]);
  const b = [];
  for (let x = n; x; x >>= 8) b.unshift(x & 0xff);
  return Buffer.from([0x80 | b.length, ...b]);
};
const tlv = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
};
const seq = (...p) => tlv(0x30, ...p);
const oid = (s) => {
  const p = s.split(".").map(Number);
  const out = [40 * p[0] + p[1]];
  for (const v of p.slice(2)) {
    const b = [v & 0x7f];
    for (let x = v >> 7; x; x >>= 7) b.unshift((x & 0x7f) | 0x80);
    out.push(...b);
  }
  return tlv(0x06, Buffer.from(out));
};
const name = (cn) => seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, Buffer.from(cn)))));
const utcTime = (d) => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z"));

export function makeSelfSignedCert(cn = "localhost") {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const serial = crypto.randomBytes(8);
  serial[0] &= 0x7f;
  const now = Date.now();
  const ecdsaSha256 = seq(oid("1.2.840.10045.4.3.2"));
  const san = seq(oid("2.5.29.17"), tlv(0x04, seq(tlv(0x82, Buffer.from(cn)), tlv(0x87, Buffer.from([127, 0, 0, 1])))));
  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))), // versión 3
    tlv(0x02, serial),
    ecdsaSha256,
    name(cn),
    seq(utcTime(new Date(now - 86400000)), utcTime(new Date(now + 86400000))),
    name(cn),
    publicKey.export({ type: "spki", format: "der" }),
    tlv(0xa3, seq(san)),
  );
  const sig = crypto.sign("sha256", tbs, privateKey);
  const der = seq(tbs, ecdsaSha256, tlv(0x03, Buffer.concat([Buffer.from([0]), sig])));
  const cert = `-----BEGIN CERTIFICATE-----\n${der.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
  return { key: privateKey.export({ type: "pkcs8", format: "pem" }), cert };
}
