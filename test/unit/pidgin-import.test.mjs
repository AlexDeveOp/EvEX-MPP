import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseLogFile } from "../../src/main/pidgin-import.js";
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
