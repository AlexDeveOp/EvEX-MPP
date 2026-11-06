// keepOnTop (overlay.js): la mini ventana y las burbujas vuelven a ponerse «siempre encima» si Windows se lo quita.
// Ventanas falsas, temporizadores simulados y la plataforma fijada en cada test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, powerMonitor, screen } from "electron";
import { keepOnTop, KEEP_ON_TOP_MS } from "../../src/main/overlay.js";

function onPlatform(t, platform) {
  const saved = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  t.after(() => Object.defineProperty(process, "platform", saved));
}
function fakeWin() {
  return {
    visible: true,
    destroyed: false,
    raised: [],
    focused: 0,
    isVisible() {
      return this.visible;
    },
    isDestroyed() {
      return this.destroyed;
    },
    setAlwaysOnTop(on, level) {
      this.raised.push([on, level]);
    },
    setVisibleOnAllWorkspaces() {},
    focus() {
      this.focused++;
    },
  };
}
const listeners = () => ["resume", "unlock-screen"].reduce((n, e) => n + powerMonitor.listenerCount(e), 0) + ["display-added", "display-removed", "display-metrics-changed"].reduce((n, e) => n + (screen.listeners[e] || []).length, 0);

test("en Windows vuelve a ponerla encima cada 10 s, sin coger nunca el foco", (t) => {
  onPlatform(t, "win32");
  t.mock.timers.enable({ apis: ["setInterval"] });
  const w = fakeWin();
  const stop = keepOnTop(w);
  assert.equal(KEEP_ON_TOP_MS, 10e3);
  t.mock.timers.tick(9999);
  assert.equal(w.raised.length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(w.raised, [[true, "screen-saver"]]);
  t.mock.timers.tick(20e3);
  assert.equal(w.raised.length, 3);
  assert.equal(w.focused, 0);
  stop();
});

test("también al reanudar, al desbloquear y al cambiar las pantallas", (t) => {
  onPlatform(t, "win32");
  t.mock.timers.enable({ apis: ["setInterval"] });
  const w = fakeWin();
  const before = listeners();
  const stop = keepOnTop(w);
  assert.equal(listeners(), before + 5);
  powerMonitor.emit("resume");
  powerMonitor.emit("unlock-screen");
  screen.emit("display-added");
  screen.emit("display-removed");
  screen.emit("display-metrics-changed");
  assert.equal(w.raised.length, 5);
  stop();
  assert.equal(listeners(), before, "al pararla quita sus escuchas");
  powerMonitor.emit("resume");
  t.mock.timers.tick(60e3);
  assert.equal(w.raised.length, 5, "ni eventos ni temporizador después de pararla");
});

test("con la ventana oculta no hace nada, y se para sola si la ventana ya no existe", (t) => {
  onPlatform(t, "win32");
  t.mock.timers.enable({ apis: ["setInterval"] });
  const w = fakeWin();
  const before = listeners();
  keepOnTop(w);
  w.visible = false;
  t.mock.timers.tick(30e3);
  assert.equal(w.raised.length, 0);
  w.visible = true;
  w.destroyed = true;
  t.mock.timers.tick(10e3);
  assert.equal(w.raised.length, 0);
  assert.equal(listeners(), before, "se ha parado sola");
});

test("fuera de Windows, y en Wayland, no hace nada", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const before = listeners();
  for (const platform of ["linux", "darwin"]) {
    onPlatform(t, platform);
    const w = fakeWin();
    keepOnTop(w)();
    t.mock.timers.tick(30e3);
    assert.equal(w.raised.length, 0, platform);
  }
  // Wayland es Linux: tampoco.
  onPlatform(t, "linux");
  app.testSwitches = { "ozone-platform": "wayland" };
  t.after(() => delete app.testSwitches);
  const w = fakeWin();
  keepOnTop(w);
  t.mock.timers.tick(30e3);
  assert.equal(w.raised.length, 0);
  assert.equal(listeners(), before);
  assert.equal(typeof keepOnTop(null), "function");
});

test("parar dos veces no falla", (t) => {
  onPlatform(t, "win32");
  t.mock.timers.enable({ apis: ["setInterval"] });
  const stop = keepOnTop(fakeWin());
  stop();
  stop();
});
