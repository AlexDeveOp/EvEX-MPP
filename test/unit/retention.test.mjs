// Caducidad del historial local (main/retention.js). Borra datos reales, así que cada garantía tiene su test.
// Todo se hace en carpetas temporales (tempDir), nunca en un perfil de verdad.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Logs } from "../../src/main/logs.js";
import { pruneText, pruneFile, pruneHistory, retentionSettings, convCutoff, cutoffFor, isPingConv, accountLogFiles, DAY_MS } from "../../src/main/retention.js";
import { tempDir } from "./helpers.mjs";

const NOW = Date.UTC(2026, 10, 6, 12);
const daysAgo = (d) => NOW - d * DAY_MS;
const ACC = { id: "acc1", jid: "piloto@ejemplo.com" };
const SETTINGS = (retention, extra = {}) => ({ retention, pingSenders: ["pingbot"], srp: { marks: {} }, ...extra });

// Un perfil de prueba: una sala, un chat y la conversación del bot de pings, con mensajes de hace 400, 100, 40 y 1 días.
function profile(t) {
  const base = tempDir(t);
  const logs = new Logs(path.join(base, "logs"));
  for (const conv of ["sala@conference.ejemplo.com", "amigo@ejemplo.com", "pingbot@ejemplo.com"]) {
    for (const d of [400, 100, 40, 1]) logs.append(ACC.id, conv, { ts: daysAgo(d), nick: "x", body: `${conv} hace ${d} días` });
  }
  return { base, logs, file: (conv) => logs.file(ACC.id, conv) };
}
const lines = (file) => fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
// Contenido y fecha de cada fichero. Se abre una sola vez y todo sale del mismo descriptor (sin comprobar la ruta y
// leerla después: el fichero podría cambiar en medio).
const snapshot = (dir) => {
  const out = {};
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    let fd;
    try {
      fd = fs.openSync(path.join(dir, String(f)), "r");
      const st = fs.fstatSync(fd);
      if (st.isFile()) out[String(f)] = { text: fs.readFileSync(fd, "utf8"), mtime: st.mtimeMs };
    } catch {
      // Carpeta (en Windows no se abre como fichero): no cuenta.
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  return out;
};

test("plazos: solo 0/30/90/180/365; de serie, mensajes y pings «Nunca» y flotas 90", () => {
  assert.deepEqual(retentionSettings(undefined), { messagesDays: 0, pingsDays: 0, fleetsDays: 90 });
  assert.deepEqual(retentionSettings({ messagesDays: 30, pingsDays: 7, fleetsDays: "365" }), { messagesDays: 30, pingsDays: 0, fleetsDays: 365 });
  assert.equal(convCutoff({ messagesDays: 0, pingsDays: 30 }, { now: NOW }), null);
  assert.equal(convCutoff({ messagesDays: 0, pingsDays: 30 }, { ping: true, now: NOW }), daysAgo(30));
});

test("(1) con «Nunca» no se abre ni se reescribe ningún fichero (contenido y fecha intactos)", (t) => {
  const { base, logs } = profile(t);
  const before = snapshot(path.join(base, "logs"));
  const realRead = fs.readFileSync;
  let reads = 0;
  t.mock.method(fs, "readFileSync", (...a) => (reads++, realRead(...a)));
  const r = pruneHistory(logs, [ACC], SETTINGS({ messagesDays: 0, pingsDays: 0 }), { now: NOW });
  assert.deepEqual(r, { messages: 0, pings: 0, files: 0 });
  // Y pruneFile con corte null tampoco abre el fichero.
  assert.equal(pruneFile(path.join(base, "no-existe.jsonl"), null, new Set()), 0);
  assert.equal(reads, 0, "no se ha leído ningún fichero");
  t.mock.restoreAll();
  assert.deepEqual(snapshot(path.join(base, "logs")), before);
});

test("borra solo lo más antiguo que el plazo; los pings van con su propio plazo", (t) => {
  const { logs, file } = profile(t);
  const r = pruneHistory(logs, [ACC], SETTINGS({ messagesDays: 90, pingsDays: 0 }), { now: NOW });
  assert.deepEqual(r, { messages: 4, pings: 0, files: 2 }, "400 y 100 días en la sala y en el chat");
  assert.deepEqual(lines(file("sala@conference.ejemplo.com")).map((l) => JSON.parse(l).body), ["sala@conference.ejemplo.com hace 40 días", "sala@conference.ejemplo.com hace 1 días"]);
  assert.equal(lines(file("pingbot@ejemplo.com")).length, 4, "los pings en «Nunca» no se tocan");
  const r2 = pruneHistory(logs, [ACC], SETTINGS({ messagesDays: 90, pingsDays: 30 }), { now: NOW });
  assert.deepEqual(r2, { messages: 0, pings: 3, files: 1 });
});

test("dryRun cuenta sin tocar nada", (t) => {
  const { base, logs } = profile(t);
  const before = snapshot(path.join(base, "logs"));
  assert.deepEqual(pruneHistory(logs, [ACC], SETTINGS({ messagesDays: 30, pingsDays: 30 }), { now: NOW, dryRun: true }), { messages: 6, pings: 3, files: 0 });
  assert.deepEqual(snapshot(path.join(base, "logs")), before);
});

test("los pings marcados para SRP no se borran", (t) => {
  const { logs, file } = profile(t);
  const old = JSON.parse(lines(file("pingbot@ejemplo.com"))[0]);
  const r = pruneHistory(logs, [ACC], SETTINGS({ messagesDays: 0, pingsDays: 30 }, { srp: { marks: { [old.key]: { status: "requested" } } } }), { now: NOW });
  assert.equal(r.pings, 2, "el de hace 400 días tiene marca y se queda");
  assert.equal(lines(file("pingbot@ejemplo.com"))[0], JSON.stringify(old));
});

test("(3) las líneas que no se entienden se conservan tal cual y en su sitio", () => {
  const good = (d, extra = {}) => JSON.stringify({ ts: daysAgo(d), nick: "x", body: `hace ${d}`, ...extra });
  const text = [good(400), "{roto", good(100, { futuro: { v: 9 } }), '{"nick":"sin hora","body":"?"}', '"solo un texto"', "[1,2]", good(1), ""].join("\n");
  const r = pruneText(text, daysAgo(90), new Set());
  assert.equal(r.removed, 2, "solo las dos entradas válidas y antiguas");
  assert.equal(r.text, ["{roto", '{"nick":"sin hora","body":"?"}', '"solo un texto"', "[1,2]", good(1), ""].join("\n"));
});

test("(5) si la escritura falla a mitad, el fichero original queda intacto y sin temporal", (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, "sala.jsonl");
  const original = [JSON.stringify({ ts: daysAgo(400), nick: "x", body: "viejo" }), JSON.stringify({ ts: daysAgo(1), nick: "x", body: "nuevo" }), ""].join("\n");
  fs.writeFileSync(file, original);
  t.mock.method(fs, "renameSync", () => {
    throw new Error("disco lleno");
  });
  assert.throws(() => pruneFile(file, daysAgo(90), new Set()), /disco lleno/);
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.deepEqual(fs.readdirSync(dir), ["sala.jsonl"], "sin restos del temporal");
});

test("(2) solo se tocan los .jsonl de logs/<idCuenta>; nada fuera (p. ej. registros de Pidgin)", (t) => {
  const { base, logs } = profile(t);
  // Un «registro de Pidgin» y un fichero suelto fuera de logs/acc1, con mensajes muy antiguos.
  const pidgin = path.join(base, ".purple", "logs", "jabber", "piloto@ejemplo.com", "sala.txt");
  fs.mkdirSync(path.dirname(pidgin), { recursive: true });
  fs.writeFileSync(pidgin, "(2020-01-01 10:00:00) viejo\n");
  const other = path.join(base, "logs", "otra-cuenta", "x.jsonl");
  fs.mkdirSync(path.dirname(other), { recursive: true });
  fs.writeFileSync(other, JSON.stringify({ ts: daysAgo(400), nick: "x", body: "de otra cuenta" }) + "\n");
  const notes = path.join(base, "logs", ACC.id, "notas.txt");
  fs.writeFileSync(notes, "no es historial");
  const keep = [pidgin, other, notes].map((f) => [f, fs.readFileSync(f, "utf8")]);
  pruneHistory(logs, [ACC], SETTINGS({ messagesDays: 30, pingsDays: 30 }), { now: NOW });
  for (const [f, text] of keep) assert.equal(fs.readFileSync(f, "utf8"), text, f);
  // Un id de cuenta con ruta relativa no sale de logs/.
  assert.deepEqual(accountLogFiles(logs, "../.purple"), []);
});

test("lo caducado no se vuelve a guardar (historial de sala, archivo, recuperación de Pidgin)", (t) => {
  const base = tempDir(t);
  const logs = new Logs(path.join(base, "logs"));
  const settings = SETTINGS({ messagesDays: 30, pingsDays: 0 });
  logs.setRetention(cutoffFor(() => settings, () => ACC));
  assert.equal(logs.append(ACC.id, "sala@conference.ejemplo.com", { ts: daysAgo(40), nick: "x", body: "viejo", delayed: true }), null);
  assert.ok(logs.append(ACC.id, "sala@conference.ejemplo.com", { ts: Date.now(), nick: "x", body: "nuevo" }));
  assert.equal(logs.mergeImport(ACC.id, "amigo@ejemplo.com", [{ ts: daysAgo(40), nick: "x", body: "viejo" }, { ts: Date.now(), nick: "x", body: "nuevo" }]), 1);
  // Los pings siguen su plazo («Nunca»): un ping antiguo recuperado sí se guarda.
  assert.equal(logs.mergeImport(ACC.id, "pingbot@ejemplo.com", [{ ts: daysAgo(400), nick: "pingbot", body: "ping viejo" }]), 1);
});

test("isPingConv: «pingbot» sin dominio vale en cualquier servidor, como en la ventana", () => {
  assert.equal(isPingConv(["pingbot"], "piloto@ejemplo.com", "pingbot@ejemplo.com"), true);
  assert.equal(isPingConv(["pingbot"], "piloto@ejemplo.com", "pingbot@otro.ejemplo.net"), true);
  assert.equal(isPingConv(["bot@ejemplo.com"], "piloto@ejemplo.com", "bot@otro.ejemplo.net"), false);
  assert.equal(isPingConv([], "piloto@ejemplo.com", "sala@conference.ejemplo.com"), false);
});
