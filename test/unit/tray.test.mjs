// Bandeja del sistema (tray.js): menú, clics, contador sin leer, aviso de pings con parpadeo, insignia de la barra de
// tareas y la bandeja que se vuelve a crear en Linux. Tray y Menu son los del stub de electron.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { app, Tray } from "electron";
import { createTray, getTray, buildTrayMenu, refreshTray, setUnread, setTrayDnd, trayLook } from "../../src/main/tray.js";
import * as store from "../../src/main/store.js";
import { tempDir } from "./helpers.mjs";

function onPlatform(t, platform) {
  const saved = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  t.after(() => Object.defineProperty(process, "platform", saved));
}

const fakeWin = () => ({ visible: true, focused: true, hidden: 0, overlays: [], isVisible() { return this.visible; }, isFocused() { return this.focused; }, hide() { this.hidden++; }, setOverlayIcon(img, text) { this.overlays.push({ img, text }); } });
const account = (online) => ({ online, presence: [], disconnected: 0, setPresence(show) { this.presence.push(show); return Promise.resolve(); }, disconnect() { this.disconnected++; return Promise.resolve(); } });

let calls;
let win;
let accounts;
function setup(t, platform = "win32") {
  onPlatform(t, platform);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  calls = { show: 0, quit: 0, sent: [] };
  win = fakeWin();
  accounts = new Map([["a", account(true)], ["b", account(false)]]);
  const tray = createTray({ getWin: () => win, accounts, showWindow: () => calls.show++, send: (ch) => calls.sent.push(ch), quit: () => calls.quit++ });
  // Cada test empieza sin nada pendiente.
  setUnread(0, 0);
  t.mock.timers.tick(200);
  return tray;
}

beforeEach((t) => {
  app.testUserData = tempDir(t);
  t.after(() => delete app.testUserData);
});

const item = (menu, label) => menu.items.find((i) => i.label === label);

test("createTray pone el icono reducido a 16 px, el nombre de la app y el menú", (t) => {
  const tray = setup(t);
  assert.ok(tray instanceof Tray);
  assert.equal(getTray(), tray);
  assert.equal(tray.tooltip, "EvEX-MPP");
  // Tres escalas (100 %, 150 % y 200 %), cada una dibujada a su tamaño: un PNG cuadrado de 16, 24 y 32 px.
  assert.deepEqual(tray.image.getScaleFactors(), [1, 1.5, 2]);
  for (const rep of tray.image.representations) {
    assert.equal(rep.width, rep.height);
    assert.equal(rep.buffer.readUInt32BE(16), rep.width, "ancho del PNG");
    assert.equal(rep.buffer.readUInt32BE(20), rep.height, "alto del PNG");
  }
  assert.deepEqual(
    tray.image.representations.map((r) => r.width),
    [16, 24, 32],
  );
  assert.deepEqual(
    tray.menu.items.filter((i) => i.label).map((i) => i.label),
    ["Mostrar EvEX-MPP", "Cambiar de cuenta…", "Disponible", "Ausente", "No molestar", "Ausente (extendido)", "No molestar en la app (silenciar avisos)", "Desconectar todo", "Salir"],
  );
  assert.equal(tray.menu.items.filter((i) => i.type === "separator").length, 3);
});

test("la casilla «No molestar en la app» refleja el estado de la ventana y al pulsarla se lo pide a la ventana", (t) => {
  const tray = setup(t);
  const off = item(buildTrayMenu(), "No molestar en la app (silenciar avisos)");
  assert.equal(off.type, "checkbox");
  assert.equal(off.checked, false);
  setTrayDnd({ active: true, label: "No molestar hasta las 08:00 (horario)" });
  const on = item(tray.menu, "No molestar hasta las 08:00 (horario)");
  assert.ok(on, "el menú de la bandeja se rehace con la etiqueta del estado");
  assert.equal(on.checked, true);
  on.click();
  assert.deepEqual(calls.sent, ["dnd-toggle"]);
  setTrayDnd({ active: false });
  assert.equal(item(tray.menu, "No molestar en la app (silenciar avisos)").checked, false);
});

test("al pulsar la casilla, el menú vuelve al estado real hasta que la ventana lo confirme", (t) => {
  const tray = setup(t);
  setTrayDnd({ active: false });
  const box = item(tray.menu, "No molestar en la app (silenciar avisos)");
  box.checked = true; // lo que hace el menú nativo al pulsarla
  box.click();
  assert.equal(calls.sent.at(-1), "dnd-toggle");
  assert.equal(item(tray.menu, "No molestar en la app (silenciar avisos)").checked, false, "sin confirmación de la ventana sigue desmarcada");
});

test("el menú de la bandeja muestra la ventana, cambia de cuenta, de estado, desconecta y sale", (t) => {
  setup(t);
  const menu = buildTrayMenu();
  item(menu, "Mostrar EvEX-MPP").click();
  assert.equal(calls.show, 1);
  item(menu, "Cambiar de cuenta…").click();
  assert.equal(calls.show, 2);
  assert.deepEqual(calls.sent, ["switch-account"]);
  // El estado solo se cambia en las cuentas conectadas.
  item(menu, "Ausente").click();
  item(menu, "No molestar").click();
  item(menu, "Disponible").click();
  item(menu, "Ausente (extendido)").click();
  assert.deepEqual(accounts.get("a").presence, ["away", "dnd", "", "xa"]);
  assert.deepEqual(accounts.get("b").presence, []);
  item(menu, "Desconectar todo").click();
  assert.equal(accounts.get("a").disconnected, 1);
  assert.equal(accounts.get("b").disconnected, 1);
  item(menu, "Salir").click();
  assert.equal(calls.quit, 1);
});

test("clic en el icono: oculta la ventana si está delante y con el foco; si no, la muestra", (t) => {
  const tray = setup(t);
  tray.emit("click");
  assert.equal(win.hidden, 1);
  assert.equal(calls.show, 0);
  win.focused = false;
  tray.emit("click");
  win.visible = false;
  tray.emit("click");
  assert.equal(win.hidden, 1);
  assert.equal(calls.show, 2);
  tray.emit("double-click");
  tray.emit("balloon-click");
  assert.equal(calls.show, 4);
});

test("mensajes sin leer: el icono con insignia, el texto y la insignia de la barra de tareas llegan juntos tras 150 ms", (t) => {
  const tray = setup(t);
  const plain = tray.image;
  win.overlays = [];
  setUnread(3);
  setUnread(4);
  assert.equal(tray.tooltip, "EvEX-MPP", "aún no: los cambios seguidos se juntan");
  t.mock.timers.tick(150);
  assert.equal(tray.tooltip, "EvEX-MPP — 4 sin leer");
  assert.notEqual(tray.image, plain);
  assert.equal(win.overlays.length, 1);
  assert.equal(win.overlays[0].text, "4 sin leer");
  assert.ok(win.overlays[0].img);
  // Sin cambios no se vuelve a pintar.
  setUnread(4);
  t.mock.timers.tick(200);
  assert.equal(win.overlays.length, 1);
  // A cero: el icono normal y sin insignia.
  setUnread(0);
  t.mock.timers.tick(150);
  assert.equal(tray.tooltip, "EvEX-MPP");
  assert.equal(tray.image, plain);
  assert.deepEqual(win.overlays.at(-1), { img: null, text: "" });
});

test("un ping se ve al momento y la bandeja parpadea si está activado", (t) => {
  const tray = setup(t);
  const plain = tray.image;
  store.get().settings.notifications.trayBlink = true;
  t.after(() => (store.get().settings.notifications.trayBlink = false));
  setUnread(0, 1);
  // Sin esperar los 150 ms.
  assert.equal(tray.tooltip, "¡1 ping de flota sin leer!");
  const alert = tray.image;
  assert.notEqual(alert, plain);
  assert.equal(win.overlays.at(-1).text, "Ping de flota");
  t.mock.timers.tick(650);
  assert.equal(tray.image, plain);
  t.mock.timers.tick(650);
  assert.equal(tray.image, alert);
  setUnread(0, 2);
  t.mock.timers.tick(150);
  assert.equal(tray.tooltip, "¡2 pings de flota sin leer!");
  // Al abrir los pings deja de parpadear y vuelve al contador normal.
  setUnread(1, 0); // un mensaje sin leer sigue ahí
  t.mock.timers.tick(150);
  assert.equal(tray.tooltip, "EvEX-MPP — 1 sin leer");
  const shown = tray.images.length;
  t.mock.timers.tick(2000);
  assert.equal(tray.images.length, shown, "ya no parpadea");
});

test("sin parpadeo, el aviso de ping se queda fijo", (t) => {
  const tray = setup(t);
  store.get().settings.notifications.trayBlink = false;
  setUnread(0, 1);
  const shown = tray.images.length;
  t.mock.timers.tick(3000);
  assert.equal(tray.images.length, shown);
});

test("fuera de Windows no hay insignia en la barra de tareas", (t) => {
  setup(t, "darwin");
  setUnread(5);
  t.mock.timers.tick(150);
  assert.equal(getTray().tooltip, "EvEX-MPP — 5 sin leer");
  assert.deepEqual(win.overlays, []);
});

test("en Linux la bandeja se vuelve a crear a los 3 s para que el escritorio lea el icono", (t) => {
  const first = setup(t, "linux");
  setUnread(2);
  t.mock.timers.tick(2500); // más los 200 ms de setup()
  assert.equal(getTray(), first);
  t.mock.timers.tick(400);
  const second = getTray();
  assert.ok(first.destroyed);
  assert.notEqual(second, first);
  // La nueva conserva el menú y el estado.
  assert.ok(second.menu.items.length);
  assert.equal(second.tooltip, "EvEX-MPP — 2 sin leer");
  second.emit("double-click");
  assert.equal(calls.show, 1);
});

test("en Linux no se recrea una bandeja que ya se ha quitado", (t) => {
  const first = setup(t, "linux");
  first.destroy();
  assert.equal(getTray(), null);
  const count = Tray.created.length;
  t.mock.timers.tick(3500);
  assert.equal(Tray.created.length, count);
  // refreshTray con la bandeja quitada no falla.
  refreshTray();
});

test("trayLook: icono, insignias y texto según sin leer, pings y «No molestar»", () => {
  assert.deepEqual(trayLook({}), { kind: "normal", badge: false, muted: false, tooltip: "EvEX-MPP" });
  assert.deepEqual(trayLook({ unread: 3 }), { kind: "normal", badge: true, muted: false, tooltip: "EvEX-MPP — 3 sin leer" });
  assert.deepEqual(trayLook({ dnd: { active: true, label: "No molestar activado" } }), { kind: "normal", badge: false, muted: true, tooltip: "EvEX-MPP · No molestar activado" });
  const all = trayLook({ unread: 2, pings: 1, dnd: { active: true, label: "No molestar hasta las 08:00 (horario)" } });
  assert.deepEqual(all, { kind: "alert", badge: true, muted: true, tooltip: "¡1 ping de flota sin leer! · No molestar hasta las 08:00 (horario)" });
  assert.equal(trayLook({ dnd: { active: true } }).tooltip, "EvEX-MPP · No molestar", "sin etiqueta, el texto genérico");
});

test("el icono de pings y el de «No molestar» también van en las tres escalas", (t) => {
  const tray = setup(t);
  setTrayDnd({ active: true, label: "No molestar activado" });
  assert.deepEqual(tray.image.getScaleFactors(), [1, 1.5, 2]);
  setUnread(0, 1);
  assert.deepEqual(tray.image.getScaleFactors(), [1, 1.5, 2], "sirena de pings");
  assert.deepEqual(tray.image.representations.map((r) => r.buffer.readUInt32BE(16)), [16, 24, 32]);
  setUnread(0, 0);
  t.mock.timers.tick(500);
  setTrayDnd({ active: false });
});

test("setTrayDnd cambia el icono de la bandeja y su texto, y vuelve al quitarlo", (t) => {
  const tray = setup(t);
  setTrayDnd({ active: false });
  const plain = tray.image;
  setTrayDnd({ active: true, label: "No molestar activado" });
  assert.notEqual(tray.image, plain, "icono con la campana tachada");
  assert.equal(tray.tooltip, "EvEX-MPP · No molestar activado");
  setTrayDnd({ active: false });
  assert.equal(tray.image, plain);
  assert.equal(tray.tooltip, "EvEX-MPP");
});
