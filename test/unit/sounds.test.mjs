import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { scanPidginSounds } from "../../src/main/pidgin-import.js";
import { tempDir } from "./helpers.mjs";

// WebAudio y <audio> simulados: se registra qué se reproduce y con qué volumen.
const played = [];
class FakeNode {
  constructor() {
    this.gain = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
    this.frequency = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  }
  connect(n) {
    return n;
  }
  disconnect() {}
  start() {
    played.push("tone");
  }
  stop() {}
}
globalThis.AudioContext = class {
  state = "running";
  currentTime = 0;
  destination = new FakeNode();
  createOscillator = () => new FakeNode();
  createGain = () => new FakeNode();
  resume() {}
};
globalThis.Audio = class {
  constructor(src) {
    this.src = src;
  }
  play() {
    played.push(`file:${this.src}:${this.volume.toFixed(2)}`);
    return Promise.resolve();
  }
};

const { S } = await import("../../src/renderer/js/state.js");
const { playSound, previewSound, startPingRepeat, stopPingRepeat, SOUND_KINDS } = await import("../../src/renderer/js/sounds.js");

// Los archivos propios se reproducen tras elegir la salida de audio (una promesa).
const flush = () => new Promise((r) => setImmediate(r));
const sounds = () => Object.fromEntries(SOUND_KINDS.map(([k]) => [k, { preset: "ding", file: "", volume: 1 }]));
beforeEach(() => {
  played.length = 0;
  S.focused = false;
  S.settings = { notifications: { sound: true, dnd: false, volume: 0.5, outputDevice: "", sounds: sounds(), pingRepeat: { enabled: false, interval: 30, times: 3 } } };
});

test("hay un sonido configurable para cada aviso, también los nuevos", () => {
  const kinds = SOUND_KINDS.map(([k]) => k);
  for (const k of ["private", "mention", "room", "sent", "ping", "disconnected", "reconnected", "contactOnline", "contactOffline", "subscribe", "invite"]) assert.ok(kinds.includes(k), k);
});

test("varios avisos iguales seguidos suenan una sola vez", () => {
  playSound("mention");
  const n = played.length;
  assert.ok(n > 0);
  playSound("mention");
  assert.equal(played.length, n, "el segundo debe ignorarse");
  playSound("invite");
  assert.ok(played.length > n, "otro tipo sí suena");
});

test("«No molestar» silencia todo salvo pings y avisos de conexión", () => {
  S.settings.notifications.dnd = true;
  playSound("private");
  playSound("contactOnline");
  assert.equal(played.length, 0);
  playSound("ping");
  playSound("disconnected");
  assert.ok(played.length > 0);
});

test("sin sonido o con «Sin sonido» no se reproduce nada", () => {
  S.settings.notifications.sounds.sent = { preset: "none", file: "", volume: 1 };
  playSound("sent");
  S.settings.notifications.sound = false;
  playSound("room");
  assert.equal(played.length, 0);
});

test("los archivos propios usan el volumen general por el de cada sonido", async () => {
  previewSound({ preset: "custom", file: "media://evex/sounds/a.wav", volume: 0.5 });
  await flush();
  assert.deepEqual(played, ["file:media://evex/sounds/a.wav:0.25"]);
});

test("la repetición del ping suena cada intervalo y para al mirar la ventana", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    S.settings.notifications.pingRepeat = { enabled: true, interval: 10, times: 5 };
    S.settings.notifications.sounds.ping = { preset: "custom", file: "ping.wav", volume: 1 };
    startPingRepeat();
    mock.timers.tick(10000);
    mock.timers.tick(10000);
    await flush();
    assert.equal(played.length, 2);
    S.focused = true;
    mock.timers.tick(10000);
    await flush();
    assert.equal(played.length, 2, "con la ventana a la vista deja de sonar");
    stopPingRepeat();
    // Desactivada o con la ventana ya a la vista no empieza.
    S.settings.notifications.pingRepeat.enabled = false;
    S.focused = false;
    startPingRepeat();
    mock.timers.tick(30000);
    await flush();
    assert.equal(played.length, 2);
  } finally {
    stopPingRepeat();
    mock.timers.reset();
  }
});

test("scanPidginSounds usa los sonidos personalizados de prefs.xml y si no los del Pidgin instalado", (t) => {
  const dir = tempDir(t);
  const soundDir = path.join(dir, "Pidgin", "sounds", "purple");
  fs.mkdirSync(soundDir, { recursive: true });
  for (const f of ["alert.wav", "login.wav", "logout.wav", "receive.wav", "send.wav"]) fs.writeFileSync(path.join(soundDir, f), "RIFF");
  const mine = path.join(dir, "mi-aviso.wav");
  fs.writeFileSync(mine, "RIFF");
  const prefs = path.join(dir, "prefs.xml");
  fs.writeFileSync(
    prefs,
    `<?xml version='1.0' encoding='UTF-8' ?><pref version='1' name='/'><pref name='pidgin'><pref name='sound'><pref name='file'>` +
      `<pref name='nick_said' type='path' value='${mine}'/><pref name='im_recv' type='path' value=''/><pref name='send_im' type='path' value='C:/no/existe.wav'/>` +
      `</pref></pref></pref></pref>`,
  );
  const r = scanPidginSounds({ prefsFile: prefs, soundDirs: [path.join(dir, "no-hay"), soundDir] });
  assert.equal(r.found, true);
  assert.equal(r.sounds.mention.file, mine);
  assert.equal(r.sounds.mention.custom, true);
  assert.equal(path.basename(r.sounds.private.file), "receive.wav");
  assert.equal(path.basename(r.sounds.sent.file), "send.wav", "si el personalizado no existe, el de Pidgin");
  assert.equal(path.basename(r.sounds.contactOnline.file), "login.wav");
  assert.equal(r.sounds.ping, undefined, "el ping no se toca");
});

test("scanPidginSounds sin Pidgin no encuentra nada", (t) => {
  const dir = tempDir(t);
  const r = scanPidginSounds({ prefsFile: path.join(dir, "no.xml"), soundDirs: [path.join(dir, "nada")] });
  assert.deepEqual(r, { found: false, dir: null, sounds: {} });
});
