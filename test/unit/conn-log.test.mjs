import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createConnLog, describeForLog } from "../../src/main/conn-log.js";
import { tempDir } from "./helpers.mjs";

test("el registro de conexión apunta cada línea con hora y cuenta, y rota al llenarse", (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, "sub", "connection.log");
  const log = createConnLog(file, { maxBytes: 200, echo: false });
  log("cuenta1", "connect");
  const first = fs.readFileSync(file, "utf8");
  assert.match(first, /^\d{4}-\d\d-\d\dT[\d:.]+Z \[cuenta1\] connect\n$/);
  for (let i = 0; i < 10; i++) log("cuenta1", `línea ${i}`);
  const old = path.join(dir, "sub", "connection.old.log");
  assert.ok(fs.existsSync(old), "el anterior se guarda aparte");
  assert.ok(fs.statSync(file).size <= 200);
  assert.match(fs.readFileSync(file, "utf8"), /línea 9/);
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
