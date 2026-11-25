import { test } from "node:test";
import assert from "node:assert/strict";
import { createMiniDrag, DRAG_FRAME_MS, DRAG_MAX_MS } from "../../src/main/mini-drag.js";

// Reloj y temporizador de mentira: tick() ejecuta un fotograma.
function setup(bounds = { x: 100, y: 200, width: 300, height: 190 }) {
  const env = { cursor: { x: 150, y: 210 }, bounds: { ...bounds }, sets: [], ends: [], time: 1000, fn: null, interval: null, cleared: 0 };
  const drag = createMiniDrag({
    getCursor: () => env.cursor,
    getBounds: () => env.bounds,
    setBounds: (b) => {
      env.sets.push(b);
      env.bounds = b;
    },
    onEnd: (last) => env.ends.push(last),
    setInterval: (fn, ms) => ((env.fn = fn), (env.interval = ms), { id: 1 }),
    clearInterval: () => ((env.fn = null), env.cleared++),
    now: () => env.time,
  });
  env.tick = () => env.fn?.();
  return { env, drag };
}

test("mini-drag: la ventana sigue al ratón con el mismo punto agarrado y sin cambiar de tamaño", () => {
  const { env, drag } = setup();
  drag.start();
  assert.equal(env.interval, DRAG_FRAME_MS);
  assert.ok(drag.active());
  env.cursor = { x: 450, y: -100 }; // al monitor de arriba
  env.tick();
  assert.deepEqual(env.sets.at(-1), { x: 400, y: -110, width: 300, height: 190 });
  // Coordenadas con decimales (escala 125 %): se redondean.
  env.cursor = { x: 460.6, y: -99.4 };
  env.tick();
  assert.deepEqual(env.sets.at(-1), { x: 411, y: -109, width: 300, height: 190 });
});

test("mini-drag: si el ratón no se mueve no se vuelve a colocar la ventana", () => {
  const { env, drag } = setup();
  drag.start();
  env.tick();
  env.tick();
  assert.equal(env.sets.length, 0, "sin moverse, nada");
  env.cursor = { x: 151, y: 210 };
  env.tick();
  env.tick();
  assert.equal(env.sets.length, 1);
});

test("mini-drag: el tamaño es el del principio aunque Windows lo cambie al pasar a un monitor de otra escala", () => {
  const { env, drag } = setup();
  drag.start();
  env.bounds = { ...env.bounds, width: 375, height: 238 }; // lo que haría setPosition al cruzar a un monitor al 125 %
  env.cursor = { x: 160, y: 220 };
  env.tick();
  assert.deepEqual(env.sets.at(-1), { x: 110, y: 210, width: 300, height: 190 });
});

test("mini-drag: al soltar se para el temporizador y se avisa una sola vez", () => {
  const { env, drag } = setup();
  drag.start();
  env.cursor = { x: 160, y: 230 };
  env.tick();
  assert.equal(drag.end(), true);
  assert.equal(drag.end(), false, "un segundo «end» no hace nada");
  assert.equal(env.cleared, 1);
  assert.deepEqual(env.ends, [{ x: 110, y: 220 }]);
  assert.ok(!drag.active());
  env.cursor = { x: 900, y: 900 };
  env.tick();
  assert.equal(env.sets.length, 1, "después de soltar ya no se mueve");
});

test("mini-drag: si nunca llega el «end», se para solo pasado el máximo", () => {
  const { env, drag } = setup();
  drag.start();
  env.time += DRAG_MAX_MS - 1;
  env.cursor = { x: 151, y: 211 };
  env.tick();
  assert.ok(drag.active());
  env.time += 2;
  env.tick();
  assert.ok(!drag.active());
  assert.equal(env.ends.length, 1);
});

test("mini-drag: empezar otra vez cierra el arrastre anterior y toma el punto nuevo", () => {
  const { env, drag } = setup();
  drag.start();
  env.cursor = { x: 300, y: 300 };
  env.tick();
  drag.start(); // p. ej. se perdió el «end» del anterior
  assert.equal(env.ends.length, 1);
  env.cursor = { x: 310, y: 300 };
  env.tick();
  assert.deepEqual(env.sets.at(-1), { x: 260, y: 290, width: 300, height: 190 });
});

test("mini-drag: si falla leer el ratón, se termina en vez de lanzar en cada fotograma", () => {
  const { env, drag } = setup();
  drag.start();
  env.cursor = null;
  assert.doesNotThrow(() => env.tick());
  assert.ok(!drag.active());
});
