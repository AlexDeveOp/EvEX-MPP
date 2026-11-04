// Una conexión XMPP por cuenta. Traduce stanzas a eventos simples ("event") que main.js reenvía a la interfaz.
import { client, xml, jid as parseJid } from "@xmpp/client";
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { t, tk } from "./i18n.js";
import ConnectionTLS from "@xmpp/tls/lib/Connection.js";
import { createForwarder } from "./proxy.js";
const NS = {
  ROSTER: "jabber:iq:roster",
  DISCO_INFO: "http://jabber.org/protocol/disco#info",
  DISCO_ITEMS: "http://jabber.org/protocol/disco#items",
  MUC: "http://jabber.org/protocol/muc",
  MUC_USER: "http://jabber.org/protocol/muc#user",
  MUC_ADMIN: "http://jabber.org/protocol/muc#admin",
  MUC_OWNER: "http://jabber.org/protocol/muc#owner",
  ATTENTION: "urn:xmpp:attention:0",
  DELAY: "urn:xmpp:delay",
  DELAY_LEGACY: "jabber:x:delay",
  CHATSTATES: "http://jabber.org/protocol/chatstates",
  RECEIPTS: "urn:xmpp:receipts",
  CORRECT: "urn:xmpp:message-correct:0",
  CARBONS: "urn:xmpp:carbons:2",
  FORWARD: "urn:xmpp:forward:0",
  VCARD: "vcard-temp",
  VCARD_UPDATE: "vcard-temp:x:update",
  PRIVATE: "jabber:iq:private",
  BOOKMARKS: "storage:bookmarks",
  CONFERENCE: "jabber:x:conference",
  VERSION: "jabber:iq:version",
  PING: "urn:xmpp:ping",
  RSM: "http://jabber.org/protocol/rsm",
  MAM: "urn:xmpp:mam:2",
  DATA: "jabber:x:data",
  OOB: "jabber:x:oob",
  STANZAS: "urn:ietf:params:xml:ns:xmpp-stanzas",
};

const FEATURES = [NS.DISCO_INFO, NS.MUC, NS.CHATSTATES, NS.RECEIPTS, NS.CORRECT, NS.VERSION, NS.PING, NS.CONFERENCE, NS.OOB, NS.ATTENTION, `${NS.VCARD_UPDATE}`];

const MUC_ERRORS = {
  conflict: tk("Ese apodo ya está en uso en la sala."),
  "not-authorized": tk("La sala requiere contraseña o la contraseña es incorrecta."),
  forbidden: tk("Estás vetado en esta sala."),
  "registration-required": tk("La sala es solo para miembros."),
  "item-not-found": tk("La sala no existe."),
  "not-allowed": tk("No tienes permiso para crear o entrar en esta sala."),
  "service-unavailable": tk("La sala está llena o no disponible."),
  timeout: tk("La sala no responde."),
  "jid-malformed": tk("Apodo no válido."),
};

// Sin respuesta del servidor en este tiempo, la entrada en una sala se da por fallida.
export const JOIN_TIMEOUT = 30000;
// Los cambios de presencia en las salas se mandan a la interfaz en lotes cada este tiempo.
export const OCCUPANT_BATCH_MS = 120;

// Reconexión. Cuando se cae la red, el socket muchas veces NO se cierra (Wi-Fi que se va, router que reinicia, NAT
// que olvida la conexión): sin estas comprobaciones la app se quedaba «conectada» o «conectando» para siempre.
// Ping al servidor cada PING_EVERY; sin respuesta en PING_TIMEOUT, la conexión se da por muerta y se rehace.
export const RECONNECT = { PING_EVERY: 30000, PING_TIMEOUT: 20000, STALL: 30000, SUPERVISE_EVERY: 5000, MAX_DELAY: 30000 };

// Errores de red: con ellos se sigue reintentando, porque la red puede volver. Los demás (contraseña, TLS, falta de
// mecanismo…) son definitivos.
const NETWORK_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN", "EPIPE", "PROXY_CONNECT", "PROXY_TIMEOUT", "PROXY_TARGET"]);
export function isNetworkError(err) {
  for (let e = err, i = 0; e && i < 5; e = e.cause, i++) {
    if (e.fatal || e.condition === "not-authorized") return false;
    if (NETWORK_CODES.has(e.code) || e.name === "TimeoutError") return true;
  }
  return false;
}

const bare = (j) => String(j || "").split("/")[0].toLowerCase();
const resourceOf = (j) => {
  const s = String(j || "");
  const i = s.indexOf("/");
  return i >= 0 ? s.slice(i + 1) : "";
};

function parseStamp(el) {
  const d = el.getChild("delay", NS.DELAY);
  if (d?.attrs.stamp) return Date.parse(d.attrs.stamp) || null;
  const legacy = el.getChild("x", NS.DELAY_LEGACY);
  if (legacy?.attrs.stamp) {
    const m = legacy.attrs.stamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2}:\d{2}:\d{2})/);
    if (m) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}Z`) || null;
  }
  return null;
}

function stanzaErrorText(el) {
  const err = el.getChild("error");
  if (!err) return t("Error desconocido");
  const text = err.getChildText("text", NS.STANZAS);
  const cond = err.children.find((c) => typeof c !== "string" && c.attrs?.xmlns === NS.STANZAS && c.name !== "text");
  return { condition: cond?.name || "undefined-condition", text: text || "" };
}

// Error de una petición iq (xmpp.js lanza StanzaError con .condition y .text) en palabras del usuario.
export function iqErrorMessage(err) {
  const c = err?.condition;
  if (c === "forbidden" || c === "not-allowed") return t("No tienes permiso para hacer eso en esta sala.");
  if (c === "item-not-found") return t("No se encuentra esa sala o ese usuario.");
  if (c === "remote-server-not-found" || c === "remote-server-timeout") return t("No se puede llegar a ese servidor.");
  if (c === "service-unavailable" || c === "feature-not-implemented") return t("El servidor no admite esa función.");
  if (c === "not-acceptable" || c === "bad-request") return err.text ? t("El servidor no lo acepta: {text}", { text: err.text }) : t("El servidor no lo acepta.");
  if (err?.name === "TimeoutError" || /timeout/i.test(err?.message || "")) return t("El servidor no ha respondido a tiempo.");
  return err?.text || err?.message || String(err);
}
async function friendly(promise) {
  try {
    return await promise;
  } catch (e) {
    const out = new Error(iqErrorMessage(e), { cause: e });
    out.condition = e?.condition || "";
    throw out;
  }
}

// «muc#roominfo_changesubject» de la información de la sala: true, false o null si el servidor no lo dice.
export function parseChangeSubject(value) {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

// Formulario de datos (XEP-0004) a un objeto sencillo para la interfaz.
export function parseDataForm(x) {
  if (!x) return { title: "", instructions: "", fields: [] };
  return {
    title: x.getChildText("title") || "",
    instructions: x.getChildren("instructions").map((i) => i.text()).join(" "),
    fields: x.getChildren("field").map((f) => ({
      var: f.attrs.var || "",
      type: f.attrs.type || "text-single",
      label: f.attrs.label || "",
      desc: f.getChildText("desc") || "",
      required: !!f.getChild("required"),
      values: f.getChildren("value").map((v) => v.text()),
      options: f.getChildren("option").map((o) => ({ label: o.attrs.label || o.getChildText("value") || "", value: o.getChildText("value") || "" })),
    })),
  };
}

// Respuesta a un formulario: cada campo con nombre (menos los de solo lectura) con su valor nuevo o el que traía.
// values[var] es una lista de cadenas; un booleano puede venir como true/false.
export function dataFormSubmit(fields, values = {}) {
  const x = xml("x", { xmlns: NS.DATA, type: "submit" });
  for (const f of fields) {
    if (!f.var || f.type === "fixed") continue;
    let v = Object.hasOwn(values, f.var) ? values[f.var] : f.values;
    if (typeof v === "boolean") v = [v ? "1" : "0"];
    else if (!Array.isArray(v)) v = [String(v ?? "")];
    if (f.type === "text-multi" || f.type === "jid-multi" || f.type === "list-multi") v = v.filter((s) => s !== "");
    x.append(xml("field", { var: f.var }, ...v.map((s) => xml("value", {}, String(s)))));
  }
  return x;
}

// ---------- proxy ----------

// Con proxy, xmpp.js se conecta a un puerto local de un solo uso que reenvía por el túnel del proxy (ver proxy.js).
// Así el socket sigue siendo un net.Socket normal (STARTTLS funciona) y el nombre del servidor lo resuelve el proxy.
// Con TLS directo (XEP-0368), el certificado se comprueba contra el dominio de la cuenta, como con STARTTLS: no contra
// 127.0.0.1 (el reenvío local) ni contra el servidor de conexión, que puede ser otro nombre o un .onion.
// xmpp.js llama a socketParameters() sin la cuenta, así que el dominio se deja aquí justo antes de conectar.
const tlsNames = new Map(); // servicio («xmpps://host:puerto») -> dominio de la cuenta

class DomainTLS extends ConnectionTLS {
  socketParameters(service) {
    const params = super.socketParameters(service);
    const name = params && tlsNames.get(service);
    return name ? { ...params, servername: name } : params;
  }
}

// connect() de xmpp.js calcula los parámetros del socket de forma síncrona: basta con dejar el dominio durante la llamada.
function connectWithDomain(entity, direct, service) {
  tlsNames.set(service, entity.options.domain);
  try {
    return direct.call(entity, service);
  } finally {
    tlsNames.delete(service);
  }
}

export function useProxy(xmpp, getProxy) {
  xmpp.transports = xmpp.transports.map((T) => (T === ConnectionTLS ? DomainTLS : T));
  const direct = xmpp.connect;
  // También vale para las reconexiones: xmpp.js vuelve a llamar a connect() con el servicio original.
  xmpp.connect = async function connect(service) {
    let fwd;
    let host;
    let proxy;
    try {
      proxy = await getProxy();
      if (!proxy) return connectWithDomain(this, direct, service);
    } catch (err) {
      err.fatal = true; // proxy mal configurado (PROXY_CONFIG)
      this.emit("error", err);
      throw err;
    }
    // Como hace xmpp.js al conectar: si no, tras un corte el estado sigue en «disconnect» y el aviso de abajo no se
    // emitiría (_status ignora un estado repetido).
    this._status("connecting", service);
    try {
      const url = new URL(service);
      host = url.hostname.replace(/^\[(.*)\]$/, "$1");
      fwd = await createForwarder(proxy, host, Number(url.port), { timeout: 20000 });
      service = `${url.protocol}//127.0.0.1:${fwd.port}`;
    } catch (err) {
      // Sin socket, xmpp.js no recibe «disconnect» y una reconexión no volvería a intentarlo nunca: se avisa a mano.
      // Un usuario rechazado por el proxy no se arregla reintentando: error definitivo, como una contraseña mala.
      if (err.code === "PROXY_AUTH") {
        err.fatal = true;
        this.emit("error", err);
      } else {
        this._status("disconnect", { clean: false, reason: err });
      }
      throw err;
    }
    try {
      return await connectWithDomain(this, direct, service);
    } catch (err) {
      fwd.close();
      throw err;
    }
  };
}

export class XmppAccount extends EventEmitter {
  constructor(acc, { avatarDir, version = "", getProxy = null }) {
    super();
    this.getProxy = getProxy; // async () => proxy con contraseña, o null para conectar directo
    this.acc = acc;
    this.avatarDir = avatarDir;
    this.version = version; // se responde a las consultas de versión (XEP-0092)
    this.xmpp = null;
    this.state = "offline";
    this.ownJid = null;
    this.presence = { show: "", status: "" };
    this.roster = new Map();
    this.presences = new Map(); // jid -> Map(recurso -> presencia), para reconstruir la interfaz
    this.rooms = new Map();
    this.serverFeatures = new Set();
    this.mamQueries = new Map(); // queryid -> resultados del archivo de mensajes que van llegando
    this.mam = false;
    this.serverInfo = null;
    this.avatarHash = "";
    this.avatarQueue = [];
    this.avatarPending = new Set();
    this.avatarActive = 0;
    this.pingTimer = null;
    this.supervisor = null; // vigila los reintentos de conexión (ver supervise)
    this.lastProgress = 0; // último cambio de estado de la conexión
    this.wantOnline = false;
    this.occBatch = [];
    this.occTimer = null;
  }

  event(type, data = {}) {
    // Los participantes pendientes salen antes que cualquier otro evento, para no alterar el orden.
    if (this.occBatch.length) this.flushOccupants();
    this.emit("event", { accountId: this.acc.id, type, ...data });
  }

  // Un cambio de participante va al lote, que sale como un solo evento «occupants»: { events: [{ room, occupant, … }] }.
  queueOccupant(e) {
    this.occBatch.push(e);
    this.occTimer ||= setTimeout(() => this.flushOccupants(), OCCUPANT_BATCH_MS);
  }

  flushOccupants() {
    clearTimeout(this.occTimer);
    this.occTimer = null;
    const events = this.occBatch;
    if (!events.length) return;
    this.occBatch = [];
    this.emit("event", { accountId: this.acc.id, type: "occupants", events });
  }

  joinDone(room) {
    room.joining = false;
    clearTimeout(room.joinTimer);
    room.joinTimer = null;
  }

  setState(state, error) {
    this.state = state;
    this.event("status", { state, error: error || null, show: this.presence.show, statusText: this.presence.status });
  }

  // ---------- conexión ----------

  async connect(password) {
    if (this.xmpp) await this.disconnect(true);
    const [local, domain] = this.acc.jid.split("@");
    if (!local || !domain) throw new Error(t("JID no válido (usuario@servidor)"));
    const host = this.acc.host || domain;
    const scheme = this.acc.security === "direct" ? "xmpps" : "xmpp";
    this.wantOnline = true;

    const xmpp = client({
      service: `${scheme}://${host}:${this.acc.port || (scheme === "xmpps" ? 5223 : 5222)}`,
      domain,
      resource: this.acc.resource || "EvEX-MPP",
      timeout: 20000,
      credentials: async (authenticate, mechanisms, _fast, entity) => {
        if (this.acc.security !== "opportunistic" && !entity.isSecure()) {
          throw Object.assign(new Error(t("El servidor no ofreció TLS y la cuenta lo exige.")), { fatal: true });
        }
        const mech = ["SCRAM-SHA-1", "PLAIN"].find((m) => mechanisms.includes(m) && (m !== "PLAIN" || entity.isSecure() || this.acc.security === "opportunistic"));
        if (!mech) throw Object.assign(new Error(t("Sin mecanismo de autenticación compatible ({join})", { join: mechanisms.join(", ") })), { fatal: true });
        await authenticate({ username: local, password }, mech);
      },
    });
    this.xmpp = xmpp;
    useProxy(xmpp, this.getProxy || (async () => null));

    xmpp.iqCallee.get(NS.VERSION, "query", () =>
      xml("query", { xmlns: NS.VERSION }, xml("name", {}, "EvEX-MPP"), xml("version", {}, this.version), xml("os", {}, process.platform)),
    );
    xmpp.iqCallee.get(NS.DISCO_INFO, "query", () =>
      xml("query", { xmlns: NS.DISCO_INFO }, xml("identity", { category: "client", type: "pc", name: "EvEX-MPP" }), ...FEATURES.map((v) => xml("feature", { var: v }))),
    );
    xmpp.iqCallee.set(NS.ROSTER, "query", (ctx) => {
      const from = ctx.stanza.attrs.from;
      if (from && bare(from) !== bare(this.ownJid)) return xml("error", { type: "cancel" }, xml("forbidden", NS.STANZAS));
      for (const item of ctx.element.getChildren("item")) this.applyRosterItem(item, true);
      return true;
    });

    xmpp.on("status", (s) => {
      this.lastProgress = Date.now();
      // Espera entre reintentos: 1 s tras perder una conexión que funcionaba, y el doble en cada fallo seguido.
      if (s === "online") xmpp.reconnect.delay = 1000;
      if (s === "disconnect" && this.state !== "online") xmpp.reconnect.delay = Math.min(xmpp.reconnect.delay * 2, RECONNECT.MAX_DELAY);
      if (s === "connecting" && this.state !== "online") this.setState("connecting");
      if (s === "disconnect") {
        this.presences.clear();
        // Tras un corte hay que volver a entrar en las salas: la sesión MUC anterior ya no existe.
        for (const r of this.rooms.values()) {
          r.joined = false;
          this.joinDone(r);
          r.occupants.clear();
        }
        if (this.wantOnline && this.state === "online") this.setState("reconnecting");
      }
    });
    // Un fallo de autenticación no siempre hace fallar start(): se rechaza a mano para no quedarse «conectando».
    let failStart;
    const startFailed = new Promise((_, reject) => (failStart = reject));
    startFailed.catch(() => {});
    xmpp.on("error", (err) => {
      const msg = this.describeError(err);
      // Errores que no se arreglan reintentando: contraseña, falta de TLS o de mecanismo de autenticación.
      if (err?.condition === "not-authorized" || err?.fatal) {
        failStart(err);
        this.wantOnline = false;
        clearInterval(this.supervisor);
        xmpp.reconnect.stop();
        xmpp.stop().catch(() => {});
        this.setState("error", msg);
      } else {
        this.event("error", { message: msg });
      }
    });
    xmpp.on("offline", () => {
      clearInterval(this.pingTimer);
      if (this.state !== "error") this.setState("offline");
      for (const r of this.rooms.values()) r.joined = false;
    });
    xmpp.on("stanza", (st) => {
      try {
        this.onStanza(st);
      } catch (e) {
        this.event("error", { message: t("Error procesando stanza: {message}", { message: e.message }) });
      }
    });
    xmpp.on("online", (address) => this.onOnline(address).catch((e) => this.event("error", { message: e.message })));

    this.setState("connecting");
    this.lastProgress = Date.now();
    clearInterval(this.supervisor);
    this.supervisor = setInterval(() => this.supervise(), RECONNECT.SUPERVISE_EVERY);
    try {
      await Promise.race([xmpp.start(), startFailed]);
    } catch (err) {
      if (this.state !== "error") {
        if (this.wantOnline && isNetworkError(err)) {
          // Sin red al conectar (p. ej. el PC arranca o despierta antes que el Wi-Fi): se sigue intentando en
          // segundo plano, y se avisa de por qué todavía no está conectada.
          this.setState("reconnecting", this.describeError(err));
          this.restartConnection();
        } else {
          this.wantOnline = false;
          clearInterval(this.supervisor);
          xmpp.reconnect.stop();
          await xmpp.stop().catch(() => {});
          this.setState("error", this.describeError(err));
        }
      }
      throw new Error(this.describeError(err), { cause: err });
    }
  }

  describeError(err) {
    if (!err) return t("Error desconocido");
    if (err.condition === "not-authorized") return t("Usuario o contraseña incorrectos.");
    if (err.code === "ENOTFOUND") return t("No se encuentra el servidor ({x}).", { x: err.hostname || "" });
    if (err.code === "ECONNREFUSED") return t("El servidor rechazó la conexión.");
    if (err.code === "ETIMEDOUT" || err.name === "TimeoutError") return t("Tiempo de espera agotado al conectar.");
    if (err.code === "ECONNRESET") return t("La conexión se cerró inesperadamente.");
    if (/certificate|CERT_/i.test(err.message || err.code || "")) return t("Problema con el certificado TLS: {message}", { message: err.message });
    return err.message || String(err);
  }

  async disconnect(silent) {
    this.wantOnline = false;
    clearInterval(this.pingTimer);
    clearInterval(this.supervisor);
    const xmpp = this.xmpp;
    this.xmpp = null;
    if (!xmpp) return;
    xmpp.reconnect.stop();
    try {
      if (xmpp.status === "online") {
        await xmpp.send(xml("presence", { type: "unavailable" }));
      }
      await Promise.race([xmpp.stop(), new Promise((r) => setTimeout(r, 3000))]);
    } catch {}
    xmpp.removeAllListeners();
    for (const r of this.rooms.values()) r.joined = false;
    if (!silent) this.setState("offline");
  }

  get online() {
    return this.xmpp?.status === "online";
  }

  async send(stanza) {
    if (!this.online) throw new Error(t("No conectado"));
    await this.xmpp.send(stanza);
  }

  async onOnline(address) {
    this.ownJid = address.toString();
    this.setState("online");
    this.event("self", { jid: this.ownJid });

    await this.fetchRoster().catch((e) => this.event("error", { message: t("Roster: {message}", { message: e.message }) }));
    await this.sendPresence();
    this.discoverServer().catch(() => {});
    this.loadOwnAvatar().catch(() => {});

    // Volver a entrar en las salas que estaban abiertas (reconexión). Las que ya se están uniendo en esta sesión
    // (p. ej. la autounión, lanzada al pasar a «online») se saltan: unirse otra vez vaciaría sus ocupantes.
    for (const [roomJid, r] of this.rooms) {
      if (r.wanted && !r.joined && !r.joining) this.joinRoom(roomJid, r.nick, r.password, this.historyOptions?.(roomJid)).catch(() => {});
    }
    if (this.acc.syncBookmarks) this.fetchBookmarks().catch(() => {});

    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.checkAlive(), RECONNECT.PING_EVERY);
  }

  // Ping al servidor. Una respuesta de error también vale (el servidor está ahí); solo el silencio indica que la
  // conexión ha muerto aunque el socket siga «abierto», y entonces se rehace.
  checkAlive() {
    const x = this.xmpp;
    if (!x || x.status !== "online") return;
    x.iqCaller.get(xml("ping", NS.PING), parseJid(this.ownJid).domain, RECONNECT.PING_TIMEOUT).catch((err) => {
      if (err?.name === "TimeoutError" && this.xmpp === x && x.status === "online") this.restartConnection();
    });
  }

  // Vigila los reintentos: si la conexión lleva STALL sin avanzar (p. ej. el TCP se abre pero el servidor no
  // contesta, con la red a medias), se corta para que xmpp.js lo intente otra vez. Sin esto se quedaba atascada.
  supervise() {
    const x = this.xmpp;
    if (!x || !this.wantOnline || this.state === "error" || x.status === "online") return;
    if (Date.now() - this.lastProgress < RECONNECT.STALL) return;
    this.restartConnection();
  }

  // Corta el socket actual: xmpp.js ve «disconnect» y programa otro intento. Si no hay socket, programa uno.
  restartConnection() {
    const x = this.xmpp;
    if (!x || !this.wantOnline) return;
    this.lastProgress = Date.now();
    const raw = x.socket?.socket || x.socket; // con TLS directo, el socket de verdad va dentro
    if (raw?.destroy) raw.destroy();
    else if (x.status === "disconnect") x.reconnect.scheduleReconnect();
  }

  // La red ha vuelto o el PC sale de suspensión: si está conectada, se comprueba ya; si no, se reintenta ya.
  nudge() {
    const x = this.xmpp;
    if (!x || !this.wantOnline || this.state === "error") return;
    if (x.status === "online") return this.checkAlive();
    x.reconnect.delay = 1000;
    this.restartConnection();
  }

  async discoverServer() {
    const domain = parseJid(this.ownJid).domain;
    const info = await this.xmpp.iqCaller.get(xml("query", NS.DISCO_INFO), domain);
    this.serverFeatures = new Set(info.getChildren("feature").map((f) => f.attrs.var));
    if (this.serverFeatures.has(NS.CARBONS)) {
      await this.xmpp.iqCaller.set(xml("enable", NS.CARBONS)).catch(() => {});
      this.carbons = true;
    }
    // El archivo de mensajes de cada usuario (XEP-0313) se anuncia en su propia dirección, no en la del servidor.
    const own = await this.xmpp.iqCaller.get(xml("query", NS.DISCO_INFO), bare(this.ownJid)).catch(() => null);
    const ownFeatures = new Set(own?.getChildren("feature").map((f) => f.attrs.var) || []);
    this.mam = ownFeatures.has(NS.MAM) || this.serverFeatures.has(NS.MAM);
    this.serverInfo = { carbons: !!this.carbons, mam: this.mam };
    this.event("server-info", { features: [...this.serverFeatures, ...ownFeatures], ...this.serverInfo });
  }

  // Mensajes de `withJid` guardados en el archivo del servidor desde `start` (ms), como mucho `max`. Devuelve
  // [{ ts, body, id }] de los que envió esa dirección. Lanza un error si el servidor no tiene archivo.
  async fetchArchive(withJid, start, { max = 300, pageSize = 100 } = {}) {
    if (!this.online || !this.mam) throw new Error(t("El servidor no guarda archivo de mensajes."));
    const out = [];
    let after = null;
    for (let page = 0; page < Math.ceil(max / pageSize); page++) {
      const queryid = crypto.randomUUID();
      const items = [];
      this.mamQueries.set(queryid, items);
      let fin;
      try {
        const form = xml(
          "x",
          { xmlns: NS.DATA, type: "submit" },
          xml("field", { var: "FORM_TYPE", type: "hidden" }, xml("value", {}, NS.MAM)),
          xml("field", { var: "with" }, xml("value", {}, withJid)),
          xml("field", { var: "start" }, xml("value", {}, new Date(start).toISOString())),
        );
        const rsm = xml("set", { xmlns: NS.RSM }, xml("max", {}, String(pageSize)), after ? xml("after", {}, after) : null);
        // La respuesta trae <fin>, no la misma <query>: se pide el iq entero.
        const res = await this.xmpp.iqCaller.request(xml("iq", { type: "set" }, xml("query", { xmlns: NS.MAM, queryid }, form, rsm)), 30000);
        fin = res.getChild("fin", NS.MAM);
      } finally {
        this.mamQueries.delete(queryid);
      }
      for (const m of items) if (bare(m.from) === bare(withJid) && m.body) out.push(m);
      after = fin?.getChild("set", NS.RSM)?.getChildText("last");
      if (fin?.attrs?.complete === "true" || !after || !items.length) break;
    }
    return out.slice(0, max);
  }

  // ---------- presencia ----------

  presenceStanza(attrs = {}) {
    const p = xml("presence", attrs);
    if (this.presence.show) p.append(xml("show", {}, this.presence.show));
    if (this.presence.status) p.append(xml("status", {}, this.presence.status));
    p.append(xml("priority", {}, String(this.acc.priority ?? 1)));
    p.append(xml("x", { xmlns: NS.VCARD_UPDATE }, this.avatarHash ? xml("photo", {}, this.avatarHash) : xml("photo")));
    return p;
  }

  async sendPresence() {
    if (!this.online) return;
    await this.send(this.presenceStanza());
    for (const [roomJid, r] of this.rooms) {
      if (r.joined) await this.send(this.presenceStanza({ to: `${roomJid}/${r.nick}` })).catch(() => {});
    }
  }

  async setPresence(show, status) {
    this.presence = { show: show || "", status: status ?? this.presence.status };
    await this.sendPresence();
    this.event("status", { state: this.state, show: this.presence.show, statusText: this.presence.status });
  }

  // ---------- roster ----------

  async fetchRoster() {
    const q = await this.xmpp.iqCaller.get(xml("query", NS.ROSTER));
    this.roster.clear();
    for (const item of q?.getChildren("item") || []) this.applyRosterItem(item, false);
    this.event("roster", { items: [...this.roster.values()] });
  }

  applyRosterItem(item, push) {
    const j = bare(item.attrs.jid);
    if (item.attrs.subscription === "remove") {
      this.roster.delete(j);
      if (push) this.event("roster-remove", { jid: j });
      return;
    }
    const entry = {
      jid: j,
      name: item.attrs.name || "",
      subscription: item.attrs.subscription || "none",
      ask: item.attrs.ask || "",
      groups: item.getChildren("group").map((g) => g.text()).filter(Boolean),
    };
    this.roster.set(j, entry);
    if (push) this.event("roster-item", { item: entry });
  }

  async rosterSet(jid, name, groups) {
    await this.xmpp.iqCaller.set(
      xml("query", NS.ROSTER, xml("item", { jid: bare(jid), ...(name ? { name } : {}) }, ...(groups || []).map((g) => xml("group", {}, g)))),
    );
  }

  async addContact(jid, name, groups) {
    await this.rosterSet(jid, name, groups);
    await this.send(xml("presence", { to: bare(jid), type: "subscribe" }));
  }

  async removeContact(jid) {
    await this.xmpp.iqCaller.set(xml("query", NS.ROSTER, xml("item", { jid: bare(jid), subscription: "remove" })));
  }

  async answerSubscription(jid, accept) {
    await this.send(xml("presence", { to: bare(jid), type: accept ? "subscribed" : "unsubscribed" }));
    if (accept && !this.roster.get(bare(jid))?.subscription?.match(/to|both/)) {
      await this.send(xml("presence", { to: bare(jid), type: "subscribe" }));
    }
  }

  // ---------- stanzas ----------

  onStanza(st) {
    if (st.is("presence")) return this.onPresence(st);
    if (st.is("message")) return this.onMessage(st);
  }

  onPresence(st) {
    const from = st.attrs.from || "";
    const fromBare = bare(from);
    const type = st.attrs.type || "";
    const room = this.rooms.get(fromBare);
    const mucUser = st.getChild("x", NS.MUC_USER);

    if (room && (mucUser || type === "error")) return this.onRoomPresence(room, fromBare, resourceOf(from), st, mucUser);

    if (type === "subscribe") return this.event("subscribe-request", { jid: fromBare, nick: st.getChildText("nick", "http://jabber.org/protocol/nick") || "" });
    if (type === "subscribed" || type === "unsubscribed" || type === "unsubscribe") return this.event("subscription", { jid: fromBare, type });
    if (type === "error") return;

    const avatar = this.photoHash(st);
    if (avatar) this.requestAvatar(fromBare, avatar);
    const p = {
      jid: fromBare,
      resource: resourceOf(from),
      available: type !== "unavailable",
      show: st.getChildText("show") || "",
      status: st.getChildText("status") || "",
      priority: Number(st.getChildText("priority") || 0),
      avatar,
    };
    if (!this.presences.has(fromBare)) this.presences.set(fromBare, new Map());
    if (p.available) this.presences.get(fromBare).set(p.resource, p);
    else this.presences.get(fromBare).delete(p.resource);
    this.event("presence", p);
  }

  photoHash(st) {
    const x = st.getChild("x", NS.VCARD_UPDATE);
    const h = x?.getChildText("photo");
    return h && /^[0-9a-f]{40}$/i.test(h) ? h.toLowerCase() : "";
  }

  onRoomPresence(room, roomJid, nick, st, mucUser) {
    const type = st.attrs.type || "";
    if (type === "error") {
      const { condition, text } = stanzaErrorText(st);
      room.joined = false;
      this.joinDone(room);
      if (condition !== "conflict") room.wanted = false;
      this.event("room-error", { room: roomJid, condition, message: text || (MUC_ERRORS[condition] ? t(MUC_ERRORS[condition]) : condition) });
      return;
    }
    const codes = new Set((mucUser?.getChildren("status") || []).map((s) => s.attrs.code));
    const item = mucUser?.getChild("item");
    const isSelf = codes.has("110") || nick === room.nick;
    const occ = {
      nick,
      role: item?.attrs.role || "none",
      affiliation: item?.attrs.affiliation || "none",
      jid: item?.attrs.jid ? bare(item.attrs.jid) : "",
      show: st.getChildText("show") || "",
      status: st.getChildText("status") || "",
      available: type !== "unavailable",
      self: isSelf,
      avatar: this.photoHash(st),
    };
    if (occ.avatar) this.requestAvatar(`${roomJid}/${nick}`, occ.avatar);

    if (type === "unavailable" && codes.has("303")) {
      const newNick = item?.attrs.nick;
      room.occupants.delete(nick);
      if (isSelf) room.nick = newNick;
      this.event("occupant-nick", { room: roomJid, old: nick, nick: newNick, self: isSelf });
      return;
    }

    if (type === "unavailable") {
      room.occupants.delete(nick);
      if (isSelf) {
        room.joined = false;
        room.wanted = false;
        room.occupants.clear();
        const actor = item?.getChild("actor")?.attrs.nick || "";
        const reason = item?.getChildText("reason") || "";
        this.event("room-left", { room: roomJid, kicked: codes.has("307"), banned: codes.has("301"), actor, reason, shutdown: codes.has("332") });
        return;
      }
      this.queueOccupant({ room: roomJid, occupant: occ, kicked: codes.has("307"), banned: codes.has("301") });
      return;
    }

    room.occupants.set(nick, occ);
    if (isSelf && !room.joined) {
      room.joined = true;
      this.joinDone(room);
      room.nick = nick;
      this.event("room-joined", {
        room: roomJid,
        nick,
        created: codes.has("201"),
        occupants: [...room.occupants.values()],
        role: occ.role,
        affiliation: occ.affiliation,
      });
      // ¿Pueden los participantes cambiar el tema? Lo dice la información de la sala; los moderadores siempre pueden.
      this.roomInfo(roomJid).then(
        (info) => {
          room.changeSubject = info.changeSubject;
          this.event("room-info", { room: roomJid, changeSubject: info.changeSubject });
        },
        () => {},
      );
      if (codes.has("201")) {
        // Sala nueva: aceptar la configuración por defecto para desbloquearla.
        this.xmpp.iqCaller.set(xml("query", "http://jabber.org/protocol/muc#owner", xml("x", { xmlns: NS.DATA, type: "submit" })), roomJid).catch(() => {});
      }
      return;
    }
    // Antes de entrar no se avisa: la lista completa llega con «room-joined».
    if (room.joined) this.queueOccupant({ room: roomJid, occupant: occ });
  }

  onMessage(st) {
    // Resultados del archivo de mensajes: se recogen para quien los pidió y no se tratan como mensajes nuevos.
    const mamResult = st.getChild("result", NS.MAM);
    if (mamResult) {
      const items = this.mamQueries.get(mamResult.attrs.queryid);
      if (!items || (st.attrs.from && bare(st.attrs.from) !== bare(this.ownJid))) return;
      const fwd = mamResult.getChild("forwarded", NS.FORWARD);
      const m = fwd?.getChild("message");
      if (m) items.push({ from: m.attrs.from || "", body: m.getChildText("body"), id: mamResult.attrs.id || "", ts: parseStamp(fwd) || parseStamp(m) || Date.now() });
      return;
    }
    const type = st.attrs.type || "normal";
    let from = st.attrs.from || "";
    let msg = st;
    let carbon = null;

    // Carbons: solo se aceptan si vienen de nuestra propia cuenta.
    const carbonEl = st.getChild("received", NS.CARBONS) || st.getChild("sent", NS.CARBONS);
    if (carbonEl) {
      if (bare(from) !== bare(this.ownJid)) return;
      const fwd = carbonEl.getChild("forwarded", NS.FORWARD)?.getChild("message");
      if (!fwd) return;
      msg = fwd;
      carbon = carbonEl.name;
      from = msg.attrs.from || "";
    }

    const mtype = msg.attrs.type || type;
    if (mtype === "error") {
      const { condition, text } = stanzaErrorText(msg);
      this.event("message-error", { conv: bare(from), id: msg.attrs.id, condition, message: text || condition });
      return;
    }

    // Invitaciones a salas (directas y mediadas)
    const direct = msg.getChild("x", NS.CONFERENCE);
    if (direct?.attrs.jid) {
      this.event("invite", { room: bare(direct.attrs.jid), from: bare(from), reason: direct.attrs.reason || "", password: direct.attrs.password || "" });
      return;
    }
    const mediated = msg.getChild("x", NS.MUC_USER)?.getChild("invite");
    if (mediated) {
      this.event("invite", { room: bare(from), from: bare(mediated.attrs.from), reason: mediated.getChildText("reason") || "", password: msg.getChild("x", NS.MUC_USER).getChildText("password") || "" });
      return;
    }

    const fromBare = bare(from);
    const room = mtype === "groupchat" ? this.rooms.get(fromBare) : null;

    // Recibos de entrega
    const received = msg.getChild("received", NS.RECEIPTS);
    if (received?.attrs.id && !carbon) this.event("receipt", { conv: fromBare, id: received.attrs.id });
    if (msg.getChild("request", NS.RECEIPTS) && msg.attrs.id && mtype !== "groupchat" && !carbon) {
      this.send(xml("message", { to: from, id: crypto.randomUUID() }, xml("received", { xmlns: NS.RECEIPTS, id: msg.attrs.id }))).catch(() => {});
    }

    const body = msg.getChildText("body");
    const subject = msg.getChild("subject");
    const ts = parseStamp(msg) || parseStamp(st);
    const stateEl = msg.children.find((c) => typeof c !== "string" && c.attrs?.xmlns === NS.CHATSTATES);

    if (room) {
      const nick = resourceOf(from);
      if (subject && !body) {
        room.subject = subject.text();
        this.event("subject", { room: fromBare, subject: room.subject, by: nick, ts });
        return;
      }
      if (stateEl && !body) {
        if (nick !== room.nick) this.event("chatstate", { conv: fromBare, nick, state: stateEl.name });
        return;
      }
      if (body == null) return;
      this.event("message", {
        conv: fromBare,
        convType: "groupchat",
        nick: nick || fromBare,
        fromJid: room.occupants.get(nick)?.jid || "",
        body,
        id: msg.attrs.id || "",
        stanzaId: msg.getChild("stanza-id", "urn:xmpp:sid:0")?.attrs.id || "",
        ts: ts || Date.now(),
        delayed: !!ts,
        outgoing: nick === room.nick,
        replaces: msg.getChild("replace", NS.CORRECT)?.attrs.id || "",
        oob: msg.getChild("x", NS.OOB)?.getChildText("url") || "",
        system: !nick,
      });
      return;
    }

    // Mensajes privados (incluye MUC-PM con from=sala/nick)
    const outgoing = carbon === "sent";
    const peer = outgoing ? msg.attrs.to || "" : from;
    const peerBare = bare(peer);
    const isMucPm = this.rooms.has(peerBare) && resourceOf(peer);
    const conv = isMucPm ? peer : peerBare;

    // Llamada de atención (XEP-0224, /buzz en Pidgin)
    if (msg.getChild("attention", NS.ATTENTION) && !outgoing) this.event("attention", { conv, nick: isMucPm ? resourceOf(peer) : this.roster.get(peerBare)?.name || peerBare.split("@")[0] });
    if (stateEl && body == null) {
      if (!outgoing) this.event("chatstate", { conv, state: stateEl.name });
      return;
    }
    if (body == null) return;
    this.event("message", {
      conv,
      convType: mtype === "headline" ? "headline" : "chat",
      nick: outgoing ? this.acc.alias || bare(this.ownJid).split("@")[0] : isMucPm ? resourceOf(peer) : this.roster.get(peerBare)?.name || peerBare.split("@")[0],
      fromJid: outgoing ? bare(this.ownJid) : peerBare,
      resource: resourceOf(peer),
      body,
      subject: subject?.text() || "",
      id: msg.attrs.id || "",
      ts: ts || Date.now(),
      delayed: !!ts,
      outgoing,
      carbon: !!carbon,
      replaces: msg.getChild("replace", NS.CORRECT)?.attrs.id || "",
      oob: msg.getChild("x", NS.OOB)?.getChildText("url") || "",
      mucPm: !!isMucPm,
    });
  }

  // ---------- envío ----------

  async sendMessage({ to, body, type, replaces, oob }) {
    const id = crypto.randomUUID();
    const isRoom = type === "groupchat";
    const m = xml("message", { to, type: isRoom ? "groupchat" : "chat", id }, xml("body", {}, body), xml("active", NS.CHATSTATES));
    if (!isRoom) m.append(xml("request", NS.RECEIPTS));
    if (replaces) m.append(xml("replace", { xmlns: NS.CORRECT, id: replaces }));
    // Adjunto (XEP-0066): los clientes que lo entienden muestran la imagen; el cuerpo lleva la misma URL para los demás.
    if (oob && /^https?:\/\//.test(oob)) m.append(xml("x", { xmlns: NS.OOB }, xml("url", {}, oob)));
    await this.send(m);
    if (!isRoom) {
      this.event("message", {
        conv: this.rooms.has(bare(to)) ? to : bare(to),
        convType: "chat",
        nick: this.acc.alias || this.acc.jid.split("@")[0],
        fromJid: bare(this.ownJid),
        body,
        id,
        ts: Date.now(),
        outgoing: true,
        replaces: replaces || "",
        oob: oob || "",
        mucPm: this.rooms.has(bare(to)),
      });
    }
    return id;
  }

  async sendChatState(to, state, isRoom) {
    if (!this.online) return;
    await this.send(xml("message", { to, type: isRoom ? "groupchat" : "chat" }, xml(state, NS.CHATSTATES), xml("no-store", "urn:xmpp:hints")));
  }

  // ---------- salas ----------

  async joinRoom(roomJid, nick, password, { historySince, maxStanzas } = {}) {
    roomJid = bare(roomJid);
    nick = nick || this.acc.nick || this.acc.jid.split("@")[0];
    let room = this.rooms.get(roomJid);
    if (!room) {
      room = { nick, password: password || "", joined: false, occupants: new Map(), subject: "", wanted: true };
      this.rooms.set(roomJid, room);
    }
    room.wanted = true;
    room.nick = nick;
    room.password = password || room.password;
    if (!this.online) return;
    room.joining = true;
    room.occupants.clear();
    clearTimeout(room.joinTimer);
    room.joinTimer = setTimeout(() => {
      if (!room.joining || this.rooms.get(roomJid) !== room) return;
      this.joinDone(room);
      this.event("room-error", { room: roomJid, condition: "timeout", message: t(MUC_ERRORS.timeout) });
    }, JOIN_TIMEOUT);
    const hist = {};
    if (historySince) hist.since = new Date(historySince).toISOString();
    hist.maxstanzas = String(maxStanzas ?? 50);
    const x = xml("x", { xmlns: NS.MUC }, xml("history", hist));
    if (room.password) x.append(xml("password", {}, room.password));
    const p = this.presenceStanza({ to: `${roomJid}/${nick}` });
    p.append(x);
    await this.send(p);
  }

  async leaveRoom(roomJid, reason) {
    roomJid = bare(roomJid);
    const room = this.rooms.get(roomJid);
    if (!room) return;
    room.wanted = false;
    clearTimeout(room.joinTimer);
    if (this.online && (room.joined || room.joining)) {
      await this.send(xml("presence", { to: `${roomJid}/${room.nick}`, type: "unavailable" }, reason ? xml("status", {}, reason) : null)).catch(() => {});
    }
    this.rooms.delete(roomJid);
  }

  async changeNick(roomJid, nick) {
    const room = this.rooms.get(bare(roomJid));
    if (!room) throw new Error(t("No estás en esa sala"));
    await this.send(this.presenceStanza({ to: `${bare(roomJid)}/${nick}` }));
  }

  // Devuelve el id del mensaje: si el servidor lo rechaza, el error llega con ese id («message-error»).
  async setSubject(roomJid, subject) {
    const id = crypto.randomUUID();
    await this.send(xml("message", { to: bare(roomJid), type: "groupchat", id }, xml("subject", {}, subject)));
    return id;
  }

  // Configuración de la sala (muc#owner): el formulario del servidor, en el idioma de la app si el servidor lo traduce.
  async getRoomConfig(roomJid, lang) {
    const iq = xml("iq", { type: "get", to: bare(roomJid), ...(lang ? { "xml:lang": lang } : {}) }, xml("query", NS.MUC_OWNER));
    const res = await friendly(this.xmpp.iqCaller.request(iq, 15000));
    return parseDataForm(res.getChild("query", NS.MUC_OWNER)?.getChild("x", NS.DATA));
  }

  async setRoomConfig(roomJid, fields, values) {
    await friendly(this.xmpp.iqCaller.set(xml("query", NS.MUC_OWNER, dataFormSubmit(fields, values)), bare(roomJid), 15000));
  }

  // /ping: tiempo de respuesta en ms (XEP-0199). Una respuesta de error también prueba que el otro lado está ahí.
  // (No confundir con la comprobación periódica de la conexión, que hace ping al propio servidor.)
  async pingJid(target) {
    const start = Date.now();
    try {
      await this.xmpp.iqCaller.get(xml("ping", NS.PING), target, 15000);
      return { ms: Date.now() - start, supported: true };
    } catch (e) {
      if (e?.condition === "service-unavailable" || e?.condition === "feature-not-implemented") return { ms: Date.now() - start, supported: false };
      throw new Error(iqErrorMessage(e), { cause: e });
    }
  }

  // /buzz: llamada de atención (XEP-0224).
  async sendAttention(to) {
    await this.send(xml("message", { to, type: "headline", id: crypto.randomUUID() }, xml("attention", NS.ATTENTION)));
  }

  async moderate(roomJid, { nick, jid, role, affiliation, reason }) {
    const attrs = {};
    if (nick) attrs.nick = nick;
    if (jid) attrs.jid = jid;
    if (role) attrs.role = role;
    if (affiliation) attrs.affiliation = affiliation;
    await friendly(this.xmpp.iqCaller.set(xml("query", NS.MUC_ADMIN, xml("item", attrs, reason ? xml("reason", {}, reason) : null)), bare(roomJid)));
  }

  async invite(roomJid, jid, reason) {
    await this.send(xml("message", { to: bare(jid) }, xml("x", { xmlns: NS.CONFERENCE, jid: bare(roomJid), ...(reason ? { reason } : {}) })));
  }

  roomSnapshot() {
    return [...this.rooms.entries()].map(([jid, r]) => ({ jid, nick: r.nick, joined: r.joined, subject: r.subject, changeSubject: r.changeSubject ?? null, occupants: [...r.occupants.values()] }));
  }

  // ---------- descubrimiento ----------

  async listRooms(server) {
    const out = [];
    let after = null;
    for (let page = 0; page < 50; page++) {
      const q = xml("query", NS.DISCO_ITEMS);
      if (after) q.append(xml("set", NS.RSM, xml("max", {}, "200"), xml("after", {}, after)));
      const res = await this.xmpp.iqCaller.get(q, server, 30000);
      const items = res.getChildren("item");
      for (const it of items) out.push({ jid: bare(it.attrs.jid), name: it.attrs.name || it.attrs.jid.split("@")[0] });
      const set = res.getChild("set", NS.RSM);
      const last = set?.getChildText("last");
      const count = Number(set?.getChildText("count") || 0);
      if (!set || !last || !items.length || (count && out.length >= count)) break;
      after = last;
    }
    return out;
  }

  async roomInfo(roomJid) {
    const res = await this.xmpp.iqCaller.get(xml("query", NS.DISCO_INFO), bare(roomJid), 15000);
    const identity = res.getChild("identity");
    const features = res.getChildren("feature").map((f) => f.attrs.var);
    const fields = {};
    for (const f of res.getChild("x", NS.DATA)?.getChildren("field") || []) fields[f.attrs.var] = f.getChildText("value") || "";
    return {
      jid: bare(roomJid),
      name: identity?.attrs.name || "",
      description: fields["muc#roominfo_description"] || "",
      subject: fields["muc#roominfo_subject"] || "",
      changeSubject: parseChangeSubject(fields["muc#roominfo_changesubject"]),
      occupants: fields["muc#roominfo_occupants"] ? Number(fields["muc#roominfo_occupants"]) : null,
      passwordProtected: features.includes("muc_passwordprotected"),
      membersOnly: features.includes("muc_membersonly"),
      moderated: features.includes("muc_moderated"),
      persistent: features.includes("muc_persistent"),
      public: features.includes("muc_public"),
    };
  }

  async discoItems(target) {
    const res = await this.xmpp.iqCaller.get(xml("query", NS.DISCO_ITEMS), target);
    return res.getChildren("item").map((i) => ({ jid: i.attrs.jid, name: i.attrs.name || "" }));
  }

  // ---------- marcadores (XEP-0048 sobre almacenamiento privado) ----------

  async fetchBookmarks() {
    const res = await this.xmpp.iqCaller.get(xml("query", NS.PRIVATE, xml("storage", NS.BOOKMARKS)));
    const rooms = (res?.getChild("storage", NS.BOOKMARKS)?.getChildren("conference") || []).map((c) => ({
      jid: bare(c.attrs.jid),
      name: c.attrs.name || "",
      autojoin: c.attrs.autojoin === "true" || c.attrs.autojoin === "1",
      nick: c.getChildText("nick") || "",
      password: c.getChildText("password") || "",
    }));
    this.event("bookmarks", { rooms });
    return rooms;
  }

  async saveBookmarks(rooms) {
    const storage = xml("storage", NS.BOOKMARKS);
    for (const r of rooms) {
      const c = xml("conference", { jid: r.jid, name: r.name || r.jid.split("@")[0], autojoin: r.autojoin ? "true" : "false" });
      if (r.nick) c.append(xml("nick", {}, r.nick));
      if (r.password) c.append(xml("password", {}, r.password));
      storage.append(c);
    }
    await this.xmpp.iqCaller.set(xml("query", NS.PRIVATE, storage));
  }

  // ---------- avatares (vCard) ----------

  avatarFile(hash) {
    for (const ext of ["png", "jpg", "gif", "webp"]) {
      const f = path.join(this.avatarDir, `${hash}.${ext}`);
      if (fs.existsSync(f)) return `${hash}.${ext}`;
    }
    return null;
  }

  requestAvatar(target, hash) {
    const existing = this.avatarFile(hash);
    if (existing) {
      this.event("avatar", { hash, file: existing });
      return;
    }
    if (this.avatarPending.has(hash)) return;
    this.avatarPending.add(hash);
    this.avatarQueue.push({ target, hash });
    this.pumpAvatars();
  }

  pumpAvatars() {
    while (this.avatarActive < 3 && this.avatarQueue.length && this.online) {
      const { target, hash } = this.avatarQueue.shift();
      this.avatarActive++;
      this.fetchVcardPhoto(target)
        .then((photo) => {
          if (!photo) return;
          const ext = /png/.test(photo.type) ? "png" : /gif/.test(photo.type) ? "gif" : /webp/.test(photo.type) ? "webp" : "jpg";
          fs.mkdirSync(this.avatarDir, { recursive: true });
          const file = `${hash}.${ext}`;
          fs.writeFileSync(path.join(this.avatarDir, file), photo.data);
          this.event("avatar", { hash, file });
        })
        .catch(() => {})
        .finally(() => {
          this.avatarActive--;
          this.pumpAvatars();
        });
    }
  }

  async fetchVcardPhoto(target) {
    const vc = await this.xmpp.iqCaller.get(xml("vCard", NS.VCARD), target, 20000);
    const photo = vc?.getChild("PHOTO");
    const bin = photo?.getChildText("BINVAL");
    if (!bin) return null;
    const data = Buffer.from(bin.replace(/\s+/g, ""), "base64");
    if (data.length > 2 * 1024 * 1024) return null;
    return { type: photo.getChildText("TYPE") || "image/png", data };
  }

  async loadOwnAvatar() {
    const photo = await this.fetchVcardPhoto(bare(this.ownJid)).catch(() => null);
    if (!photo) return;
    const hash = crypto.createHash("sha1").update(photo.data).digest("hex");
    if (hash !== this.avatarHash) {
      this.avatarHash = hash;
      this.requestAvatar(bare(this.ownJid), hash);
      await this.sendPresence();
    }
    this.event("own-avatar", { hash });
  }

  async setOwnAvatar(data, type) {
    const current = await this.xmpp.iqCaller.get(xml("vCard", NS.VCARD)).catch(() => null);
    const vc = xml("vCard", NS.VCARD);
    for (const child of current?.getChildElements() || []) if (child.name !== "PHOTO") vc.append(child);
    vc.append(xml("PHOTO", {}, xml("TYPE", {}, type), xml("BINVAL", {}, data.toString("base64"))));
    await this.xmpp.iqCaller.set(vc);
    const hash = crypto.createHash("sha1").update(data).digest("hex");
    this.avatarHash = hash;
    fs.mkdirSync(this.avatarDir, { recursive: true });
    fs.writeFileSync(path.join(this.avatarDir, `${hash}.${type.includes("png") ? "png" : "jpg"}`), data);
    this.event("avatar", { hash, file: this.avatarFile(hash) });
    this.event("own-avatar", { hash });
    await this.sendPresence();
  }
}
