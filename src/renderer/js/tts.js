// Lectura en voz alta de los pings de flota con las voces instaladas en Windows (speechSynthesis de Chromium, que en
// Windows usa las voces del sistema: no se envía nada a Internet). Ajustes en Preferencias → Pings de flota.
import { S } from "./state.js";
import { dndState } from "./notify-rules.js";
import { parsePing } from "./pings.js";

export const VOICE_DEFAULTS = {
  enabled: false,
  voice: "", // nombre de la voz; "" = automática (inglés si hay, porque los pings vienen en inglés)
  rate: 1,
  pitch: 1,
  volume: 1,
  content: "summary", // summary | title | full | template
  template: "{title}. FC {fc}. Formup {formup}. Doctrine {doctrine}.",
  when: "always", // always | unfocused
  dnd: true, // leer también con «No molestar»
  groups: "", // solo estos grupos de destino (separados por comas); vacío = todos
  delay: 1.5, // segundos de espera tras el sonido del ping
  repeat: 1,
  maxChars: 400,
  stopOnFocus: false, // dejar de leer al volver a la ventana
};

export const TEMPLATE_FIELDS = ["title", "fc", "formup", "doctrine", "comms", "pap", "group", "from", "text"];

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
const FIELD_KEYS = { fc: /^(?:fc\b|fleet commander)/i, formup: /formup|location|staging/i, doctrine: /doctrine|ships|comp/i, comms: /comms|voice|mumble|discord/i, pap: /pap/i };

export function voiceSettings() {
  return { ...VOICE_DEFAULTS, ...(S.settings?.pingVoice || {}) };
}

export function speechAvailable() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// Solo voces locales: una voz «de red» enviaría el texto del ping a un servicio externo.
const localVoices = () => speechSynthesis.getVoices().filter((v) => v.localService);

// Las voces se cargan tarde la primera vez: se espera al evento voiceschanged (como mucho 2 s).
export function listVoices() {
  if (!speechAvailable()) return Promise.resolve([]);
  const now = localVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(localVoices());
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 2000);
  });
}

// Texto que se puede leer: sin invisibles, sin enlaces (se leerían letra a letra) ni los «~~~» del pie.
function speakable(s) {
  return String(s ?? "")
    .replace(INVISIBLE, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/~+/g, " ")
    .replace(/[*_`|<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Valores con nombre de un ping para las plantillas.
export function pingValues(body) {
  const p = parsePing(String(body ?? ""));
  const v = { title: speakable(p.title), group: speakable(p.footer?.to), from: speakable(p.footer?.from), text: speakable([...p.fields.map((f) => `${f.key}: ${f.value}`), ...p.extra].join(". ")) };
  for (const [name, re] of Object.entries(FIELD_KEYS)) v[name] = speakable(p.fields.find((f) => re.test(f.key))?.value);
  return { values: v, parsed: p };
}

// Rellena una plantilla. Las frases cuyos campos están vacíos se quitan enteras («FC .» no se lee).
export function fillTemplate(template, values) {
  const parts = String(template || "").split(/(?<=[.;!?])\s+/);
  return parts
    .map((part) => {
      let missing = false;
      const out = part.replace(/\{(\w+)\}/g, (m, k) => {
        const val = values[k.toLowerCase()];
        if (!val) missing = true;
        return val || "";
      });
      return missing ? "" : out;
    })
    .filter((s) => s.trim())
    .join(" ")
    .replace(/([.!?…])[.;]+/g, "$1") // «now!!.» → «now!!»
    .replace(/\s+/g, " ")
    .trim();
}

// Qué se lee de un ping, según los ajustes.
export function pingSpeech(body, cfg = voiceSettings()) {
  const { values, parsed } = pingValues(body);
  let text;
  if (cfg.content === "title") text = values.title;
  else if (cfg.content === "full") text = [values.title, values.text].filter(Boolean).join(". ");
  else if (cfg.content === "template") text = fillTemplate(cfg.template, values);
  else text = fillTemplate(VOICE_DEFAULTS.template, values);
  if (!text) text = speakable(parsed.fields.length ? values.text : body);
  const max = Math.max(50, cfg.maxChars || VOICE_DEFAULTS.maxChars);
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}…` : text;
}

// ¿Se lee este ping? (activado, ventana, «No molestar» y grupos de destino).
export function shouldSpeak(body, cfg = voiceSettings(), { focused = S.focused, dnd = dndState(S.settings?.notifications).active } = {}) {
  if (!cfg.enabled) return false;
  if (cfg.when === "unfocused" && focused) return false;
  if (dnd && !cfg.dnd) return false;
  const wanted = String(cfg.groups || "")
    .split(/[,\n]/)
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean);
  if (wanted.length) {
    const group = String(parsePing(String(body ?? "")).footer?.to || "").toLowerCase();
    if (!wanted.includes(group)) return false;
  }
  return true;
}

async function pickVoice(name) {
  const voices = await listVoices();
  if (name) {
    const v = voices.find((x) => x.name === name);
    if (v) return v;
  }
  return voices.find((v) => /^en(-|$)/i.test(v.lang)) || voices.find((v) => v.default) || voices[0] || null;
}

let timers = [];
const listeners = new Set();
function notifyState() {
  const speaking = speechAvailable() && (speechSynthesis.speaking || speechSynthesis.pending);
  document.body?.classList.toggle("tts-speaking", !!speaking);
  for (const fn of listeners) fn(speaking);
}
export function onSpeechState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function speak(text, cfg = voiceSettings()) {
  if (!speechAvailable() || !text) return false;
  const voice = await pickVoice(cfg.voice);
  const times = Math.min(3, Math.max(1, Math.round(cfg.repeat || 1)));
  for (let i = 0; i < times; i++) {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.rate = Math.min(2, Math.max(0.5, cfg.rate ?? 1));
    u.pitch = Math.min(2, Math.max(0, cfg.pitch ?? 1));
    u.volume = Math.min(1, Math.max(0, cfg.volume ?? 1));
    u.onstart = u.onend = u.onerror = () => setTimeout(notifyState, 0);
    speechSynthesis.speak(u);
  }
  notifyState();
  return true;
}

export function stopSpeaking() {
  for (const id of timers) clearTimeout(id);
  timers = [];
  if (speechAvailable()) speechSynthesis.cancel();
  notifyState();
}

// Ping recién llegado: se lee tras el sonido, si los ajustes lo permiten.
export function speakPing(m) {
  const cfg = voiceSettings();
  // Modo captura: la retransmisión también graba el audio, así que el ping no se lee (el sonido sí suena).
  if (S.settings?.capture?.enabled) return false;
  if (!shouldSpeak(m.body, cfg)) return false;
  const text = pingSpeech(m.body, cfg);
  const id = setTimeout(() => {
    timers = timers.filter((x) => x !== id);
    speak(text, cfg);
  }, Math.max(0, cfg.delay ?? 0) * 1000);
  timers.push(id);
  return true;
}

// Al volver a la ventana, con «dejar de leer al volver», se calla.
export function windowFocused() {
  if (voiceSettings().stopOnFocus) stopSpeaking();
}
