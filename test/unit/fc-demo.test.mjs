// Modo FC en el modo demo (npm run demo): el perfil de ejemplo trae el Modo FC listo contra el bot simulado, y con la
// cuenta de la demo cada grupo da el estado que se quiere enseñar. Usa lo mismo que la ventana «Enviar ping»
// (normalizeFcMode, barGroups, buildRequest, buildPlan, interpretReply) contra el servidor simulado con MOCK_DEMO=1.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { client, xml } from "@xmpp/client";
import { writeDemoProfile, demoFcMode, DEMO_ACCOUNT, DEMO_JID, DEMO_PASSWORD } from "../demo/profile.mjs";
import { normalizeFcMode } from "../../src/main/store.js";
import { barGroups, buildRequest, templateText, countInvisible } from "../../src/renderer/js/fc-compose.js";
import { sortSaved, quickText, savedGroupsIn } from "../../src/renderer/js/fc-quick.js";
import { DEFAULT_FORMAT } from "../../src/renderer/js/settings/fc.js";
import { buildPlan, interpretReply, isBroadcastEcho } from "../../src/renderer/js/fc-send.js";
import { tempDir } from "./helpers.mjs";

const PORT = 19750 + Math.floor(Math.random() * 200);
const [USER, DOMAIN] = DEMO_JID.split("@");
let mock;

before(async () => {
  mock = spawn(process.execPath, [fileURLToPath(new URL("../mock-xmpp.mjs", import.meta.url))], { env: { ...process.env, MOCK_PORT: String(PORT), MOCK_DEMO: "1" }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    mock.once("exit", (code) => reject(new Error(`el servidor simulado terminó (${code})`)));
    mock.stdout.on("data", (d) => String(d).includes("mock XMPP en") && resolve());
  });
});
after(() => mock?.kill());

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("el perfil de demo trae el Modo FC activado: canal pingbot, modo line, grupos con botón y firmado «Bob FC»", (t) => {
  const dir = tempDir(t);
  writeDemoProfile(dir, { port: 1 });
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8")).settings.fcMode;
  const fc = normalizeFcMode(saved);
  assert.equal(fc.enabled, true);
  assert.deepEqual(fc.channel, { accountId: DEMO_ACCOUNT, jid: `pingbot@${DOMAIN}`, kind: "chat" });
  assert.deepEqual([fc.groupMode, fc.lineFormat, fc.template.signAs], ["line", "!ping {grupo}", "Bob FC"]);
  assert.equal(fc.template.format, DEFAULT_FORMAT, "la plantilla de serie");
  assert.deepEqual(
    fc.groups.map((g) => [g.name, g.button]),
    [
      ["all", true],
      ["caps", true],
      ["supers", true],
      ["silent", true],
    ],
  );
  // Tal cual lo deja el normalizador: no se pierde nada al cargarlo.
  assert.deepEqual(normalizeFcMode(fc), fc);
  // Los cuatro salen como botón en la barra «Para» (aunque supers y silent no se vean en los pings).
  assert.deepEqual(
    barGroups(fc, []).map((g) => g.name),
    ["all", "caps", "supers", "silent"],
  );
});

test("pings guardados de ejemplo: Strat op Ferox (all+caps), Home defense (all) y uno pegado con dos invisibles (caps)", () => {
  const NOW = Date.UTC(2026, 10, 5, 12, 0);
  const fc = normalizeFcMode(demoFcMode(NOW));
  assert.equal(fc.savedOrder, "used");
  // El normalizador no quita nada: todos los campos son válidos.
  assert.deepEqual(fc.saved, demoFcMode(NOW).saved);
  assert.deepEqual(
    sortSaved(fc.saved, fc.savedOrder).map((q) => [q.name, q.kind, q.groups]),
    [
      ["Strat op Ferox", "template", ["all", "caps"]],
      ["Home defense", "template", ["all"]],
      ["Caps a staging (pegado)", "paste", ["caps"]],
    ],
  );
  const strat = fc.saved.find((q) => q.id === "demo-strat");
  const text = quickText(fc, strat, "19:00");
  assert.match(text, /^Strat op · FC: Bob FC\nFormup: 19:00 EVE · Home station\nDoctrine: Ferox/);
  const pasted = fc.saved.find((q) => q.kind === "paste");
  assert.equal(countInvisible(pasted.text), 2);
  assert.equal(quickText(fc, pasted, "19:00"), pasted.text, "el pegado sale tal cual, con sus invisibles");
  // Sus grupos están en la barra «Para».
  for (const q of fc.saved) assert.deepEqual(savedGroupsIn(q, barGroups(fc, [])), q.groups);
});

test("con la cuenta de la demo: enviado a all y caps, rechazado en supers y sin confirmar en silent", async (t) => {
  const fc = normalizeFcMode(demoFcMode());
  const c = client({ service: `xmpp://127.0.0.1:${PORT}`, domain: DOMAIN, resource: "demo", credentials: (auth) => auth({ username: USER, password: DEMO_PASSWORD }, "PLAIN") });
  c.on("error", () => {});
  const inbox = [];
  c.on("stanza", (s) => s.is("message") && s.getChildText("body") != null && inbox.push(s.getChildText("body")));
  await c.start();
  t.after(() => c.stop().catch(() => {}));

  const text = templateText(fc.template.format, { type: "CTA", fc: fc.template.signAs, time: "19:00", place: "Jita", doctrine: "Ferox", comms: "Op 1" }, fc.template.fields);
  const plan = buildPlan(buildRequest(fc, barGroups(fc, []), text));
  const status = {};
  for (const p of plan) {
    const before = inbox.length;
    await c.send(xml("message", { to: p.to, type: "chat" }, xml("body", {}, p.body)));
    // Como la ventana: la primera respuesta del bot que no sea un ping reenviado; sin ella, a la espera (aquí corta).
    let reply = null;
    for (let i = 0; i < 20 && !reply; i++) {
      await wait(50);
      const b = inbox.slice(before).find((x) => !isBroadcastEcho(x));
      if (b != null) reply = { body: b };
    }
    status[p.group] = interpretReply(reply, { mode: fc.groupMode }).status;
  }
  assert.deepEqual(status, { all: "sent", caps: "sent", supers: "rejected", silent: "unconfirmed" });
  // Es de all y de caps: le llegan los dos pings con el pie del bot y su texto tal cual.
  const echoes = inbox.filter(isBroadcastEcho);
  assert.equal(echoes.length, 2);
  assert.ok(echoes.every((b) => b.startsWith(text.replace(/\n+$/, ""))));
});
