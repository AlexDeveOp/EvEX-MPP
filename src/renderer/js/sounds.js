// Sonidos sintetizados con WebAudio (sin ficheros) y reproducción de sonidos propios por tipo de aviso.
import { S } from "./state.js";

let ctx = null;
const ac = () => (ctx ||= new AudioContext());

function tone(freq, start, dur, { type = "sine", gain = 0.3, slide } = {}) {
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
  o.connect(g).connect(master());
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

export const PRESETS = {
  none: { name: "Sin sonido", play() {} },
  chime: { name: "Campanilla", play: () => (tone(880, 0, 0.35, { gain: 0.25 }), tone(1320, 0.09, 0.45, { gain: 0.2 })) },
  pop: { name: "Pop", play: () => tone(520, 0, 0.12, { type: "triangle", gain: 0.45, slide: 900 }) },
  ding: { name: "Ding", play: () => (tone(1568, 0, 0.6, { gain: 0.22 }), tone(3136, 0, 0.3, { gain: 0.05 })) },
  blip: { name: "Blip digital", play: () => (tone(1200, 0, 0.06, { type: "square", gain: 0.12 }), tone(1800, 0.07, 0.06, { type: "square", gain: 0.12 })) },
  knock: { name: "Toc toc", play: () => (tone(180, 0, 0.09, { type: "triangle", gain: 0.6 }), tone(170, 0.16, 0.09, { type: "triangle", gain: 0.6 })) },
  sonar: { name: "Sonar", play: () => tone(1046, 0, 1.2, { gain: 0.3, slide: 1000 }) },
  alarm: {
    name: "Alarma de flota",
    play: () => {
      for (let i = 0; i < 3; i++) {
        tone(740, i * 0.32, 0.15, { type: "sawtooth", gain: 0.13 });
        tone(988, i * 0.32 + 0.16, 0.15, { type: "sawtooth", gain: 0.13 });
      }
    },
  },
  klaxon: { name: "Klaxon", play: () => [0, 0.45].forEach((t) => tone(440, t, 0.4, { type: "square", gain: 0.12, slide: 330 })) },
};

export const SOUND_KINDS = [
  ["private", "Mensaje privado"],
  ["mention", "Mención en una sala"],
  ["room", "Mensaje en sala (si avisa de todo)"],
  ["ping", "Ping de flota"],
];

function play(sound) {
  if (!sound) return;
  if (sound.preset === "custom" && sound.file) {
    const a = new Audio(sound.file);
    a.volume = S.settings.notifications.volume;
    a.play().catch(() => {});
    return;
  }
  try {
    PRESETS[sound.preset]?.play();
  } catch {}
}

export function playSound(kind) {
  const n = S.settings.notifications;
  if (!n.sound) return;
  console.debug(`[sonido] ${kind}: ${n.sounds?.[kind]?.preset}`);
  play(n.sounds?.[kind]);
}

export function previewSound(sound) {
  play(sound);
}
