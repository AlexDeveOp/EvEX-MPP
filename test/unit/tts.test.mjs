import { test } from "node:test";
import assert from "node:assert/strict";
import { pingSpeech, fillTemplate, pingValues, shouldSpeak, VOICE_DEFAULTS } from "../../src/renderer/js/tts.js";

const ZW = String.fromCharCode(0x200b, 0x200c);
const PING = `Capital fleet up now!!\nFC Name:${ZW} Bob FC\nFormup Location: Jita\nPAP Type: Strategic\nComms: Op 1 https://example.com/comms\nDoctrine: Typhoons\n\n~~~ This was a coord broadcast from bob to caps at 2026-11-02 12:00:00 EVE ~~~`;
const cfg = (extra = {}) => ({ ...VOICE_DEFAULTS, enabled: true, ...extra });

test("pingValues saca los campos con nombre, sin invisibles ni enlaces", () => {
  const { values } = pingValues(PING);
  assert.equal(values.title, "Capital fleet up now!!");
  assert.equal(values.fc, "Bob FC");
  assert.equal(values.formup, "Jita");
  assert.equal(values.doctrine, "Typhoons");
  assert.equal(values.comms, "Op 1", "el enlace no se lee");
  assert.equal(values.group, "caps");
  assert.equal(values.from, "bob");
});

test("pingSpeech: resumen, solo el título, todo y plantilla propia", () => {
  assert.equal(pingSpeech(PING, cfg()), "Capital fleet up now!! FC Bob FC. Formup Jita. Doctrine Typhoons.");
  assert.equal(pingSpeech(PING, cfg({ content: "title" })), "Capital fleet up now!!");
  const full = pingSpeech(PING, cfg({ content: "full" }));
  assert.match(full, /PAP Type: Strategic/);
  assert.doesNotMatch(full, /https?:|~~~/);
  assert.equal(pingSpeech(PING, cfg({ content: "template", template: "Ping para {group}. Formup en {formup}." })), "Ping para caps. Formup en Jita.");
});

test("fillTemplate quita las frases con campos vacíos", () => {
  assert.equal(fillTemplate("{title}. FC {fc}. Formup {formup}.", { title: "Fleet up", fc: "", formup: "Amarr" }), "Fleet up. Formup Amarr.");
  assert.equal(fillTemplate("{nada}", {}), "");
});

test("pingSpeech: un ping sin campos se lee tal cual y se corta en la longitud máxima", () => {
  assert.equal(pingSpeech("Reship and undock now", cfg()), "Reship and undock now.");
  const long = pingSpeech(`Fleet ${"word ".repeat(200)}`, cfg({ content: "title", maxChars: 100 }));
  assert.ok(long.length <= 101 && long.endsWith("…"));
});

test("shouldSpeak respeta el interruptor, la ventana, «No molestar» y los grupos", () => {
  assert.equal(shouldSpeak(PING, { ...VOICE_DEFAULTS }), false, "desactivado por defecto");
  assert.equal(shouldSpeak(PING, cfg(), { focused: true, dnd: false }), true);
  assert.equal(shouldSpeak(PING, cfg({ when: "unfocused" }), { focused: true, dnd: false }), false);
  assert.equal(shouldSpeak(PING, cfg({ when: "unfocused" }), { focused: false, dnd: false }), true);
  assert.equal(shouldSpeak(PING, cfg({ dnd: false }), { focused: false, dnd: true }), false);
  assert.equal(shouldSpeak(PING, cfg({ groups: "all, CAPS" }), { focused: false, dnd: false }), true);
  assert.equal(shouldSpeak(PING, cfg({ groups: "supers" }), { focused: false, dnd: false }), false);
});
