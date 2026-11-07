// Modo FC, núcleo de envío: plantilla, plan por grupo (los dos modos), respuesta del bot y el envío por la cuenta con
// su espera de 15 s. El texto llega TAL CUAL, con sus caracteres invisibles (se construyen con fromCharCode).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { renderTemplate, buildPlan, SEND_MODES, interpretReply, toPattern, isBroadcastEcho } from "../../src/renderer/js/fc-send.js";
import { sendPlan, FC_REPLY_MS } from "../../src/main/fc-ipc.js";

const [ZW, ZNJ, ZWJ] = [0x200b, 0x200c, 0x200d].map((c) => String.fromCharCode(c));
const NL = String.fromCharCode(10);
const GROUPS = [
  { name: "all", address: "all@pings.ejemplo.com" },
  { name: "caps", address: "caps@pings.ejemplo.com" },
];
const PING = `Capital${ZW} fleet up${ZNJ}${NL}FC Name:${ZWJ} Bob FC${NL}Formup Location: Jita`;

// ---------- plantilla ----------

test("renderTemplate rellena los campos y quita las líneas de los que faltan, con su etiqueta", () => {
  const format = ["{type} fleet up", "FC: {fc}", "Formup: {time} EVE · {place}", "Doctrine: {doctrine}", "", "{notes}"].join(NL);
  assert.equal(renderTemplate(format, { type: "Capital", fc: "Bob FC", time: "19:00", place: "Jita", doctrine: "", notes: "Bring caps" }), ["Capital fleet up", "FC: Bob FC", "Formup: 19:00 EVE · Jita", "", "Bring caps"].join(NL));
  // Falta un trozo de una línea: se va con su separador; el resto se queda.
  assert.equal(renderTemplate("Formup: {time} EVE · {place}", { time: "", place: "Jita" }), "Jita");
  assert.equal(renderTemplate("FC {fc} | Comms {comms}", { fc: "Bob FC", comms: "" }), "FC Bob FC");
  // Al quitar la línea de en medio no quedan dos líneas en blanco seguidas.
  assert.equal(renderTemplate(["Op", "", "{notes}", "", "Bye"].join(NL), { notes: "" }), ["Op", "", "Bye"].join(NL));
  // Las llaves que no son de un campo se quedan.
  assert.equal(renderTemplate("Use {curly} {fc}", { fc: "Bob" }), "Use {curly} Bob");
});

test("renderTemplate deja los valores TAL CUAL, con sus invisibles y espacios", () => {
  assert.equal(renderTemplate("FC: {fc}", { fc: `${ZW} Bob${ZNJ} ` }), `FC: ${ZW} Bob${ZNJ} `);
});

// ---------- plan ----------

test("buildPlan, una dirección por grupo: un mensaje por grupo con el texto tal cual", () => {
  const plan = buildPlan({ mode: "address", groups: GROUPS, text: PING });
  assert.deepEqual(plan, [
    { group: "all", to: "all@pings.ejemplo.com", body: PING },
    { group: "caps", to: "caps@pings.ejemplo.com", body: PING },
  ]);
  // Los invisibles llegan intactos, uno a uno.
  for (const p of plan) for (const ch of [ZW, ZNJ, ZWJ]) assert.ok(p.body.includes(ch));
});

test("buildPlan, línea al principio: todo al canal del bot, con la línea del grupo y el texto debajo", () => {
  const plan = buildPlan({ mode: "line", groups: GROUPS, linePrefix: "!ping {grupo}", botJid: "pings-bot@ejemplo.com", text: PING });
  assert.deepEqual(
    plan.map((p) => [p.group, p.to, p.body]),
    [
      ["all", "pings-bot@ejemplo.com", `!ping all${NL}${PING}`],
      ["caps", "pings-bot@ejemplo.com", `!ping caps${NL}${PING}`],
    ],
  );
  assert.equal(buildPlan({ mode: "line", groups: [GROUPS[0]], linePrefix: "/broadcast {group}", botJid: "b@ejemplo.com", text: "x" })[0].body, `/broadcast all${NL}x`);
});

test("buildPlan: errores claros y la estructura lista para un tercer modo", () => {
  assert.throws(() => buildPlan({ mode: "otro", groups: GROUPS, text: "x" }), /modo de envío desconocido/);
  assert.throws(() => buildPlan({ mode: "address", groups: [], text: "x" }), /no hay grupos/);
  assert.throws(() => buildPlan({ mode: "address", groups: GROUPS, text: "" }), /no hay texto/);
  assert.throws(() => buildPlan({ mode: "address", groups: [{ name: "x" }], text: "a" }), /no tiene dirección/);
  assert.throws(() => buildPlan({ mode: "line", groups: GROUPS, text: "a" }), /canal del bot/);
  assert.deepEqual(Object.keys(SEND_MODES), ["address", "line"]);
});

// ---------- respuesta ----------

test("interpretReply: sin respuesta nunca es «sent»; error y rechazo, «rejected»; éxito solo si lo dice", () => {
  assert.deepEqual(interpretReply(null), { status: "unconfirmed", reason: "timeout" });
  assert.equal(interpretReply({ error: { condition: "forbidden", text: "" } }).status, "rejected");
  assert.equal(interpretReply({ error: { condition: "forbidden", text: "" } }).reason, "forbidden");
  assert.equal(interpretReply({ body: "Ping sent to all" }).status, "sent");
  assert.equal(interpretReply({ body: "Permission denied: you can't ping caps" }).status, "rejected");
  assert.equal(interpretReply({ body: "hmm?" }).status, "unconfirmed");
  // Un rechazo manda aunque diga «sent» también.
  assert.equal(interpretReply({ body: "not sent: permission denied" }).status, "rejected");
  // Texto propio de éxito o de rechazo.
  assert.equal(interpretReply({ body: "Broadcast OK" }, { sentPattern: "broadcast ok" }).status, "sent");
  assert.equal(interpretReply({ body: "Nope." }, { rejectedPattern: "/^nope/" }).status, "rejected");
  assert.equal(toPattern("/(/"), null, "una expresión mal escrita no rompe nada");
});

test("isBroadcastEcho reconoce el propio ping reenviado por el bot", () => {
  assert.ok(isBroadcastEcho(`${PING}${NL}${NL}~~~ This was a coord broadcast from bob to all at 2026-11-07 18:00:00 EVE ~~~`));
  assert.ok(!isBroadcastEcho("Ping sent to all"));
});

// ---------- envío por la cuenta ----------

// Cuenta falsa: guarda lo enviado y deja que el test emita respuestas como lo haría XmppAccount.
function fakeAccount({ fail } = {}) {
  const x = new EventEmitter();
  x.sent = [];
  let n = 0;
  x.sendMessage = async (m) => {
    if (fail) throw new Error("No conectado");
    x.sent.push(m);
    const id = `id-${++n}`;
    x.emit("sent", { ...m, id });
    return id;
  };
  x.reply = (ev) => x.emit("event", { accountId: "a1", ...ev });
  return x;
}
const tick = () => new Promise((r) => setImmediate(r));

test("sendPlan, una dirección por grupo: un resultado por grupo, con el texto intacto", async () => {
  const x = fakeAccount();
  x.on("sent", (m) =>
    setImmediate(() => (m.to.startsWith("all@") ? x.reply({ type: "message", conv: m.to, convType: "chat", nick: "all", body: "Ping sent to all" }) : x.reply({ type: "message-error", conv: m.to, id: m.id, condition: "forbidden", message: "You are not allowed to ping caps" }))),
  );
  const r = await sendPlan(x, { mode: "address", groups: GROUPS, text: PING });
  assert.deepEqual(
    r.map((g) => [g.group, g.status, g.reason]),
    [
      ["all", "sent", "Ping sent to all"],
      ["caps", "rejected", "You are not allowed to ping caps"],
    ],
  );
  assert.deepEqual(
    x.sent.map((m) => [m.to, m.type, m.body]),
    [
      ["all@pings.ejemplo.com", "chat", PING],
      ["caps@pings.ejemplo.com", "chat", PING],
    ],
  );
  assert.equal(x.listenerCount("event"), 0, "deja de observar al terminar");
});

test("sendPlan: sin respuesta en 15 s es «sin confirmar», nunca «enviado» (reloj simulado)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const x = fakeAccount();
  const p = sendPlan(x, { mode: "line", groups: [GROUPS[0]], botJid: "pings-bot@ejemplo.com", text: PING });
  await tick();
  t.mock.timers.tick(FC_REPLY_MS - 1);
  await tick();
  // A un milisegundo de la hora aún se puede contestar; no lo hace nadie.
  t.mock.timers.tick(1);
  const [r] = await p;
  assert.deepEqual([r.status, r.reason, r.reply], ["unconfirmed", "timeout", null]);
  assert.equal(FC_REPLY_MS, 15e3);
});

test("sendPlan: el propio ping reenviado no es la respuesta; se apunta aparte y se sigue esperando", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const x = fakeAccount();
  const p = sendPlan(x, { mode: "line", groups: [GROUPS[0]], botJid: "pings-bot@ejemplo.com", text: PING });
  await tick();
  x.reply({ type: "message", conv: "pings-bot@ejemplo.com", convType: "chat", nick: "pings-bot", body: `${PING}${NL}~~~ This was a coord broadcast from bob to all at 2026-11-07 18:00:00 EVE ~~~` });
  t.mock.timers.tick(FC_REPLY_MS);
  const [r] = await p;
  assert.equal(r.status, "unconfirmed", "el eco solo no prueba nada");
  assert.equal(r.echo, true);
});

test("sendPlan: en una sala solo vale lo que dice el bot por su nick; otros y uno mismo no cuentan", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const x = fakeAccount();
  const room = "pings-bot@conference.ejemplo.com";
  const p = sendPlan(x, { mode: "line", channelType: "groupchat", botJid: room, botNick: "pings-bot", groups: [GROUPS[1]], text: PING });
  await tick();
  assert.equal(x.sent[0].type, "groupchat");
  x.reply({ type: "message", conv: room, convType: "groupchat", nick: "alice", body: "sent!" });
  x.reply({ type: "message", conv: room, convType: "groupchat", nick: "yo", body: "sent", outgoing: true });
  x.reply({ type: "message", conv: "otro@ejemplo.com", convType: "chat", nick: "pings-bot", body: "sent" });
  x.reply({ type: "message", conv: room, convType: "groupchat", nick: "pings-bot", body: "Denied: no permission for caps" });
  const [r] = await p;
  assert.deepEqual([r.status, r.reply], ["rejected", "Denied: no permission for caps"]);
});

test("sendPlan: un error que no es de este mensaje no cuenta; si no se puede enviar, «rejected» con el motivo", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const x = fakeAccount();
  const p = sendPlan(x, { mode: "address", groups: [GROUPS[0]], text: "x" });
  await tick();
  x.reply({ type: "message-error", conv: "all@pings.ejemplo.com", id: "otro-id", condition: "forbidden", message: "nada que ver" });
  t.mock.timers.tick(FC_REPLY_MS);
  assert.equal((await p)[0].status, "unconfirmed");
  const off = await sendPlan(fakeAccount({ fail: true }), { mode: "address", groups: [GROUPS[0]], text: "x" });
  assert.deepEqual([off[0].status, off[0].reason], ["rejected", "No conectado"]);
});

test("sendPlan solo observa: las respuestas siguen llegando a los demás oyentes de la cuenta", async () => {
  const x = fakeAccount();
  const seen = [];
  x.on("event", (ev) => seen.push(ev.body));
  x.on("sent", (m) => setImmediate(() => x.reply({ type: "message", conv: m.to, convType: "chat", nick: "all", body: "Ping sent" })));
  await sendPlan(x, { mode: "address", groups: [GROUPS[0]], text: "x" });
  assert.deepEqual(seen, ["Ping sent"]);
});

test("interpretReply: los fallos nunca salen como enviados aunque digan «broadcast»", () => {
  for (const body of ["Broadcast failed", "Error broadcasting to caps", "Could not send the ping", "Couldn't broadcast: unknown target", "Unable to broadcast right now", "Broadcast failure", "Ping fails for all", "errors while broadcasting", "No se pudo enviar el ping", "Fallo al enviar"]) {
    assert.equal(interpretReply({ body }).status, "rejected", body);
  }
  // Los éxitos de siempre siguen siéndolo.
  for (const body of ["Ping sent to all", "Broadcast delivered", "Broadcasted to caps", "Enviado a all"]) assert.equal(interpretReply({ body }).status, "sent", body);
});
