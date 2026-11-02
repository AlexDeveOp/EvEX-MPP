import { test } from "node:test";
import assert from "node:assert/strict";
import { S } from "../../src/renderer/js/state.js";
import { parsePing, pingMatches, pingGroups } from "../../src/renderer/js/pings.js";
import { TEST_SETTINGS } from "./helpers.mjs";

S.settings = structuredClone(TEST_SETTINGS);

const ZW = String.fromCharCode(0x200b, 0x200c); // marcas invisibles que algunos bots añaden a los pings
const PING = [
  "Capital fleet up now!!",
  `FC Name:${ZW} Bob FC`,
  "Formup Location: Jita",
  "PAP Type: Strategic",
  "Comms: Op 1 https://example.com/comms",
  "Doctrine: Typhoons",
  "",
  "~~~ This was a coord broadcast from bob to all at 2026-11-02 12:00:00.000000 EVE ~~~",
].join("\n");

test("parsePing separa título, campos y pie", () => {
  const p = parsePing(PING);
  assert.equal(p.title, "Capital fleet up now!!");
  assert.deepEqual(
    p.fields.map((f) => [f.key, f.value]),
    [
      ["FC Name", "Bob FC"],
      ["Formup Location", "Jita"],
      ["PAP Type", "Strategic"],
      ["Comms", "Op 1 https://example.com/comms"],
      ["Doctrine", "Typhoons"],
    ],
  );
  assert.deepEqual(p.footer, { from: "bob", to: "all", at: "2026-11-02 12:00:00.000000 EVE" });
});

test("parsePing reconoce el pie al final de otra línea y con caracteres invisibles", () => {
  const p = parsePing(`Form up${ZW}\nDoctrine: Ferox ~~~ This was a${ZW} broadcast from alice to caps at 12:00 EVE ~~~`);
  assert.equal(p.footer?.from, "alice");
  assert.equal(p.footer?.to, "caps");
  assert.deepEqual(p.fields, [{ key: "Doctrine", value: "Ferox" }]);
});

test("parsePing no confunde una URL con un campo", () => {
  const p = parsePing("Mirad esto\nhttps://example.com/x");
  assert.equal(p.fields.length, 0);
  assert.equal(p.title, "Mirad esto https://example.com/x");
});

test("parsePing sin título usa «Ping»", () => {
  assert.equal(parsePing("Doctrine: Muninn").title, "Ping");
});

test("pingMatches filtra por grupo y por texto ignorando invisibles", () => {
  const m = { body: PING };
  assert.ok(pingMatches(m, "", "all"));
  assert.ok(!pingMatches(m, "", "caps"));
  assert.ok(pingMatches(m, "bob fc"));
  assert.ok(pingMatches(m, "TYPHOONS"));
  assert.ok(!pingMatches(m, "ravens"));
});

test("pingGroups devuelve los destinatarios sin repetir y ordenados", () => {
  const other = PING.replace("to all", "to caps");
  assert.deepEqual(pingGroups([{ body: PING }, { body: other }, { body: PING }, { body: "sin pie" }]), ["all", "caps"]);
});

test("isFreshPing: la sirena late según la duración elegida", async () => {
  const { isFreshPing } = await import("../../src/renderer/js/pings.js");
  const now = Date.UTC(2026, 10, 3, 12, 0, 0);
  const min = 60e3;
  assert.equal(isFreshPing(now - 59 * min, "60", now), true);
  assert.equal(isFreshPing(now - 61 * min, "60", now), false, "a la hora deja de latir");
  assert.equal(isFreshPing(now - 4 * min, "5", now), true);
  assert.equal(isFreshPing(now - 6 * min, "5", now), false);
  assert.equal(isFreshPing(now, "0", now), false, "«Nunca» no late ni con un ping recién llegado");
  assert.equal(isFreshPing(now - 90 * min, "120", now), true);
});

test("isFreshPing: «hasta volver a abrir los pings» depende de cuándo se salió de la vista", async () => {
  const { isFreshPing } = await import("../../src/renderer/js/pings.js");
  const seenAt = Date.UTC(2026, 10, 3, 10, 0, 0);
  const now = Date.UTC(2026, 10, 3, 18, 0, 0);
  assert.equal(isFreshPing(seenAt + 1000, "unseen", now, seenAt), true, "llegó después: late aunque tenga horas");
  assert.equal(isFreshPing(seenAt - 1000, "unseen", now, seenAt), false, "ya estaba al salir: no late");
});
