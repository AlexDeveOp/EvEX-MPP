import { test } from "node:test";
import assert from "node:assert/strict";
import { createMiniHeal, HEAL_DELAY_MS, HEAL_QUICK_MS, HEAL_MIN_GAP_MS } from "../../src/main/mini-heal.js";
import { createLostPressDetector, LOST_PRESS_WINDOW_MS } from "../../src/renderer/js/mini-lost-press.js";

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
  let t = 0;
  const d = createLostPressDetector(() => lost++, { now: () => t });
  for (let i = 0; i < 20; i++) {
    d.down({ button: 0 });
    d.up({ button: 0 });
    t += 100;
  }
  assert.equal(lost, 0);
});

test("clics perdidos: un «soltar» huérfano suelto no avisa; dos seguidos sí (mini congelada)", () => {
  let lost = 0;
  let t = 0;
  const d = createLostPressDetector(() => lost++, { now: () => t });
  d.up({ button: 0 }); // pulsar fuera y soltar encima: normal
  assert.equal(lost, 0);
  t += 2000;
  d.up({ button: 0 }); // vuelve a pasar enseguida: la mini se traga los «pulsar»
  assert.equal(lost, 1);
  t += 500;
  d.up({ button: 0 }); // la cuenta empieza de nuevo
  assert.equal(lost, 1);
});

test("clics perdidos: dos huérfanos muy separados no avisan; otros botones no cuentan", () => {
  let lost = 0;
  let t = 0;
  const d = createLostPressDetector(() => lost++, { now: () => t });
  d.up({ button: 0 });
  t += LOST_PRESS_WINDOW_MS + 1;
  d.up({ button: 0 });
  assert.equal(lost, 0);
  d.up({ button: 2 });
  d.up({ button: 2 });
  assert.equal(lost, 0);
  // Un clic normal en medio también reinicia la sospecha del «pulsar» pendiente.
  d.down({ button: 0 });
  d.up({ button: 0 });
  t += 100;
  d.up({ button: 0 });
  assert.equal(lost, 1, "el huérfano anterior aún cuenta dentro del plazo");
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
