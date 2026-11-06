// El texto de los pings se enseña TAL CUAL, con sus caracteres invisibles (marcas de agua de algunas alianzas): en la
// tarjeta, en la burbuja del ping, en el aviso del formup y en los datos de la flota. Solo se ignoran por dentro para
// reconocer campos, pie y horas. Se construyen con String.fromCharCode para que el fichero no lleve invisibles sueltos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { S, convKey, PINGS_KEY } from "../../src/renderer/js/state.js";
import { parsePing } from "../../src/renderer/js/pings.js";
import { ingestMessage, pingsConv } from "../../src/renderer/js/convs.js";
import { startFormupWatch } from "../../src/renderer/js/formup.js";
import { fleetDetails, allFleets } from "../../src/renderer/js/fleets.js";
import { trimSpaces, hasVisible, cutChars, removeCleanRange, withoutInvisible } from "../../src/renderer/js/invisible.js";
import { TEST_SETTINGS } from "./helpers.mjs";

const [ZW, ZNJ, WJ, BOM] = [0x200b, 0x200c, 0x2060, 0xfeff].map((c) => String.fromCharCode(c));
const NL = String.fromCharCode(10);
const footer = (to = "all") => `~~~ This was a coord broadcast from bob to ${to} at 2026-11-03 12:00:00.000000 EVE ~~~`;

const notes = [];
globalThis.window.evex = { call: async (ch, data) => (ch === "notify" ? notes.push(data) : null), on: () => {} };
S.settings = structuredClone({
  ...TEST_SETTINGS,
  notifications: { enabled: true, pings: true, sound: false, volume: 0, sounds: {}, keywords: [], keywordRules: [], roomModes: {} },
  pingSenders: ["pingbot"],
  pingVoice: { enabled: false },
  pingCountdown: { enabled: true, alert: true, befores: [5], atTime: true },
});
S.accounts = [{ id: "a1", jid: "yo@ejemplo.com", nick: "yo", alias: "yo", rooms: [] }];
S.tabs = [PINGS_KEY, convKey("a1", "pingbot@ejemplo.com")];
S.focused = false;

test("las utilidades: espacios fuera, invisibles dentro", () => {
  assert.equal(trimSpaces(`  ${BOM}Hola${ZW}  `), `${BOM}Hola${ZW}`, "trim() se comería el U+FEFF");
  assert.equal(hasVisible(`${ZW}${BOM} `), false);
  assert.equal(hasVisible(`${ZW}a`), true);
  assert.equal(cutChars("ab" + String.fromCodePoint(0x1f680) + "cd", 3), "ab" + String.fromCodePoint(0x1f680));
  // Quitar un trozo localizado en la copia limpia deja intactos los invisibles de fuera.
  const raw = `Ti${ZW}tle ~~~ pie${ZNJ} ~~~`;
  const clean = withoutInvisible(raw);
  const at = clean.indexOf("~~~");
  assert.equal(removeCleanRange(raw, at, clean.length - at), `Ti${ZW}tle `);
});

test("la tarjeta: título, campos y texto conservan sus invisibles; el pie se reconoce igual", () => {
  const body = [`${BOM}Capital${ZW} fleet up${WJ}`, `FC Name:${ZW}${ZNJ} Bob${ZW} FC`, `Doctrine: Ty${ZW}phoons${BOM}`, "", `Bring${ZW} caps`, "", footer("caps")].join(NL);
  const p = parsePing(body);
  assert.equal(p.title, `${BOM}Capital${ZW} fleet up${WJ}`);
  assert.deepEqual(
    p.fields.map((f) => [f.key, f.value]),
    [
      ["FC Name", `${ZW}${ZNJ} Bob${ZW} FC`],
      ["Doctrine", `Ty${ZW}phoons${BOM}`],
    ],
  );
  assert.deepEqual(p.extra, [`Bring${ZW} caps`]);
  assert.equal(p.footer.to, "caps");
});

test("si el pie solo se reconoce sin los invisibles, el resto de la línea sigue con los suyos", () => {
  const body = [`Fleet${ZW} up`, `Form${ZW} now ~~~ This was a${ZW} broadcast from alice to all at 12:00 EVE ~~~`].join(NL);
  const p = parsePing(body);
  assert.equal(p.footer.from, "alice");
  assert.deepEqual([p.title, ...p.extra], [`Fleet${ZW} up`, `Form${ZW} now`]);
});

test("la burbuja del ping lleva el texto tal cual; sin nada visible, «Ping de flota»", async () => {
  notes.length = 0;
  ingestMessage({ accountId: "a1", conv: "pingbot@ejemplo.com", convType: "chat", nick: "pingbot", id: "p1", ts: Date.now(), body: [`Capital${ZW} fleet`, `FC Name:${ZW} Bob`, `Doctrine: Fer${ZW}ox`, "", `Extra${ZW} info`, "", footer()].join(NL) });
  await new Promise((r) => setTimeout(r, 0));
  const n = notes.find((x) => x.kind === "ping");
  assert.ok(n, "salió la burbuja");
  assert.equal(n.title, `Capital${ZW} fleet`);
  assert.deepEqual(
    n.fields.map((f) => f.value),
    [`${ZW} Bob`, `Fer${ZW}ox`],
  );
  assert.equal(n.text, `Extra${ZW} info`);
  notes.length = 0;
  ingestMessage({ accountId: "a1", conv: "pingbot@ejemplo.com", convType: "chat", nick: "pingbot", id: "p2", ts: Date.now() + 1, body: `${ZW}${BOM}` });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(notes.find((x) => x.kind === "ping")?.title, "Ping de flota");
});

test("el aviso del formup y los datos de la flota llevan el texto tal cual", async (t) => {
  // Reloj simulado: el formup es dentro de 6 min y se avanza hasta pasar el aviso de «5 min antes».
  const start = Date.UTC(2026, 10, 6, 18, 0, 0);
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: start });
  notes.length = 0;
  const pc = pingsConv();
  pc.loaded = true;
  const now = Date.now();
  const at = new Date(now + 6 * 60e3);
  const hhmm = `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`;
  const date = at.toISOString().slice(0, 10);
  pc.messages.push({ key: "f1", ts: now - 60e3, nick: "pingbot", body: [`Sub${ZW}cap fleet`, `FC Name:${ZW} Bob`, `Formup Time: ${date} ${hhmm}`, `Doctrine: Fer${ZW}ox${BOM}`, "", footer()].join(NL) });
  const fleet = allFleets().find((f) => f.pingKeys?.includes("f1"));
  assert.ok(fleet, "la flota del ping");
  assert.equal(fleet.title, `Sub${ZW}cap fleet`);
  const d = fleetDetails(fleet);
  assert.equal(d.fc, `${ZW} Bob`);
  assert.equal(d.doctrine, `Fer${ZW}ox${BOM}`, "sin trim(), que quitaría el U+FEFF");
  startFormupWatch();
  for (let i = 0; i < 8; i++) t.mock.timers.tick(15000);
  await new Promise((r) => setImmediate(r));
  const n = notes.find((x) => x.reminder);
  assert.ok(n, "salió el aviso del formup");
  assert.equal(n.text, `Sub${ZW}cap fleet`);
  assert.ok(n.fields.some((f) => f.value === `Fer${ZW}ox${BOM}`), JSON.stringify(n.fields));
});

test("al pintar un campo, el espacio de detrás de los invisibles iniciales no deja hueco; el valor guardado no cambia", async () => {
  const { spaceAfterLeadingInvisible } = await import("../../src/renderer/js/invisible.js");
  assert.equal(spaceAfterLeadingInvisible(`${ZW}${ZNJ} Bob`), `${ZW}${ZNJ}Bob`);
  assert.equal(spaceAfterLeadingInvisible(`${ZW}Bob ${ZW} FC`), `${ZW}Bob ${ZW} FC`, "solo al principio");
  assert.equal(spaceAfterLeadingInvisible(" Bob"), " Bob", "sin invisibles delante, nada");
  assert.equal(spaceAfterLeadingInvisible(`${BOM}\tBob`), `${BOM}Bob`);
  const p = parsePing([`Op`, `FC Name:${ZW} Bob`].join(NL));
  assert.equal(p.fields[0].value, `${ZW} Bob`, "lo guardado sigue tal cual");
});
