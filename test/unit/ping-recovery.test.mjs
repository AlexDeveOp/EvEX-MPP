import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { normBody, senderTargets, pidginPingEntries, storeRecovered } from "../../src/main/ping-recovery.js";
import { Logs } from "../../src/main/logs.js";
import { tempDir } from "./helpers.mjs";

const PING = "Capital fleet up now!!\nFC Name:\u200b\u200c Bob FC\nDoctrine: Typhoons\n\n~~~ This was a coord broadcast from bob to all ~~~";

// Registro HTML de Pidgin con un ping de pingbot (como lo escribe Pidgin: saltos de línea como <br/>).
function pidginLog(root, account, buddy, name, lines) {
  const dir = path.join(root, account, buddy);
  fs.mkdirSync(dir, { recursive: true });
  const body = lines.map(([time, nick, text]) => `<font size="2">(${time})</font> <b>${nick}:</b> ${text.replace(/\n/g, "<br/>")}<br/>`).join("\n");
  fs.writeFileSync(path.join(dir, name), `<html><head><title>Conversación</title></head><body><h3>Conversación con ${buddy}</h3>\n${body}\n</body></html>\n`);
  return dir;
}

test("normBody: ignora invisibles, saltos de línea y espacios sobrantes", () => {
  assert.equal(normBody("a\r\n b  \u200b\u200cc\n"), "a b c");
  assert.equal(normBody(PING), normBody(PING.replace(/\u200b\u200c/g, "").replace(/\n/g, "\r\n")));
});

test("senderTargets: «pingbot» sin dominio se busca en el servidor de la cuenta", () => {
  assert.deepEqual(senderTargets(["PingBot", "bot@otro.example", "pingbot"], "yo@ejemplo.com/EvEX"), [
    { jid: "pingbot@ejemplo.com", local: "pingbot" },
    { jid: "bot@otro.example", local: null },
  ]);
  assert.deepEqual(senderTargets([], "yo@ejemplo.com"), []);
});

test("pidginPingEntries lee solo la conversación del remitente y solo los mensajes recibidos", (t) => {
  const root = tempDir(t);
  const logsDir = path.join(root, "yo@ejemplo.com");
  pidginLog(root, "yo@ejemplo.com", "pingbot@ejemplo.com", "2026-11-03.101500+0100CET.html", [
    ["10:15:00", "pingbot@ejemplo.com/bot", PING],
    ["10:16:00", "yo", "gracias"],
  ]);
  pidginLog(root, "yo@ejemplo.com", "alice@ejemplo.com", "2026-11-03.101500+0100CET.html", [["10:15:00", "alice", "esto no es un ping"]]);
  const [target] = senderTargets(["pingbot"], "yo@ejemplo.com");
  const entries = pidginPingEntries(logsDir, target, 0, ["yo"]);
  assert.equal(entries.length, 1);
  assert.equal(normBody(entries[0].body), normBody(PING));
  assert.equal(new Date(entries[0].ts).getHours(), 10);
  // Ficheros sin cambios desde la última revisión: no se vuelven a leer.
  assert.equal(pidginPingEntries(logsDir, target, Date.now() + 60e3).length, 0);
});

test("storeRecovered no duplica un ping que ya llegó a la app, aunque Pidgin lo guarde distinto", (t) => {
  const logs = new Logs(tempDir(t));
  const ts = Date.UTC(2026, 10, 3, 9, 15, 0);
  logs.append("acc", "pingbot@ejemplo.com", { ts, nick: "pingbot", body: PING });
  const fromPidgin = [
    { ts: ts + 1500, nick: "pingbot@ejemplo.com/bot", body: PING.replace(/\u200b\u200c/g, "").replace(/\n/g, "\r\n") }, // el mismo, 1,5 s después
    { ts: ts + 3600e3, nick: "pingbot@ejemplo.com/bot", body: "Otro ping\nDoctrine: Ferox" }, // uno perdido
  ];
  assert.equal(storeRecovered(logs, "acc", "pingbot@ejemplo.com", fromPidgin), 1);
  const saved = logs.tail("acc", "pingbot@ejemplo.com", 10);
  assert.equal(saved.length, 2);
  assert.equal(saved[1].nick, "pingbot", "usa el mismo nombre que los pings que ya había");
  // Volver a revisar (o recibir lo mismo del servidor) no añade nada.
  assert.equal(storeRecovered(logs, "acc", "pingbot@ejemplo.com", [...fromPidgin, { ts: ts + 3600e3 + 800, body: "Otro ping Doctrine: Ferox" }]), 0);
  // El mismo texto horas más tarde es otro ping (p. ej. se repite el aviso).
  assert.equal(storeRecovered(logs, "acc", "pingbot@ejemplo.com", [{ ts: ts + 6 * 3600e3, body: PING }]), 1);
});

test("storeRecovered no recupera la copia de Pidgin de un ping que solo cambia en la hora del pie", (t) => {
  // El bot manda una copia a cada conexión: la de EvEX-MPP dice «00:05:02» y la que guarda Pidgin «00:05:03».
  const logs = new Logs(tempDir(t));
  const ts = Date.UTC(2026, 10, 4, 23, 5, 2, 731);
  const body = (s) => `Fleet up\nDoctrine: Ferox\n~~~ This was a coord broadcast from bob to all at 2026-11-05 00:05:0${s}.548411 EVE ~~~`;
  logs.append("acc", "pingbot@ejemplo.com", { ts, nick: "pingbot", body: body(2) });
  assert.equal(storeRecovered(logs, "acc", "pingbot@ejemplo.com", [{ ts: ts - 731, body: body(3) }]), 0);
  assert.equal(logs.tail("acc", "pingbot@ejemplo.com", 10).length, 1);
  // Otro texto en el mismo momento sí es un ping distinto.
  assert.equal(storeRecovered(logs, "acc", "pingbot@ejemplo.com", [{ ts, body: body(3).replace("Ferox", "Muninn") }]), 1);
});
