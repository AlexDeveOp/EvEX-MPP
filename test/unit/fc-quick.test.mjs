import { test } from "node:test";
import assert from "node:assert/strict";
import { S } from "../../src/renderer/js/state.js";
import * as q from "../../src/renderer/js/fc-quick.js";
import * as store from "../../src/main/store.js";
import { TEST_SETTINGS } from "./helpers.mjs";

S.settings = structuredClone(TEST_SETTINGS);

const ZW = String.fromCharCode(0x200b);
const NOW = Date.UTC(2026, 10, 7, 18, 0);
const FC = { template: { format: "{tipo} · FC: {fc}\nFormup: {hora} EVE · {lugar}\n{notas}", fields: ["type", "fc", "time", "place", "notes"] } };

test("los topes son los mismos que en store.js", () => {
  assert.equal(q.SAVED_MAX, store.FC_SAVED_MAX);
  assert.equal(q.SAVED_TEXT_MAX, store.FC_SAVED_TEXT_MAX);
  assert.deepEqual(q.SAVED_ORDERS, store.FC_SAVED_ORDERS);
});

test("saveQuick guarda la plantilla sin la hora y el pegado tal cual", () => {
  let r = q.saveQuick([], { name: "Strat op Ferox", kind: "template", values: { type: "Strat op", time: "19:00", quick: 30, place: "Home staging" }, groups: ["all", "caps", "all"] }, NOW);
  assert.equal(r.status, "added");
  assert.equal(r.item.values.time, undefined);
  assert.equal(r.item.values.quick, undefined);
  assert.equal(r.item.values.place, "Home staging");
  assert.deepEqual(r.item.groups, ["all", "caps"]);
  assert.equal(r.item.created, NOW);
  const text = `${ZW}CAPS NEEDED${ZW}\nFC: Bob FC  \n`;
  r = q.saveQuick(r.saved, { name: "Caps needed", kind: "paste", text, groups: ["caps"] }, NOW);
  assert.equal(r.status, "added");
  assert.equal(r.item.text, text);
  assert.equal(r.saved.length, 2);
});

test("saveQuick actualiza el del mismo nombre y tipo sin perder los usos", () => {
  let saved = q.saveQuick([], { name: "Home defense", kind: "template", values: { type: "Home defense" } }, NOW).saved;
  saved = q.markUsed(saved, saved[0].id, NOW + 1);
  const r = q.saveQuick(saved, { name: "home DEFENSE", kind: "template", values: { type: "HD" }, groups: ["all"] }, NOW + 2);
  assert.equal(r.status, "updated");
  assert.equal(r.saved.length, 1);
  assert.equal(r.item.uses, 1);
  assert.equal(r.item.values.type, "HD");
  assert.deepEqual(r.item.groups, ["all"]);
  // Mismo nombre pero otro tipo: es otro.
  assert.equal(q.saveQuick(r.saved, { name: "Home defense", kind: "paste", text: "x" }).status, "added");
});

test("saveQuick no recorta un texto pegado demasiado largo, ni guarda sin nombre o con la lista llena", () => {
  const long = "x".repeat(q.SAVED_TEXT_MAX + 1);
  const r = q.saveQuick([], { name: "Largo", kind: "paste", text: long });
  assert.equal(r.status, "too-long");
  assert.deepEqual(r.saved, []);
  assert.equal(q.saveQuick([], { name: ` ${ZW} `, kind: "paste", text: "x" }).status, "no-name");
  let full = [];
  for (let i = 0; i < q.SAVED_MAX; i++) full = q.saveQuick(full, { name: `P${i}`, kind: "paste", text: "x" }).saved;
  assert.equal(q.saveQuick(full, { name: "Otro", kind: "paste", text: "x" }).status, "full");
  assert.equal(q.saveQuick(full, { name: "P3", kind: "paste", text: "y" }).status, "updated");
});

test("defaultName: tipo y doctrina, o el título del pegado sin invisibles", () => {
  assert.equal(q.defaultName("template", { values: { type: "Strat op", doctrine: " Ferox " } }), "Strat op Ferox");
  assert.equal(q.defaultName("paste", { text: `~~~ ${ZW}CAPS NEEDED${ZW} ~~~\nFC: Bob FC` }), "~~~ CAPS NEEDED ~~~");
});

test("sortSaved: los más usados, alfabético o a mano", () => {
  const list = [
    { id: "a", name: "beta", uses: 1, lastUsed: 5 },
    { id: "b", name: "Alfa", uses: 3, lastUsed: 1 },
    { id: "c", name: "gamma", uses: 1, lastUsed: 9 },
  ];
  assert.deepEqual(q.sortSaved(list, "used").map((x) => x.id), ["b", "c", "a"]);
  assert.deepEqual(q.sortSaved(list, "alpha").map((x) => x.id), ["b", "a", "c"]);
  assert.deepEqual(q.sortSaved(list, "manual").map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(q.moveSaved(list, "c", -1).map((x) => x.id), ["a", "c", "b"]);
  assert.deepEqual(q.moveSaved(list, "a", -1).map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(q.renameSaved(list, "a", ` Nuevo${ZW} `)[0].name, "Nuevo");
  assert.deepEqual(q.renameSaved(list, "a", "  ")[0].name, "beta");
  assert.deepEqual(q.removeSaved(list, "b").map((x) => x.id), ["a", "c"]);
  assert.deepEqual(q.markUsed(list, "a", 99)[0], { id: "a", name: "beta", uses: 2, lastUsed: 99 });
});

test("quickText: la plantilla con la hora elegida; el pegado, tal cual", () => {
  const t = { kind: "template", values: { type: "Strat op", fc: "Bob FC", place: "Home staging", notes: "" } };
  assert.equal(q.quickText(FC, t, "19:00"), "Strat op · FC: Bob FC\nFormup: 19:00 EVE · Home staging");
  const p = { kind: "paste", text: `A${ZW}\n  B  ` };
  assert.equal(q.quickText(FC, p, "19:00"), `A${ZW}\n  B  `);
  assert.equal(q.quickText(FC, null, "19:00"), "");
});

test("savedGroupsIn: los guardados que siguen siendo botón", () => {
  const bar = [{ name: "all" }, { name: "caps" }, { name: "logistica" }];
  assert.deepEqual(q.savedGroupsIn({ groups: ["CAPS", "supers", "all"] }, bar), ["all", "caps"]);
  assert.deepEqual(q.savedGroupsIn(null, bar), []);
});

test("suggestGroups: el nombre del grupo o un alias obvio como palabra, sin tocar el texto", () => {
  const groups = ["all", "caps", "supers", "logistica", "dreads"];
  assert.deepEqual(q.suggestGroups("CAPITALS needed, bring fuel", groups), ["caps"]);
  assert.deepEqual(q.suggestGroups(`Super${ZW}capitals and capital ships`, groups), ["caps", "supers"]);
  assert.deepEqual(q.suggestGroups("Need logistica pilots and a Dread", groups), ["logistica", "dreads"]);
  // «all» solo como palabra exacta: «alliance» no cuenta.
  assert.deepEqual(q.suggestGroups("Alliance tournament", groups), []);
  assert.deepEqual(q.suggestGroups("Ping to all", groups), ["all"]);
  // Los ya marcados no se sugieren.
  assert.deepEqual(q.suggestGroups("caps needed", groups, ["Caps"]), []);
  assert.deepEqual(q.suggestGroups("", groups), []);
});

test("store: normaliza los guardados con sus topes", () => {
  const long = "x".repeat(store.FC_SAVED_TEXT_MAX + 1);
  const f = store.normalizeFcMode({
    savedOrder: "raro",
    saved: [
      { id: "q1", name: " Strat ", kind: "template", values: { type: "Strat op", time: "19:00", otra: 1 }, groups: ["all", "", "all"], uses: "3", lastUsed: -1 },
      { id: "q1", name: "Repetido", kind: "paste", text: "x" },
      { id: "q2", name: "Pegado", kind: "paste", text: `${ZW}tal cual  ` },
      { id: "q3", name: "Largo", kind: "paste", text: long },
      { id: "q4", name: "", kind: "paste", text: "x" },
      { id: "q5", name: "Sin tipo", text: "x" },
      null,
    ],
  });
  assert.equal(f.savedOrder, "used");
  assert.deepEqual(f.saved.map((x) => x.id), ["q1", "q2"]);
  assert.equal(f.saved[0].name, "Strat");
  assert.equal(f.saved[0].values.time, undefined);
  assert.equal(f.saved[0].values.otra, undefined);
  assert.equal(f.saved[0].values.type, "Strat op");
  assert.deepEqual(f.saved[0].groups, ["all"]);
  assert.equal(f.saved[0].uses, 3);
  assert.equal(f.saved[0].lastUsed, 0);
  assert.equal(f.saved[1].text, `${ZW}tal cual  `);
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `id${i}`, name: `P${i}`, kind: "paste", text: "x" }));
  assert.equal(store.normalizeFcMode({ saved: many }).saved.length, store.FC_SAVED_MAX);
  assert.deepEqual(store.normalizeFcMode({}).saved, []);
});
