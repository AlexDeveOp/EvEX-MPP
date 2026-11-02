// Sonidos sintetizados con WebAudio (sin ficheros) y reproducción de sonidos propios por tipo de aviso.
import { S } from "./state.js";

import { t, tk } from "./i18n.js";
let ctx = null;
const ac = () => (ctx ||= new AudioContext());

function tone(freq, start, dur, { type = "sine", gain = 0.3, slide, out } = {}) {
  const a = ac();
  if (a.state === "suspended") a.resume();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime + start);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, a.currentTime + start + dur);
  g.gain.setValueAtTime(0, a.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, a.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(out || master());
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.05);
}

let masterGain = null;
function master() {
  if (!masterGain) {
    masterGain = ac().createGain();
    masterGain.connect(ac().destination);
  }
  masterGain.gain.value = S.settings.notifications.volume;
  return masterGain;
}

// Volumen propio de un sonido (0–1) sobre el volumen general.
function withVolume(volume, fn) {
  const g = ac().createGain();
  g.gain.value = volume ?? 1;
  g.connect(master());
  fn(g);
  setTimeout(() => g.disconnect(), 4000);
}

export const PRESETS = {
  none: { name: tk("Sin sonido"), play() {} },
  chime: { name: tk("Campanilla"), play: (out) => (tone(880, 0, 0.35, { gain: 0.25, out }), tone(1320, 0.09, 0.45, { gain: 0.2, out })) },
  pop: { name: tk("Pop"), play: (out) => tone(520, 0, 0.12, { type: "triangle", gain: 0.45, slide: 900, out }) },
  ding: { name: tk("Ding"), play: (out) => (tone(1568, 0, 0.6, { gain: 0.22, out }), tone(3136, 0, 0.3, { gain: 0.05, out })) },
  bubble: { name: tk("Burbuja"), play: (out) => (tone(400, 0, 0.09, { gain: 0.35, slide: 800, out }), tone(600, 0.08, 0.1, { gain: 0.25, slide: 1100, out })) },
  blip: { name: tk("Blip digital"), play: (out) => (tone(1200, 0, 0.06, { type: "square", gain: 0.12, out }), tone(1800, 0.07, 0.06, { type: "square", gain: 0.12, out })) },
  knock: { name: tk("Toc toc"), play: (out) => (tone(180, 0, 0.09, { type: "triangle", gain: 0.6, out }), tone(170, 0.16, 0.09, { type: "triangle", gain: 0.6, out })) },
  sonar: { name: tk("Sonar"), play: (out) => tone(1046, 0, 1.2, { gain: 0.3, slide: 1000, out }) },
  radar: { name: tk("Radar"), play: (out) => [0, 0.25, 0.5].forEach((at, i) => tone(1400 - i * 150, at, 0.12, { gain: 0.2, out })) },
  warp: { name: tk("Salto a warp"), play: (out) => (tone(220, 0, 0.7, { type: "sawtooth", gain: 0.08, slide: 1760, out }), tone(440, 0.05, 0.6, { gain: 0.12, slide: 2200, out })) },
  alarm: {
    name: tk("Alarma de flota"),
    play: (out) => {
      for (let i = 0; i < 3; i++) {
        tone(740, i * 0.32, 0.15, { type: "sawtooth", gain: 0.13, out });
        tone(988, i * 0.32 + 0.16, 0.15, { type: "sawtooth", gain: 0.13, out });
      }
    },
  },
  klaxon: { name: tk("Klaxon"), play: (out) => [0, 0.45].forEach((at) => tone(440, at, 0.4, { type: "square", gain: 0.12, slide: 330, out })) },
  down: { name: tk("Señal perdida"), play: (out) => [880, 660, 440].forEach((f, i) => tone(f, i * 0.18, 0.22, { type: "triangle", gain: 0.3, out })) },
  up: { name: tk("Señal recuperada"), play: (out) => [440, 660, 880].forEach((f, i) => tone(f, i * 0.12, 0.18, { type: "triangle", gain: 0.25, out })) },
};

// Tipos de aviso con sonido, agrupados como en Preferencias. Los nuevos llegan apagados o con un sonido discreto.
export const SOUND_GROUPS = [
  [tk("Mensajes"), [["private", tk("Mensaje privado")], ["mention", tk("Mención en una sala")], ["room", tk("Mensaje en sala (si avisa de todo)")], ["sent", tk("Mensaje enviado")]]],
  [tk("Flota"), [["ping", tk("Ping de flota")]]],
  [tk("Conexión"), [["disconnected", tk("Conexión perdida")], ["reconnected", tk("Conexión recuperada")]]],
  [tk("Contactos"), [["contactOnline", tk("Un contacto se conecta")], ["contactOffline", tk("Un contacto se desconecta")], ["subscribe", tk("Solicitud de contacto")], ["invite", tk("Invitación a una sala")]]],
];
export const SOUND_KINDS = SOUND_GROUPS.flatMap(([, kinds]) => kinds);

// Avisos que suenan aunque esté activado «No molestar».
const ALWAYS = new Set(["ping", "disconnected", "reconnected"]);
// Si llegan varios del mismo tipo de golpe (p. ej. al reconectar), suena solo uno.
const COOLDOWN_MS = 1200;
const lastPlayed = new Map();

// Salida de audio elegida (auriculares, altavoces…). "" = la predeterminada de Windows.
let sinkApplied = "";
function applySink() {
  const id = S.settings.notifications.outputDevice || "";
  if (id === sinkApplied || typeof ac().setSinkId !== "function") return;
  sinkApplied = id;
  ac().setSinkId(id).catch(() => (sinkApplied = ""));
}

function play(sound) {
  if (!sound || sound.preset === "none") return;
  applySink();
  const volume = Math.max(0, Math.min(1, sound.volume ?? 1));
  if (sound.preset === "custom" && sound.file) {
    const a = new Audio(sound.file);
    a.volume = S.settings.notifications.volume * volume;
    const id = S.settings.notifications.outputDevice;
    (id && a.setSinkId ? a.setSinkId(id).catch(() => {}) : Promise.resolve()).then(() => a.play().catch(() => {}));
    return;
  }
  try {
    withVolume(volume, (out) => PRESETS[sound.preset]?.play(out));
  } catch {}
}

export function playSound(kind) {
  const n = S.settings.notifications;
  if (!n.sound) return;
  if (n.dnd && !ALWAYS.has(kind)) return;
  const now = Date.now();
  if (now - (lastPlayed.get(kind) || 0) < COOLDOWN_MS) return;
  lastPlayed.set(kind, now);
  console.debug(`[sonido] ${kind}: ${n.sounds?.[kind]?.preset}`);
  play(n.sounds?.[kind]);
}

export function previewSound(sound) {
  play(sound);
}

// ---------- repetición del sonido de ping hasta que se mire la ventana ----------

let repeatTimer = null;
export function startPingRepeat() {
  const r = S.settings.notifications.pingRepeat;
  if (!r?.enabled || S.focused) return;
  stopPingRepeat();
  let left = Math.max(1, r.times || 5);
  repeatTimer = setInterval(() => {
    if (S.focused || --left < 0) return stopPingRepeat();
    console.debug("[sonido] ping (repetición)");
    play(S.settings.notifications.sounds.ping);
  }, Math.max(5, r.interval || 30) * 1000);
}

export function stopPingRepeat() {
  clearInterval(repeatTimer);
  repeatTimer = null;
}

// Dispositivos de salida de audio para elegir en Preferencias.
export async function outputDevices() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.deviceId !== "communications").map((d) => ({ id: d.deviceId, label: d.label || t("Dispositivo sin nombre") }));
  } catch {
    return [];
  }
}
