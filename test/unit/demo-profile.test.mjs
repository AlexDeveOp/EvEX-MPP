// Modo demo (npm run demo): el perfil de ejemplo y la limpieza de perfiles viejos. Sin arrancar la app ni el mock.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { writeDemoProfile, demoPings, demoRoomHistory, DEMO_ROOMS, DEMO_ACCOUNT } from "./../demo/profile.mjs";
import { pruneDemoProfiles, demoProfiles, PREFIX } from "../../scripts/demo.mjs";
import { parseFleetTime, parseFormup } from "../../src/renderer/js/fleet-time.js";
import { parsePing } from "../../src/renderer/js/pings.js";
import { S } from "../../src/renderer/js/state.js";
import { Logs } from "../../src/main/logs.js";
import { tempDir, TEST_SETTINGS } from "./helpers.mjs";

S.settings = structuredClone(TEST_SETTINGS);
const NOW = Date.UTC(2026, 10, 5, 12, 0); // jueves 12:00 EVE

test("writeDemoProfile escribe config.json y el historial solo dentro de la carpeta indicada", (t) => {
  const dir = path.join(tempDir(t), `${PREFIX}x`);
  const r = writeDemoProfile(dir, { port: 5999, now: NOW });
  assert.equal(r.accountId, DEMO_ACCOUNT);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
  const acc = cfg.accounts[0];
  assert.deepEqual([acc.host, acc.port, acc.autoLogin], ["127.0.0.1", 5999, true]);
  assert.deepEqual(
    acc.rooms.map((x) => x.jid),
    Object.values(DEMO_ROOMS).map((x) => x.jid),
  );
  assert.equal(cfg.settings.notifications.roomModes[`${DEMO_ACCOUNT}|${DEMO_ROOMS.general.jid}`], "none");
  assert.equal(cfg.settings.notifications.roomModes[`${DEMO_ACCOUNT}|${DEMO_ROOMS.logistica.jid}`], "mentions");
  assert.equal(cfg.settings.notifications.dndSchedule.enabled, false);
  assert.equal(cfg.settings.mini.enabled, true);
  assert.equal(Object.values(cfg.settings.fleets.items)[0].source, "manual");
  const logs = new Logs(path.join(dir, "logs"));
  assert.equal(logs.tail(DEMO_ACCOUNT, "pingbot@ejemplo.com", 100).length, demoPings(NOW).length);
  assert.ok(logs.tail(DEMO_ACCOUNT, DEMO_ROOMS.capitales.jid, 100).some((e) => /big op on \w+ at 21:00/.test(e.body)));
  // Nada fuera del perfil.
  assert.deepEqual(fs.readdirSync(path.dirname(dir)), [path.basename(dir)]);
});

test("los datos de ejemplo son genéricos: solo dominios de ejemplo y nada personal", (t) => {
  const dir = tempDir(t);
  writeDemoProfile(dir, { port: 1, now: NOW });
  const text = [fs.readFileSync(path.join(dir, "config.json"), "utf8"), ...fs.readdirSync(path.join(dir, "logs", DEMO_ACCOUNT)).map((f) => fs.readFileSync(path.join(dir, "logs", DEMO_ACCOUNT, f), "utf8"))].join("\n");
  const domains = new Set([...text.matchAll(/[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|local|es)\b/g)].map((m) => m[0].toLowerCase()));
  for (const d of domains) assert.match(d, /(^|\.)ejemplo\.com$/, d);
  assert.doesNotMatch(text, /goon|gmail|alejandro|@users\.noreply/i);
});

test("las horas van con el momento de crear el perfil: formups hoy, mañana y el sábado, uno pasado y una sugerida futura", () => {
  const pings = demoPings(NOW);
  assert.ok(pings.length >= 10);
  const formups = pings.map((p) => parseFormup(parsePing(p.body), p.ts)).filter(Boolean);
  const day = (ts) => Math.floor(ts / 86400e3) - Math.floor(NOW / 86400e3);
  const days = new Set(formups.map(day));
  assert.ok(days.has(0) && days.has(1) && days.has(2), [...days].join(","));
  assert.ok(formups.some((at) => at < NOW), "uno ya pasado");
  assert.ok(pings.some((p) => /caps ~~~|to caps at/.test(p.body)), "uno a caps");
  const free = pings.find((p) => p.body.startsWith("Tomorrow at 17:15"));
  assert.equal(parseFleetTime(free.body, free.ts), Date.UTC(2026, 10, 6, 17, 15));
  assert.match(free.body, /https:\/\/foro\.ejemplo\.com\/calendar\/event\/123-final-timer/);
  // Todo el historial es anterior a ahora.
  assert.ok(pings.every((p) => p.ts < NOW));
  const op = demoRoomHistory(NOW).capitales.find((m) => m.body.startsWith("big op"));
  const at = parseFleetTime(op.body, op.ts);
  assert.ok(at > NOW && at < NOW + 7 * 86400e3, new Date(at).toISOString());
});

test("pruneDemoProfiles deja los 3 más recientes y solo borra carpetas evex-demo-*", (t) => {
  const base = tempDir(t);
  const mk = (name, ageMin) => {
    const p = path.join(base, name);
    fs.mkdirSync(p);
    const time = new Date(Date.now() - ageMin * 60e3);
    fs.utimesSync(p, time, time);
    return p;
  };
  const profiles = [1, 2, 3, 4, 5].map((n) => mk(`${PREFIX}${n}`, n * 10));
  const other = mk("otra-carpeta", 999);
  fs.writeFileSync(path.join(base, `${PREFIX}fichero.txt`), "no es una carpeta");
  const removed = pruneDemoProfiles(base, 3, profiles[0]);
  assert.deepEqual(removed.sort(), [profiles[3], profiles[4]].sort());
  assert.deepEqual(demoProfiles(base), profiles.slice(0, 3));
  assert.ok(fs.existsSync(other));
  assert.ok(fs.existsSync(path.join(base, `${PREFIX}fichero.txt`)));
});
