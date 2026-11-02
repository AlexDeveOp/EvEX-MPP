import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseLogFile, detectDateOrder, repairImportedLogs } from "../../src/main/pidgin-import.js";
import { Logs } from "../../src/main/logs.js";
import { tempDir } from "./helpers.mjs";

const write = (dir, name, text) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
};

test("parseLogFile lee los registros HTML de Pidgin y quita las etiquetas", (t) => {
  const file = write(
    tempDir(t),
    "2026-01-02.030405+0000UTC.html",
    '<html><body><h3>Conversación</h3>\n<font size="2">(03:04:05)</font> <b>ana:</b> hola <<b>b>mundo &amp; &lt;x&gt;<br/>segunda línea\n<font size="2">(03:10:00)</font> <b>bob:</b> <i>adiós</i>\n</body></html>\n',
  );
  const msgs = parseLogFile(file);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].nick, "ana");
  // Sin etiquetas del registro; "<x>" sí debe quedar, porque venía escrito como &lt;x&gt;.
  assert.ok(!/<\/?(b|br|font|i|html|body|h3)\b/i.test(msgs[0].body), msgs[0].body);
  assert.ok(msgs[0].body.includes("mundo & <x>"));
  assert.ok(msgs[0].body.includes("\nsegunda línea"));
  assert.equal(msgs[1].body, "adiós");
  assert.equal(new Date(msgs[0].ts).getHours(), 3);
  assert.ok(msgs[1].ts > msgs[0].ts);
});

test("parseLogFile lee los registros de texto y une las líneas de continuación", (t) => {
  const file = write(tempDir(t), "2026-01-02.120000+0000UTC.txt", "Conversation with x\n(12:00:01) ana: primera\nsigue aquí\n(12:00:30) bob: <no es html>\n");
  const msgs = parseLogFile(file);
  assert.deepEqual(
    msgs.map((m) => [m.nick, m.body]),
    [
      ["ana", "primera\nsigue aquí"],
      ["bob", "<no es html>"],
    ],
  );
});

test("parseLogFile marca como propios los mensajes de los apodos del usuario", (t) => {
  const file = write(tempDir(t), "2026-01-02.120000+0000UTC.txt", "(12:00:01) yo: hola\n(12:00:02) ana: hola\n");
  const [mine, theirs] = parseLogFile(file, { selfNames: ["yo"] });
  assert.ok(mine.outgoing || mine.out);
  assert.ok(!(theirs.outgoing || theirs.out));
});

test("parseLogFile de un fichero que no existe devuelve una lista vacía", () => {
  assert.deepEqual(parseLogFile(path.join(process.cwd(), "no-existe.html")), []);
});

// Registro de sala como los escribe Pidgin en español: fechas día/mes del historial que reenvía la sala, avisos de
// entradas, salidas y desconexión, un cambio de tema y una acción /me.
const ROOM_LOG = [
  '<html><head><meta http-equiv="content-type" content="text/html; charset=UTF-8"><title>Conversación</title></head><body><h3>Conversación en sala@conference.ejemplo.com</h3>',
  '<span style="color: #1a1a8a"><span style="font-size: smaller">(12/08/2026 18:14:03)</span> <b>ana:</b></span> o7<br/>',
  '<span style="color: #1a1a8a"><span style="font-size: smaller">(12/09/2026 16:30:29)</span> <b>bob:</b></span> ¿alguien tiene sitio para cuatro barcazas?<br/>',
  '<span style="font-size: smaller">(22:04:13)</span><b> Se ha desconectado la cuenta y ya no está en el chat. Se unirá automáticamente al chat cuando se vuelva a conectar la cuenta.</b><br>',
  '<span style="font-size: smaller">(22:05:00)</span><b>carla ha entrado en la sala.</b><br>',
  '<span style="font-size: smaller">(22:06:00)</span><b>carla ha salido de la sala.</b><br>',
  '<span style="font-size: smaller">(22:07:00)</span><b>dani ha cambiado el tema a: Bienvenidos</b><br>',
  '<span style="color: #062585"><span style="font-size: smaller">(22:08:00)</span> <b>***ana</b></span> saluda a todos<br/>',
  "</body></html>",
].join("\n");

const writeRoomLog = (t) => {
  const dir = tempDir(t);
  const roomDir = path.join(dir, "sala@conference.ejemplo.com.chat");
  fs.mkdirSync(roomDir);
  return { dir, file: write(roomDir, "2026-11-02.220000+0100CET.html", ROOM_LOG) };
};

test("las fechas ambiguas no se leen en el futuro: 12/08 es el 12 de agosto, no el 8 de diciembre", (t) => {
  const { file } = writeRoomLog(t);
  const [o7, barges] = parseLogFile(file, { isRoom: true });
  assert.equal(new Date(o7.ts).toDateString(), new Date(2026, 7, 12).toDateString());
  assert.equal(new Date(barges.ts).toDateString(), new Date(2026, 8, 12).toDateString());
  // Con el formato detectado en la cuenta manda ese formato.
  const [mdy] = parseLogFile(file, { isRoom: true, dateOrder: "mdy" });
  assert.equal(new Date(mdy.ts).toDateString(), new Date(2026, 11, 8).toDateString());
});

test("detectDateOrder encuentra el formato en cualquier registro de la cuenta", (t) => {
  const dir = tempDir(t);
  const ambiguous = write(dir, "a.html", "<span>(12/08/2026 18:14:03)</span> <b>ana:</b> o7");
  const dmy = write(dir, "b.html", "<span>(25/10/2026 21:26:22)</span> <b>ana:</b> hola");
  const mdy = write(dir, "c.html", "<span>(10/25/2026 21:26:22)</span> <b>ana:</b> hola");
  assert.equal(detectDateOrder([ambiguous]), null);
  assert.equal(detectDateOrder([ambiguous, dmy]), "dmy");
  assert.equal(detectDateOrder([mdy]), "mdy");
});

test("no se importan los avisos de Pidgin; se conservan el cambio de tema y las acciones /me", (t) => {
  const { file } = writeRoomLog(t);
  const msgs = parseLogFile(file, { isRoom: true, dateOrder: "dmy" });
  assert.deepEqual(
    msgs.map((m) => [m.nick, m.body]),
    [
      ["ana", "o7"],
      ["bob", "¿alguien tiene sitio para cuatro barcazas?"],
      ["", "dani ha cambiado el tema a: Bienvenidos"],
      ["ana", "/me saluda a todos"],
    ],
  );
});

test("repairImportedLogs corrige lo importado antes: fechas, avisos de Pidgin y acciones /me", async (t) => {
  const { dir, file } = writeRoomLog(t);
  const logs = new Logs(tempDir(t));
  const conv = "sala@conference.ejemplo.com";
  // Así lo guardó la versión anterior (con la regla antigua de fechas y los avisos incluidos).
  const legacy = parseLogFile(file, { isRoom: true, legacy: true });
  assert.equal(legacy.length, 7);
  assert.equal(new Date(legacy[0].ts).getMonth(), 11, "la versión anterior lo ponía en diciembre");
  logs.mergeImport("acc", conv, legacy);
  // Un mensaje recibido en directo con EvEX-MPP no se toca.
  logs.append("acc", conv, { ts: Date.UTC(2026, 10, 2, 23, 0, 0), nick: "eva", body: "en directo" });

  const r = await repairImportedLogs({ logsDir: dir, selfNames: [], logs, accountId: "acc" });
  assert.equal(r.dateOrder, null, "en este registro ninguna fecha delata el formato");
  assert.equal(r.removed, 3, "desconexión, entrada y salida");
  assert.equal(r.fixed, 3, "dos fechas y la acción /me");
  const after = logs.tail("acc", conv, Infinity).sort((a, b) => a.ts - b.ts);
  assert.deepEqual(
    after.map((e) => [new Date(e.ts).getMonth() + 1, e.nick, e.body]),
    [
      [8, "ana", "o7"],
      [9, "bob", "¿alguien tiene sitio para cuatro barcazas?"],
      [11, "", "dani ha cambiado el tema a: Bienvenidos"],
      [11, "ana", "/me saluda a todos"],
      [11, "eva", "en directo"],
    ],
  );
  // Repetirla no cambia nada más.
  const again = await repairImportedLogs({ logsDir: dir, selfNames: [], logs, accountId: "acc" });
  assert.equal(again.fixed + again.removed, 0);
});
