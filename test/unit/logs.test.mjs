import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Logs } from "../../src/main/logs.js";
import { tempDir } from "./helpers.mjs";

test("append guarda y tail devuelve los mensajes de la conversación", (t) => {
  const logs = new Logs(tempDir(t));
  logs.append("acc1", "Sala@conference.example.com", { ts: 1000, nick: "ana", body: "hola" });
  logs.append("acc1", "sala@conference.example.com", { ts: 2000, nick: "bob", body: "qué tal", outgoing: true });
  const all = logs.tail("acc1", "sala@conference.example.com");
  assert.deepEqual(
    all.map((e) => [e.nick, e.body]).sort(),
    [
      ["ana", "hola"],
      ["bob", "qué tal"],
    ],
  );
  assert.equal(all.find((e) => e.nick === "bob").out, 1);
  assert.equal(logs.lastTimestamp("acc1", "sala@conference.example.com"), 2000);
});

test("append descarta duplicados exactos y el historial reenviado por la sala", (t) => {
  const logs = new Logs(tempDir(t));
  const conv = "sala@conference.example.com";
  assert.ok(logs.append("a", conv, { ts: 10_000, nick: "ana", body: "hola" }));
  assert.equal(logs.append("a", conv, { ts: 10_000, nick: "ana", body: "hola" }), null);
  // La sala reenvía el mismo mensaje como historial con una hora algo distinta.
  assert.equal(logs.append("a", conv, { ts: 40_000, nick: "ana", body: "hola", delayed: true }), null);
  // El mismo texto como mensaje nuevo, no reenviado, sí se guarda.
  assert.ok(logs.append("a", conv, { ts: 40_000, nick: "ana", body: "hola" }));
  assert.equal(logs.tail("a", conv).length, 2);
});

test("el nombre del fichero no permite salir de la carpeta del historial", (t) => {
  const base = tempDir(t);
  const logs = new Logs(base);
  const file = logs.file("acc", "../../etc/passwd");
  assert.equal(path.dirname(file), path.join(base, "acc"));
  assert.ok(!path.basename(file).includes("/"));
});

test("tail lee solo el final de los ficheros grandes", (t) => {
  const logs = new Logs(tempDir(t));
  const file = logs.file("a", "grande@example.com");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line = JSON.stringify({ ts: 1, nick: "x", body: "x".repeat(1000) }) + "\n";
  fs.writeFileSync(file, line.repeat(5000) + JSON.stringify({ ts: 2, nick: "y", body: "último" }) + "\n");
  assert.ok(fs.statSync(file).size > 4 * 1024 * 1024);
  const last = logs.tail("a", "grande@example.com", 3);
  assert.equal(last.length, 3);
  assert.ok(last.some((e) => e.body === "último"));
});

test("tail de una conversación sin fichero devuelve una lista vacía", (t) => {
  assert.deepEqual(new Logs(tempDir(t)).tail("a", "nadie@example.com"), []);
});

test("mergeImport añade lo nuevo en orden y no repite lo que ya había", (t) => {
  const logs = new Logs(tempDir(t));
  const conv = "bob@example.com";
  logs.append("a", conv, { ts: 5000, nick: "bob", body: "segundo" });
  const added = logs.mergeImport("a", conv, [
    { ts: 9000, nick: "bob", body: "tercero" },
    { ts: 1000, nick: "bob", body: "primero" },
    { ts: 5000, nick: "bob", body: "segundo" },
  ]);
  assert.equal(added, 2);
  const lines = fs.readFileSync(logs.file("a", conv), "utf8").trim().split("\n").map((l) => JSON.parse(l).body);
  assert.deepEqual(lines, ["primero", "segundo", "tercero"]);
  assert.equal(logs.mergeImport("a", conv, [{ ts: 1000, nick: "bob", body: "primero" }]), 0);
});

test("search busca por texto y por apodo en todas las conversaciones", (t) => {
  const logs = new Logs(tempDir(t));
  logs.append("a", "sala1@example.com", { ts: 1, nick: "ana", body: "Formup en Jita" });
  logs.append("a", "sala2@example.com", { ts: 2, nick: "bob", body: "jita otra vez" });
  logs.append("a", "sala2@example.com", { ts: 3, nick: "bob", body: "nada que ver" });
  const r = logs.search("a", { query: "JITA" });
  assert.deepEqual(
    r.map((e) => e.conv),
    ["sala2@example.com", "sala1@example.com"],
  );
  assert.equal(logs.search("a", { query: "jita", nick: "ana" }).length, 1);
});
