// En qué pantalla salen las burbujas: la lógica pura (popup-display.js) y cómo la usa popups.js con dos monitores
// simulados (screen del stub de electron).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { BrowserWindow, screen } from "electron";
import { pickDisplay, describeDisplays, findDisplay, displayNearestPoint, displayMatching, isValidChoice, displayHint, orderedDisplays } from "../../src/main/popup-display.js";
import { showPopup, configurePopups, popupIpc } from "../../src/main/popups.js";

// Principal 1920×1080 a la izquierda; secundaria 2560×1440 a la derecha (al 125 %: 2048×1152 lógicos).
const D1 = { id: 11, primary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 };
const D2 = { id: 22, bounds: { x: 1920, y: 0, width: 2048, height: 1152 }, workArea: { x: 1920, y: 0, width: 2048, height: 1112 }, size: { width: 2048, height: 1152 }, scaleFactor: 1.25 };
const ctx = (over = {}) => ({ displays: [D2, D1], primary: D1, cursor: { x: 10, y: 10 }, windowBounds: null, hint: null, ...over });

// ---------- lógica pura ----------

test("pickDisplay: por defecto la principal, aunque el ratón esté en la otra", () => {
  assert.deepEqual(pickDisplay("primary", ctx({ cursor: { x: 2500, y: 500 } })), { display: D1, fallback: false });
  assert.deepEqual(pickDisplay(undefined, ctx()), { display: D1, fallback: false });
});

test("pickDisplay: donde esté el ratón, y la más cercana si el punto cae entre pantallas", () => {
  assert.equal(pickDisplay("cursor", ctx({ cursor: { x: 2500, y: 500 } })).display, D2);
  assert.equal(pickDisplay("cursor", ctx({ cursor: { x: 100, y: 100 } })).display, D1);
  assert.equal(pickDisplay("cursor", ctx({ cursor: { x: 3000, y: 1300 } })).display, D2, "debajo de la secundaria");
  assert.equal(pickDisplay("cursor", ctx({ cursor: null })).fallback, true);
});

test("pickDisplay: la pantalla con más superficie de la ventana; con la ventana oculta, la principal", () => {
  assert.equal(pickDisplay("window", ctx({ windowBounds: { x: 1800, y: 100, width: 800, height: 600 } })).display, D2);
  assert.equal(pickDisplay("window", ctx({ windowBounds: { x: 1500, y: 100, width: 800, height: 600 } })).display, D1);
  assert.deepEqual(pickDisplay("window", ctx({ windowBounds: null })), { display: D1, fallback: true });
  assert.deepEqual(pickDisplay("window", ctx({ windowBounds: { x: -5000, y: 0, width: 100, height: 100 } })), { display: D1, fallback: true });
});

test("pickDisplay: un monitor concreto por id, por su pista si cambia el id, y la principal si no está", () => {
  assert.equal(pickDisplay("display:22", ctx()).display, D2);
  // El id cambió (reconexión), pero la pista dice dónde estaba y qué tamaño tenía.
  assert.equal(pickDisplay("display:99", ctx({ hint: displayHint(D2) })).display, D2);
  // Misma resolución en otra posición: vale si es la única así.
  assert.equal(pickDisplay("display:99", ctx({ hint: { bounds: { x: -2048, y: 0, width: 2048, height: 1152 }, size: { width: 2048, height: 1152 } } })).display, D2);
  assert.deepEqual(pickDisplay("display:22", ctx({ displays: [D1] })), { display: D1, fallback: true });
  assert.deepEqual(pickDisplay("display:99", ctx()), { display: D1, fallback: true });
  // Sin lista de pantallas, la principal.
  assert.equal(pickDisplay("display:22", { primary: D1 }).display, D1);
});

test("findDisplay no adivina si hay varias pantallas del mismo tamaño", () => {
  const D3 = { ...D2, id: 33, bounds: { ...D2.bounds, x: 3968 } };
  assert.equal(findDisplay([D1, D2, D3], 99, { bounds: { x: 9999, y: 0, width: 2048, height: 1152 } }), null);
  assert.equal(findDisplay([D1, D2, D3], 99, { bounds: { ...D3.bounds } }), D3);
  assert.equal(findDisplay([D1], 99, null), null);
});

test("displayNearestPoint y displayMatching", () => {
  assert.equal(displayNearestPoint([D1, D2], { x: 1919, y: 5 }), D1);
  assert.equal(displayNearestPoint([D1, D2], { x: 1920, y: 5 }), D2);
  assert.equal(displayNearestPoint([], { x: 0, y: 0 }), null);
  assert.equal(displayMatching([D1, D2], { x: 0, y: 0, width: 0, height: 0 }), null);
});

test("describeDisplays numera de izquierda a derecha, con la resolución física y la principal marcada", () => {
  const list = describeDisplays([D2, D1], D1.id, { screen: (n) => `Screen ${n}`, primary: "main" });
  assert.deepEqual(
    list.map((d) => [d.value, d.label, d.primary]),
    [
      ["display:11", "Screen 1 · 1920×1080 (main)", true],
      ["display:22", "Screen 2 · 2560×1440", false],
    ],
  );
  assert.deepEqual(list[1].bounds, D2.bounds);
  // Sin size, con los bounds y la escala.
  const { size, ...noSize } = D2;
  assert.equal(size.width, 2048, "lógicos");
  assert.match(describeDisplays([noSize], 0)[0].label, /^Pantalla 1 · 2560×1440$/);
  assert.deepEqual(
    orderedDisplays([D2, D1]).map((d) => d.id),
    [11, 22],
  );
});

test("isValidChoice solo acepta las opciones fijas y monitores conectados", () => {
  for (const ok of ["primary", "cursor", "window", "display:22", "display:11"]) assert.equal(isValidChoice(ok, [D1, D2]), true, ok);
  for (const bad of ["display:99", "display:", "display:22;x", "<script>", "", null, 22, { value: "primary" }, "display:1e3"]) assert.equal(isValidChoice(bad, [D1, D2]), false, String(bad));
});

// ---------- popups.js con dos monitores ----------

let win;
beforeEach(() => {
  screen.testDisplays = [D1, D2];
  screen.testCursor = { x: 2500, y: 500 };
  BrowserWindow.created.length = 0;
  win = { bounds: { x: 2000, y: 100, width: 800, height: 600 }, visible: true, isDestroyed: () => false, isVisible: () => win.visible, isMinimized: () => false, getBounds: () => win.bounds };
  configurePopups({ corner: "bottom-left", display: "primary", displayHint: null, getWin: () => win });
});
afterEach(() => {
  closeAll();
  screen.testDisplays = null;
  screen.testCursor = null;
});

// Cierra todas las burbujas al momento (destroy dispara «closed», como en Electron).
const closeAll = () => {
  for (const w of BrowserWindow.created) if (!w.isDestroyed()) w.destroy();
};
const open = (data = { kind: "msg", title: "hola" }) => {
  showPopup(data);
  return BrowserWindow.created.at(-1);
};
// x de la burbuja (esquina inferior izquierda): workArea.x + 12.
const xOf = (w) => w.bounds.x;

test("las burbujas salen por defecto en la pantalla principal, no donde está el ratón", () => {
  assert.equal(xOf(open()), D1.workArea.x + 12);
});

test("con «Donde esté el ratón» salen en esa pantalla, y abajo del todo de su área útil", () => {
  configurePopups({ display: "cursor" });
  const w = open();
  assert.equal(xOf(w), D2.workArea.x + 12);
  assert.equal(w.bounds.y + w.bounds.height, D2.workArea.y + D2.workArea.height - 12);
});

test("con «Pantalla de la ventana» salen donde está EvEX-MPP; con la ventana oculta, en la principal", () => {
  configurePopups({ display: "window" });
  assert.equal(xOf(open()), D2.workArea.x + 12);
  closeAll();
  win.visible = false;
  assert.equal(xOf(open()), D1.workArea.x + 12);
});

test("la pila no cambia de pantalla al mover el ratón mientras haya burbujas abiertas", () => {
  configurePopups({ display: "cursor" });
  const a = open({ kind: "ping", title: "ping fijo" });
  screen.testCursor = { x: 100, y: 100 };
  const b = open();
  assert.equal(xOf(a), D2.workArea.x + 12);
  assert.equal(xOf(b), D2.workArea.x + 12);
  // Cerradas todas, la siguiente pila vuelve a elegir.
  closeAll();
  assert.equal(xOf(open()), D1.workArea.x + 12);
});

test("un monitor concreto que se desconecta: la pila pasa a la principal y vuelve cuando reaparece", () => {
  configurePopups({ display: "display:22", displayHint: displayHint(D2) });
  const w = open({ kind: "ping", title: "fijo" });
  assert.equal(xOf(w), D2.workArea.x + 12);
  screen.testDisplays = [D1];
  screen.emit("display-removed");
  assert.equal(xOf(w), D1.workArea.x + 12, "no se pierde el aviso");
  // Vuelve con otro id: se reconoce por la pista.
  screen.testDisplays = [D1, { ...D2, id: 23 }];
  screen.emit("display-added");
  assert.equal(xOf(w), D2.workArea.x + 12);
});

test("si cambia la resolución o el área útil, las burbujas abiertas se recolocan", () => {
  configurePopups({ display: "cursor" });
  const w = open();
  screen.testDisplays = [D1, { ...D2, workArea: { ...D2.workArea, x: 1980 } }];
  screen.emit("display-metrics-changed");
  assert.equal(xOf(w), 1980 + 12);
  // Con «Donde esté el ratón», quitar esa pantalla la lleva a la principal.
  screen.testDisplays = [D1];
  screen.emit("display-removed");
  assert.equal(xOf(w), D1.workArea.x + 12);
});

test("popup:displays y popup:test: lista para Preferencias y burbuja de prueba solo con valores conocidos", () => {
  const handlers = {};
  popupIpc((name, fn) => (handlers[name] = fn));
  const info = handlers["popup:displays"]();
  assert.equal(info.system, false);
  assert.deepEqual(
    info.displays.map((d) => [d.value, d.primary]),
    [
      ["display:11", true],
      ["display:22", false],
    ],
  );
  assert.match(info.displays[0].label, /1920×1080/);

  for (const bad of ["display:99", "../../etc", null, 7]) assert.throws(() => handlers["popup:test"](bad), /invalid display/, String(bad));
  assert.equal(handlers["popup:test"]("display:22", { surface: "#000" }), true);
  const w = BrowserWindow.created.at(-1);
  // Sale en la pantalla elegida aunque la opción guardada aún sea otra (se guarda con un pequeño retraso).
  assert.equal(xOf(w), D2.workArea.x + 12);
});
