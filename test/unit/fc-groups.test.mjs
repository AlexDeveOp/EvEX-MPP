import { test } from "node:test";
import assert from "node:assert/strict";
import { S } from "../../src/renderer/js/state.js";
import { learnedGroups, groupRows, groupUsable, upsertGroup, removeGroup } from "../../src/renderer/js/fc-groups.js";
import { TEST_SETTINGS } from "./helpers.mjs";

S.settings = structuredClone(TEST_SETTINGS);

const ZW = String.fromCharCode(0x200b);
let n = 0;
const ping = (to, extra = "") => ({ key: `k${n++}`, body: `Fleet up\nFC: Bob FC\n\n~~~ This was a coord broadcast from bob to ${to} at 2026-11-02 12:00:00 EVE ~~~${extra}` });

test("learnedGroups cuenta los grupos del pie, de más a menos usado", () => {
  const msgs = [ping("all"), ping("caps"), ping("all"), ping("all"), ping("caps"), ping("logistica"), { key: "x", body: "sin pie" }];
  assert.deepEqual(learnedGroups(msgs), [
    { name: "all", count: 3 },
    { name: "caps", count: 2 },
    { name: "logistica", count: 1 },
  ]);
});

test("learnedGroups no separa por mayúsculas, reconoce el pie con invisibles e ignora los enviados", () => {
  const withInvisible = { key: "z", body: `Ping\n~~~ This was a${ZW} broadcast from bob to supers at 2026-11-02 12:00:00 EVE ~~~` };
  const out = { ...ping("all"), out: true };
  assert.deepEqual(learnedGroups([ping("Caps"), ping("caps"), withInvisible, out, null]), [
    { name: "Caps", count: 2 },
    { name: "supers", count: 1 },
  ]);
});

test("learnedGroups sin pings devuelve una lista vacía", () => {
  assert.deepEqual(learnedGroups([]), []);
  assert.deepEqual(learnedGroups(), []);
});

test("groupRows junta los guardados con los aprendidos sin tocar", () => {
  const saved = [
    { name: "supers", address: "supers@broadcast.ejemplo.com", button: true, manual: true },
    { name: "ALL", address: "all@broadcast.ejemplo.com", button: true, manual: false },
  ];
  const rows = groupRows(saved, [{ name: "all", count: 41 }, { name: "caps", count: 12 }, { name: "coord", count: 1 }]);
  assert.deepEqual(
    rows.map((r) => [r.name, r.count, r.manual, r.saved, r.button]),
    [
      ["ALL", 41, false, true, true],
      ["caps", 12, false, false, false],
      ["coord", 1, false, false, false],
      ["supers", 0, true, true, true],
    ],
  );
});

test("groupUsable: en modo dirección hace falta la dirección; en modo línea, no", () => {
  assert.equal(groupUsable({ button: true, address: "" }, "address"), false);
  assert.equal(groupUsable({ button: true, address: "  " }, "address"), false);
  assert.equal(groupUsable({ button: true, address: "caps@broadcast.ejemplo.com" }, "address"), true);
  assert.equal(groupUsable({ button: true, address: "" }, "line"), true);
  assert.equal(groupUsable({ button: false, address: "x@ejemplo.com" }, "line"), false);
});

test("upsertGroup y removeGroup", () => {
  let g = upsertGroup([], "caps", { address: "caps@broadcast.ejemplo.com" });
  assert.deepEqual(g, [{ name: "caps", address: "caps@broadcast.ejemplo.com", button: true, manual: false }]);
  g = upsertGroup(g, "CAPS", { button: false });
  assert.deepEqual(g, [{ name: "caps", address: "caps@broadcast.ejemplo.com", button: false, manual: false }]);
  assert.deepEqual(removeGroup(g, "Caps"), []);
});
