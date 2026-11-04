import { test } from "node:test";
import assert from "node:assert/strict";
import { pingFingerprint, isPingSender, createPingDedupe, REPEAT_MS } from "../../src/main/ping-dedupe.js";

const ping = (stamp) => `Form up now!\nFC Name:\u200b Bob FC\n\n~~~ This was a coord broadcast from bob to all at ${stamp} EVE ~~~`;

test("pingFingerprint: ignora la hora del pie, los invisibles y los espacios", () => {
  assert.equal(pingFingerprint(ping("2026-11-04 17:50:24.895801")), pingFingerprint(ping("2026-11-04 17:50:25.895801")));
  assert.equal(pingFingerprint("a\r\n b"), pingFingerprint("a b\u200b"));
  assert.notEqual(pingFingerprint(ping("2026-11-04 17:50:24")), pingFingerprint(ping("2026-11-04 17:50:24").replace("Bob", "Ann")));
});

test("isPingSender: con y sin dominio, sin distinguir mayúsculas", () => {
  assert.equal(isPingSender(["pingbot"], "yo@ejemplo.com/EvEX", "PingBot@ejemplo.com"), true);
  assert.equal(isPingSender(["bot@otro.example"], "yo@ejemplo.com", "bot@otro.example"), true);
  assert.equal(isPingSender(["pingbot"], "yo@ejemplo.com", "amigo@ejemplo.com"), false);
  assert.equal(isPingSender([], "yo@ejemplo.com", "pingbot@ejemplo.com"), false);
});

test("createPingDedupe: la segunda copia casi simultánea es repetida; la misma más tarde o en otra conversación, no", () => {
  const d = createPingDedupe();
  const t0 = 1793814624752;
  assert.equal(d.repeated("a/pingbot", ping("2026-11-04 17:50:24.895801"), t0), false);
  assert.equal(d.repeated("a/pingbot", ping("2026-11-04 17:50:25.895801"), t0 + 19), true);
  assert.equal(d.repeated("b/pingbot", ping("2026-11-04 17:50:24.895801"), t0 + 20), false);
  assert.equal(d.repeated("a/pingbot", ping("2026-11-04 17:50:24.895801").replace("Bob", "Ann"), t0 + 30), false);
  assert.equal(d.repeated("a/pingbot", ping("2026-11-04 17:52:00"), t0 + REPEAT_MS + 1000), false);
});
