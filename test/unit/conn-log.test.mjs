import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createConnLog, describeForLog } from "../../src/main/conn-log.js";
import { tempDir } from "./helpers.mjs";

const read = (file) => fs.readFileSync(file, "utf8");

test("el registro de conexión apunta cada línea con hora y cuenta, y rota al llenarse", (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, "sub", "connection.log");
  const log = createConnLog(file, { maxBytes: 200, echo: false });
  log("cuenta1", "connect");
  assert.match(read(file), /^\d{4}-\d\d-\d\dT[\d:.]+Z \[cuenta1\] connect\n$/);
  for (let i = 0; i < 10; i++) log("cuenta1", `línea ${i} · ñ`);
  assert.match(read(path.join(dir, "sub", "connection.old.log")), /línea/, "el anterior se guarda aparte");
  const now = fs.readFileSync(file);
  assert.ok(now.length <= 200, `cuenta bytes, no caracteres (${now.length})`);
  assert.match(now.toString("utf8"), /línea 9/);
});

test("un nombre sin .log también rota, a <nombre>.old", (t) => {
  const file = path.join(tempDir(t), "conexion.txt");
  const log = createConnLog(file, { maxBytes: 120, echo: false });
  for (let i = 0; i < 6; i++) log("c", `línea ${i}`);
  assert.match(read(`${file}.old`), /línea/);
  assert.ok(fs.readFileSync(file).length <= 120);
});

test("si no se puede escribir, el registro no lanza", (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, "bloqueo"), "");
  const log = createConnLog(path.join(dir, "bloqueo", "connection.log"), { echo: false });
  assert.doesNotThrow(() => log("c", "x"));
});

test("describeForLog resume el error sin repetir partes", () => {
  assert.equal(describeForLog(Object.assign(new Error("conflict"), { condition: "conflict", name: "StreamError" })), "conflict · StreamError");
  assert.equal(describeForLog(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), "ECONNRESET · read ECONNRESET");
  assert.equal(describeForLog(null), "");
});
