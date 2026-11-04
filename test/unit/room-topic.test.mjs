// Tema de la sala, permisos, configuración (muc#owner), /ping y /buzz: funciones puras y prueba contra el servidor simulado.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { xml } from "@xmpp/client";
import { XmppAccount, iqErrorMessage, parseChangeSubject, parseDataForm, dataFormSubmit } from "../../src/main/xmpp-account.js";
import { S } from "../../src/renderer/js/state.js";
import { canEditTopic, mayTryTopic, canConfigureRoom, topicLockedReason, topicChangedText, topicErrorText, occupantAdminActions, selfRightsText, AFFILIATION_LISTS } from "../../src/renderer/js/room-admin.js";
import { TEST_SETTINGS, tempDir } from "./helpers.mjs";

S.settings = structuredClone(TEST_SETTINGS);

// Estado de sala como el de la interfaz: nuestro apodo y la lista de participantes con su rol.
const room = (role, affiliation = "member", changeSubject = null, joined = true) => ({
  joined,
  nick: "yo",
  changeSubject,
  occupants: new Map([["yo", { nick: "yo", role, affiliation }]]),
});

test("canEditTopic: moderadores siempre; participantes solo si la sala dice que lo permite; visitantes nunca", () => {
  assert.equal(canEditTopic(room("moderator", "member", false)), true);
  assert.equal(canEditTopic(room("participant", "member", true)), true);
  assert.equal(canEditTopic(room("participant", "member", null)), false, "sin dato: no se ofrece la etiqueta");
  assert.equal(canEditTopic(room("participant", "member", false)), false);
  assert.equal(canEditTopic(room("visitor", "none", true)), false);
  assert.equal(canEditTopic(room("moderator", "owner", true, false)), false, "fuera de la sala, no");
  assert.equal(canEditTopic(undefined), false);
});

test("mayTryTopic: /topic se intenta si no se sabe que está prohibido", () => {
  assert.equal(mayTryTopic(room("participant", "member", null)), true, "sin dato: el servidor decide");
  assert.equal(mayTryTopic(room("participant", "member", false)), false);
  assert.equal(mayTryTopic(room("moderator", "member", false)), true);
  assert.equal(mayTryTopic(room("visitor", "none", null)), false);
  assert.equal(mayTryTopic(room("participant", "member", null, false)), false);
});

test("el rol se mira en la lista de participantes (puede cambiar estando dentro)", () => {
  const r = room("participant", "member", false);
  assert.equal(canEditTopic(r), false);
  r.occupants.set("yo", { nick: "yo", role: "moderator", affiliation: "member" });
  assert.equal(canEditTopic(r), true, "al hacernos moderadores aparece la etiqueta");
});

test("configuración de la sala: solo propietarios; motivos del menú en su idioma", () => {
  assert.equal(canConfigureRoom(room("moderator", "owner")), true);
  assert.equal(canConfigureRoom(room("moderator", "admin")), false);
  assert.match(topicLockedReason(room("visitor", "none")), /visitantes/i);
  assert.match(topicLockedReason(room("participant", "member", false)), /moderadores/i);
  assert.match(topicLockedReason(room("participant", "member", null)), /no indica/i);
  assert.match(topicLockedReason(room("participant", "member", false, false)), /No estás en la sala/);
});

test("textos del tema: cambiado, quitado y error de un cambio rechazado", () => {
  assert.equal(topicChangedText("bob", "Fleet 20:00"), "bob cambió el tema: Fleet 20:00");
  assert.equal(topicChangedText("bob", ""), "bob quitó el tema de la sala.");
  assert.equal(topicErrorText({ id: "desconocido", condition: "forbidden" }), null, "otros errores siguen su camino");
});

test("clic derecho en un participante: cada uno ve lo que su afiliación permite", () => {
  const keys = (me, o) => occupantAdminActions(me, o).map((a) => a.key);
  const p = { nick: "piloto", jid: "piloto@ejemplo.com/pc", role: "participant", affiliation: "none" };
  assert.deepEqual(keys({ role: "participant", affiliation: "none" }, p), [], "un participante normal no puede nada");
  assert.deepEqual(keys({ role: "moderator", affiliation: "none" }, p), [], "un moderador sin afiliación tampoco (solo expulsar y voz)");
  assert.deepEqual(keys({ role: "moderator", affiliation: "admin" }, p), ["mod", "member"]);
  assert.deepEqual(keys({ role: "moderator", affiliation: "owner" }, p), ["mod", "member", "admin", "owner"]);
  assert.deepEqual(keys({ role: "moderator", affiliation: "owner" }, { ...p, role: "moderator", affiliation: "member" }), ["unmod", "unmember", "admin", "owner"]);
  assert.deepEqual(keys({ role: "moderator", affiliation: "owner" }, { ...p, role: "moderator", affiliation: "admin" }), ["unadmin", "owner"], "a un administrador no se le quita el moderador suelto");
  assert.deepEqual(keys({ role: "moderator", affiliation: "owner" }, { ...p, role: "moderator", affiliation: "owner" }), ["unowner"]);
  assert.deepEqual(keys({ role: "moderator", affiliation: "admin" }, { ...p, role: "moderator", affiliation: "admin" }), [], "un administrador no toca a otro");
  assert.deepEqual(keys({ role: "moderator", affiliation: "owner" }, { ...p, jid: "" }), ["mod"], "sin dirección real, solo el rol");
  assert.deepEqual(keys({ role: "moderator", affiliation: "owner" }, { ...p, self: true }), [], "a uno mismo, nada");
  const make = occupantAdminActions({ role: "moderator", affiliation: "owner" }, p).find((a) => a.key === "admin");
  assert.deepEqual(make.opts, { jid: "piloto@ejemplo.com", affiliation: "admin" }, "la afiliación va por la dirección sin recurso");
  assert.equal(make.done, "piloto ahora es administrador.");
});

test("quitar a alguien de una lista o de un cargo lo deja sin afiliación, no lo baja a la lista siguiente", () => {
  assert.deepEqual(AFFILIATION_LISTS.map((l) => l.removeTo), ["none", "none", "none", "none"]);
  const owner = { role: "moderator", affiliation: "owner" };
  const p = { nick: "piloto", jid: "piloto@ejemplo.com", role: "moderator" };
  assert.equal(occupantAdminActions(owner, { ...p, affiliation: "owner" }).find((a) => a.key === "unowner").opts.affiliation, "none");
  assert.equal(occupantAdminActions(owner, { ...p, affiliation: "admin" }).find((a) => a.key === "unadmin").opts.affiliation, "none");
});

test("aviso de nuestros propios permisos", () => {
  const p = { role: "participant", affiliation: "member" };
  assert.equal(selfRightsText(p, { ...p, role: "moderator" }), "Ahora eres moderador en esta sala.");
  assert.equal(selfRightsText({ ...p, role: "moderator" }, p), "Ya no eres moderador en esta sala.");
  assert.equal(selfRightsText(p, { role: "moderator", affiliation: "admin" }), "Ahora eres administrador de esta sala.");
  assert.equal(selfRightsText({ role: "moderator", affiliation: "admin" }, p), "Ya no eres administrador de esta sala.");
  assert.equal(selfRightsText(p, { role: "none", affiliation: "outcast" }), "Ya no eres miembro de esta sala.");
  assert.equal(selfRightsText(p, { ...p, role: "visitor" }), "Ahora eres visitante: no puedes escribir en esta sala.");
  assert.equal(selfRightsText(p, { ...p }), null, "sin cambios, sin aviso");
});

test("parseChangeSubject: 1/true, 0/false o null si el servidor no lo dice", () => {
  assert.equal(parseChangeSubject("1"), true);
  assert.equal(parseChangeSubject("true"), true);
  assert.equal(parseChangeSubject("0"), false);
  assert.equal(parseChangeSubject("false"), false);
  assert.equal(parseChangeSubject(undefined), null);
  assert.equal(parseChangeSubject(""), null);
});

test("iqErrorMessage: errores del servidor en palabras del usuario", () => {
  assert.equal(iqErrorMessage({ condition: "forbidden" }), "No tienes permiso para hacer eso en esta sala.");
  assert.equal(iqErrorMessage({ condition: "not-allowed" }), "No tienes permiso para hacer eso en esta sala.");
  assert.equal(iqErrorMessage({ condition: "item-not-found" }), "No se encuentra esa sala o ese usuario.");
  assert.equal(iqErrorMessage({ condition: "not-acceptable", text: "nombre repetido" }), "El servidor no lo acepta: nombre repetido");
  assert.equal(iqErrorMessage({ name: "TimeoutError", message: "timeout" }), "El servidor no ha respondido a tiempo.");
  assert.equal(iqErrorMessage({ condition: "conflict", text: "otro motivo" }), "otro motivo");
});

test("formularios (XEP-0004): se leen todos los tipos y la respuesta solo lleva campos con nombre", () => {
  const x = xml(
    "x",
    { xmlns: "jabber:x:data", type: "form" },
    xml("title", {}, "Config"),
    xml("instructions", {}, "Rellena"),
    xml("field", { var: "FORM_TYPE", type: "hidden" }, xml("value", {}, "http://jabber.org/protocol/muc#roomconfig")),
    xml("field", { type: "fixed" }, xml("value", {}, "Permisos")),
    xml("field", { var: "name", type: "text-single", label: "Nombre" }, xml("value", {}, "sala"), xml("required")),
    xml("field", { var: "subj", type: "boolean", label: "Tema" }, xml("value", {}, "0")),
    xml("field", { var: "whois", type: "list-single" }, xml("value", {}, "moderators"), xml("option", { label: "Mods" }, xml("value", {}, "moderators")), xml("option", {}, xml("value", {}, "anyone"))),
    xml("field", { var: "admins", type: "jid-multi" }),
  );
  const form = parseDataForm(x);
  assert.equal(form.title, "Config");
  assert.equal(form.instructions, "Rellena");
  assert.equal(form.fields.length, 6);
  const name = form.fields.find((f) => f.var === "name");
  assert.deepEqual([name.label, name.required, name.values], ["Nombre", true, ["sala"]]);
  assert.deepEqual(form.fields.find((f) => f.var === "whois").options, [{ label: "Mods", value: "moderators" }, { label: "anyone", value: "anyone" }]);

  const out = dataFormSubmit(form.fields, { name: ["sala nueva"], subj: true, admins: ["a@ejemplo.com", "", "b@ejemplo.com"] });
  assert.equal(out.attrs.type, "submit");
  const sent = Object.fromEntries(out.getChildren("field").map((f) => [f.attrs.var, f.getChildren("value").map((v) => v.text())]));
  assert.deepEqual(sent, {
    FORM_TYPE: ["http://jabber.org/protocol/muc#roomconfig"],
    name: ["sala nueva"],
    subj: ["1"],
    whois: ["moderators"],
    admins: ["a@ejemplo.com", "b@ejemplo.com"],
  });
  assert.ok(!out.getChildren("field").some((f) => !f.attrs.var), "el campo fijo no se envía");
});

// ---------- contra el servidor simulado ----------

const PORT = 15800 + Math.floor(Math.random() * 400);
let mock;
before(async () => {
  mock = spawn(process.execPath, [fileURLToPath(new URL("../mock-xmpp.mjs", import.meta.url))], { env: { ...process.env, MOCK_PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    mock.once("exit", (code) => reject(new Error(`el servidor simulado terminó (${code})`)));
    mock.stdout.on("data", (d) => String(d).includes("mock XMPP en") && resolve());
  });
});
after(() => mock?.kill());

async function online(t) {
  const acc = new XmppAccount({ id: "rt", jid: "usuario@test.local", host: "127.0.0.1", port: PORT, security: "opportunistic" }, { avatarDir: tempDir(t), version: "1.0.0" });
  const events = [];
  acc.on("event", (e) => events.push(e));
  t.after(() => acc.disconnect(true).catch(() => {}));
  const waitFor = (pred, ms = 8000) =>
    new Promise((resolve, reject) => {
      const found = events.find(pred);
      if (found) return resolve(found);
      const timer = setTimeout(() => reject(new Error(`sin evento esperado; recibidos: ${events.map((e) => e.type).join(", ")}`)), ms);
      const onEvent = (e) => {
        if (!pred(e)) return;
        clearTimeout(timer);
        acc.off("event", onEvent);
        resolve(e);
      };
      acc.on("event", onEvent);
    });
  await acc.connect("test");
  await waitFor((e) => e.type === "status" && e.state === "online");
  return { acc, waitFor };
}

test("al entrar se sabe si los participantes pueden cambiar el tema", async (t) => {
  const { acc, waitFor } = await online(t);
  await acc.joinRoom("general@conference.test.local", "probador");
  await acc.joinRoom("operaciones@conference.test.local", "probador");
  await acc.joinRoom("anuncios@conference.test.local", "probador");
  assert.equal((await waitFor((e) => e.type === "room-info" && e.room === "general@conference.test.local")).changeSubject, true);
  assert.equal((await waitFor((e) => e.type === "room-info" && e.room === "operaciones@conference.test.local")).changeSubject, false);
  assert.equal((await waitFor((e) => e.type === "room-info" && e.room === "anuncios@conference.test.local")).changeSubject, null);
});

test("cambiar el tema: aceptado vuelve como «subject»; rechazado llega como error con el mismo id", async (t) => {
  const { acc, waitFor } = await online(t);
  await acc.joinRoom("general@conference.test.local", "probador");
  await waitFor((e) => e.type === "room-joined" && e.room === "general@conference.test.local");
  await acc.setSubject("general@conference.test.local", "Fleet 20:00 EVE");
  const ok = await waitFor((e) => e.type === "subject" && e.subject === "Fleet 20:00 EVE");
  assert.equal(ok.by, "probador");

  await acc.joinRoom("anuncios@conference.test.local", "probador");
  await waitFor((e) => e.type === "room-joined" && e.room === "anuncios@conference.test.local");
  const id = await acc.setSubject("anuncios@conference.test.local", "Intento");
  assert.ok(id);
  const err = await waitFor((e) => e.type === "message-error" && e.id === id);
  assert.equal(err.condition, "forbidden");
  assert.equal(err.conv, "anuncios@conference.test.local");
});

test("configuración de la sala: el propietario la lee y la guarda; los demás reciben un error claro", async (t) => {
  const { acc, waitFor } = await online(t);
  await acc.joinRoom("entrenamiento@conference.test.local", "probador");
  await waitFor((e) => e.type === "room-joined" && e.room === "entrenamiento@conference.test.local");
  const form = await acc.getRoomConfig("entrenamiento@conference.test.local", "es");
  assert.ok(form.fields.some((f) => f.var === "muc#roomconfig_changesubject" && f.type === "boolean"));
  await acc.setRoomConfig("entrenamiento@conference.test.local", form.fields, { "muc#roomconfig_roomname": ["entrenamiento"] });

  await acc.joinRoom("general@conference.test.local", "probador");
  await waitFor((e) => e.type === "room-joined" && e.room === "general@conference.test.local");
  await assert.rejects(acc.getRoomConfig("general@conference.test.local"), /No tienes permiso/);
  await assert.rejects(acc.moderate("general@conference.test.local", { nick: "piloto_dos", role: "visitor" }), /No tienes permiso/);
});

test("listas de permisos: se leen por afiliación y cambian al añadir o quitar a alguien", async (t) => {
  const { acc, waitFor } = await online(t);
  const room = "entrenamiento@conference.test.local";
  await acc.joinRoom(room, "probador");
  await waitFor((e) => e.type === "room-joined" && e.room === room);
  assert.deepEqual((await acc.getAffiliations(room, "owner")).map((i) => i.jid), ["instructor_y@test.local"]);
  assert.deepEqual((await acc.getAffiliations(room, "outcast")).map((i) => i.jid), ["spammer@test.local"]);
  await acc.moderate(room, { jid: "nuevo@test.local", affiliation: "admin" });
  assert.deepEqual((await acc.getAffiliations(room, "admin")).map((i) => i.jid), ["nuevo@test.local"]);
  await acc.moderate(room, { jid: "nuevo@test.local", affiliation: "none" });
  assert.deepEqual(await acc.getAffiliations(room, "admin"), []);
  await acc.joinRoom("general@conference.test.local", "probador");
  await waitFor((e) => e.type === "room-joined" && e.room === "general@conference.test.local");
  await assert.rejects(acc.getAffiliations("general@conference.test.local", "admin"), /No tienes permiso/);
});

test("/ping mide el tiempo; un cliente sin ping cuenta como conectado; /buzz llega y se recibe", async (t) => {
  const { acc, waitFor } = await online(t);
  const r = await acc.pingJid("alice@test.local/phone");
  assert.equal(r.supported, true);
  assert.ok(r.ms >= 0);
  const bob = await acc.pingJid("bob@test.local/pc");
  assert.equal(bob.supported, false, "service-unavailable: está, pero no contesta a los ping");
  await acc.sendAttention("alice@test.local");
  const buzz = await waitFor((e) => e.type === "attention");
  assert.equal(buzz.conv, "alice@test.local");
  assert.equal(buzz.nick, "Alice");
});
