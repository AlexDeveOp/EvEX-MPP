import { test } from "node:test";
import assert from "node:assert/strict";
import { captureNotification, captureMiniState } from "../../src/main/capture.js";

const ZW = String.fromCharCode(0x200b);

test("modo captura: el aviso de un ping va sin contenido (ni título, ni campos, ni hora, ni pie)", () => {
  const ping = {
    kind: "ping",
    title: `Capital fleet up now!!${ZW}`,
    text: "",
    fields: [{ key: "Formup Location", value: "1DQ1-A" }, { key: "Doctrine", value: "Typhoons" }],
    footer: "Formup a las 19:00 EVE",
    time: { local: "20:00", eve: "19:00" },
    sticky: true,
    accountId: null,
    conv: "*",
    convType: "pings",
    colors: { warn: "#e3b341" },
  };
  const out = captureNotification(ping);
  assert.deepEqual(out, { kind: "ping", sticky: true, accountId: null, conv: "*", convType: "pings", colors: { warn: "#e3b341" }, title: "Nuevo ping de flota", text: "", fields: [] });
  assert.equal(JSON.stringify(out).includes("1DQ1"), false);
  assert.equal(ping.title, `Capital fleet up now!!${ZW}`, "el original no se toca");
  assert.equal(ping.fields.length, 2);
});

test("modo captura: el aviso de un mensaje no dice quién ni en qué sala", () => {
  const out = captureNotification({ kind: "msg", title: "bob en capitales", text: "nos vemos en el timer de C-J", avatar: "media://x.png", accountId: "a1", conv: "capitales@conference.ejemplo.com", convType: "groupchat", time: { local: "20:00" } });
  assert.equal(out.title, "Nuevo mensaje");
  assert.equal(out.text, "");
  assert.equal("avatar" in out || "time" in out, false);
  assert.equal(out.conv, "capitales@conference.ejemplo.com", "se conserva para abrir la conversación al pulsar (no se enseña)");
});

test("modo captura: la mini ventana se queda solo con los contadores (lista blanca)", () => {
  const st = { ping: { title: "Capital fleet", group: "all", ts: 1 }, fleets: [{ at: 2, title: "Final timer", group: "caps" }], countdown: true, unread: 3, pings: 1, mentions: 2, clickThrough: false, lang: "es", colors: { warn: "#e3b341" }, algoNuevo: "secreto" };
  assert.deepEqual(captureMiniState(st), { ping: null, fleets: [], countdown: false, capture: true, unread: 3, pings: 1, mentions: 2, clickThrough: false, lang: "es", colors: { warn: "#e3b341" } });
  assert.equal(captureMiniState(null), null);
});
