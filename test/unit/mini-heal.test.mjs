import { test } from "node:test";
import assert from "node:assert/strict";
import { createMiniHeal, createIdleWake, IDLE_WAKE_AFTER_S, HEAL_DELAY_MS, HEAL_QUICK_MS, HEAL_MIN_GAP_MS } from "../../src/main/mini-heal.js";
import { createLostPressDetector } from "../../src/renderer/js/mini-lost-press.js";

function setup() {
  const env = { time: 100000, timers: [], rebuilt: [], logs: [] };
  const heal = createMiniHeal({
    rebuild: () => env.rebuilt.push(env.time),
    setTimeout: (fn, ms) => {
      const t = { fn, at: env.time + ms, off: false };
      env.timers.push(t);
      return t;
    },
    clearTimeout: (t) => t && (t.off = true),
    now: () => env.time,
    log: (why) => env.logs.push(why),
  });
  env.advance = (ms) => {
    env.time += ms;
    for (const t of env.timers) if (!t.off && t.at <= env.time) (t.off = true), t.fn();
  };
  return { env, heal };
}

test("mini-heal: tras un cambio de pantallas recrea la ventana una vez, agrupando los eventos seguidos", () => {
  const { env, heal } = setup();
  heal.after("display-removed");
  env.advance(1000);
  heal.after("display-added"); // los monitores vuelven: se cuenta desde aquí
  env.advance(HEAL_DELAY_MS - 1);
  assert.equal(env.rebuilt.length, 0);
  env.advance(1);
  assert.equal(env.rebuilt.length, 1);
  assert.deepEqual(env.logs, ["display-added"]);
});

test("mini-heal: un clic perdido la recrea en el acto y anula la pendiente", () => {
  const { env, heal } = setup();
  heal.after("resume");
  assert.equal(heal.stuck(), true);
  assert.equal(env.rebuilt.length, 1);
  env.advance(HEAL_DELAY_MS);
  assert.equal(env.rebuilt.length, 1, "la programada ya no se hace");
});

test("mini-heal: como mucho una vez cada pocos segundos, para no entrar en bucle", () => {
  const { env, heal } = setup();
  assert.equal(heal.stuck(), true);
  env.advance(HEAL_MIN_GAP_MS - 1);
  assert.equal(heal.stuck(), false);
  env.advance(1);
  assert.equal(heal.stuck(), true);
  assert.equal(env.rebuilt.length, 2);
});

test("mini-heal: stop() anula la pendiente (al cerrar la mini)", () => {
  const { env, heal } = setup();
  heal.after("unlock-screen");
  heal.stop();
  env.advance(HEAL_DELAY_MS * 2);
  assert.equal(env.rebuilt.length, 0);
});

test("clics perdidos: pulsar y soltar normales no avisan nunca", () => {
  let lost = 0;
  const d = createLostPressDetector(() => lost++);
  for (let i = 0; i < 20; i++) {
    d.down({ button: 0 });
    d.up({ button: 0 });
  }
  assert.equal(lost, 0);
});

test("clics perdidos: avisa al primer «soltar» sin su «pulsar» (tras apagarse los monitores no hay otra señal)", () => {
  let lost = 0;
  const d = createLostPressDetector(() => lost++);
  d.up({ button: 0 });
  assert.equal(lost, 1);
  // La ventana nueva vuelve a recibir los «pulsar»: no se repite.
  d.down({ button: 0 });
  d.up({ button: 0 });
  assert.equal(lost, 1);
  // Otros botones no cuentan.
  d.up({ button: 2 });
  assert.equal(lost, 1);
});

test("mini-heal: al desbloquear o volver de suspensión se recrea enseguida, antes de que se toque", () => {
  const { env, heal } = setup();
  heal.after("unlock-screen", HEAL_QUICK_MS);
  env.advance(HEAL_QUICK_MS - 1);
  assert.equal(env.rebuilt.length, 0);
  env.advance(1);
  assert.deepEqual(env.logs, ["unlock-screen"]);
  assert.ok(HEAL_QUICK_MS <= 1000, "menos de un segundo");
});

test("vuelta de la actividad: avisa una vez al tocar algo tras más de un minuto sin actividad", () => {
  const w = createIdleWake();
  const seq = [0, 1, 0, 5, 30, IDLE_WAKE_AFTER_S - 1, IDLE_WAKE_AFTER_S, 300, 900, 1, 0, 0, 1];
  const woke = seq.map((s) => w.feed(s));
  assert.deepEqual(woke.map((v, i) => (v ? seq[i] : null)).filter((v) => v !== null), [1], "solo al volver");
  assert.equal(woke.indexOf(true), 9, "en el primer segundo con actividad tras los 900 s");
});

test("vuelta de la actividad: pausas cortas no cuentan, y un dato raro no hace nada", () => {
  const w = createIdleWake();
  for (const s of [0, 10, 40, 59, 0, 1, 20, 0]) assert.equal(w.feed(s), false, String(s));
  assert.equal(w.feed(NaN), false);
  assert.equal(w.feed(undefined), false);
  // Con el umbral pasado, aunque llegue un dato raro en medio, se avisa al volver.
  w.feed(120);
  w.feed(NaN);
  assert.equal(w.feed(0), true);
});
