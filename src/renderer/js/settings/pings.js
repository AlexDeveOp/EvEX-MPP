// Preferencias → Pings de flota: remitentes, aviso y sonido, lectura en voz alta y cuenta atrás del formup.
import { S, api } from "../state.js";
import { h, icon, iconButton, field, toggle, select, range } from "../dom.js";
import { PRESETS as SOUNDS, previewSound } from "../sounds.js";
import { parseFormup, countdownText, countdownSettings } from "../formup.js";
import { parsePing } from "../pings.js";
import { fmtTime, fmtEve } from "../format.js";
import { t } from "../i18n.js";
import { isWindows, onWindows } from "../system.js";
import { VOICE_DEFAULTS, TEMPLATE_FIELDS, voiceSettings, listVoices, pingSpeech, speak, stopSpeaking, speechAvailable } from "../tts.js";
import { look, full, group, soundRow, popupTestColors } from "./common.js";

// «Pings de flota» → Aviso y sonido: lo mismo que en Notificaciones, reunido aquí con lo demás de los pings.
function pingAlertGroup() {
  const n = S.settings.notifications;
  const set = (fn) => look((x) => fn(x.notifications));
  const r = { enabled: false, interval: 30, times: 5, ...n.pingRepeat };
  return group(
    t("Aviso y sonido"),
    toggle(n.pings, (v) => set((x) => (x.pings = v)), t("Avisar de los pings de flota"), t("Sonido y burbuja al llegar un ping, también con «No molestar»")),
    soundRow("ping", t("Sonido del ping")),
    toggle(r.enabled, (v) => set((x) => (x.pingRepeat = { ...r, ...x.pingRepeat, enabled: v })), t("Repetir el sonido del ping hasta que mires la ventana"), t("Para no perderte un ping si estás lejos del ordenador")),
    field(t("Repetir cada"), range(10, 120, 5, r.interval, (v) => set((x) => (x.pingRepeat = { ...r, ...x.pingRepeat, interval: v })), (v) => `${v} s`)),
    field(t("Máximo de repeticiones"), range(1, 20, 1, r.times, (v) => set((x) => (x.pingRepeat = { ...r, ...x.pingRepeat, times: v })), (v) => `${v}`)),
    toggle(n.pingSticky, (v) => set((x) => (x.pingSticky = v)), t("Los pings se quedan en pantalla hasta cerrarlos"), t("Si no, desaparecen como los mensajes")),
    h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => (api("notify:test", "ping", popupTestColors()), previewSound(S.settings.notifications.sounds.ping)) }, icon("siren"), t("Probar aviso de ping"))),
  );
}

// Sin voces: en Windows se añaden en Configuración; en Linux hacen falta speech-dispatcher y una voz.
function noVoicesHelp() {
  if (isWindows()) return h("p", { class: "muted small" }, t("Windows no tiene voces instaladas: añádelas en Configuración → Hora e idioma → Voz."));
  return h(
    "div",
    { class: "muted small voice-help" },
    h("p", {}, t("No hay voces instaladas. En Linux la lectura en voz alta usa speech-dispatcher; instálalo con una voz, por ejemplo:")),
    h("code", { class: "code-inline" }, "sudo apt install speech-dispatcher espeak-ng"),
    h("p", {}, t("Después cierra EvEX-MPP del todo y vuelve a abrirlo.")),
  );
}

// Ping de ejemplo para probar la lectura en voz alta.
const SAMPLE_PING = "Capital fleet up now!!\nFC Name: Bob FC\nFormup Location: Jita\nPAP Type: Strategic\nComms: Op 1\nDoctrine: Typhoons\n\n~~~ This was a coord broadcast from bob to all ~~~";

// «Pings de flota» → Lectura en voz alta (src/renderer/js/tts.js).
function voiceGroup() {
  const v = voiceSettings();
  const set = (patch) => look((x) => (x.pingVoice = { ...VOICE_DEFAULTS, ...x.pingVoice, ...patch }));
  const body = h("div", { class: `voice-options ${v.enabled ? "" : "off"}` });
  const voiceSel = select([["", t("Automática (una voz en inglés, si está instalada)")]], v.voice, (x) => set({ voice: x }));
  listVoices().then((list) => {
    for (const voice of list) voiceSel.append(h("option", { value: voice.name }, `${voice.name} (${voice.lang})`));
    voiceSel.value = list.some((x) => x.name === v.voice) ? v.voice : "";
    if (!list.length) voiceSel.after(noVoicesHelp());
  });
  const template = h("textarea", { class: "input", rows: 2 });
  template.value = v.template;
  const preview = h("p", { class: "muted small voice-preview" });
  const showPreview = () => (preview.textContent = t("Se leería: «{text}»", { text: pingSpeech(SAMPLE_PING, voiceSettings()) }));
  const refresh = (patch) => (set(patch), showPreview());
  template.addEventListener("change", () => refresh({ template: template.value.trim() || VOICE_DEFAULTS.template }));
  const templateField = field(t("Plantilla"), template, t("Campos: {fields}. Las frases con un campo vacío no se leen.", { fields: TEMPLATE_FIELDS.map((f) => `{${f}}`).join(" ") }));
  templateField.classList.toggle("hidden", v.content !== "template");
  showPreview();
  const groups = h("input", { class: "input", placeholder: t("Todos los grupos") });
  groups.value = v.groups;
  groups.addEventListener("change", () => set({ groups: groups.value.trim() }));
  body.append(
    field(t("Voz"), voiceSel, onWindows(t("Las voces instaladas en Windows. No se envía nada a Internet. Suena por la salida de audio predeterminada de Windows."), t("Las voces instaladas en el sistema. No se envía nada a Internet. Suena por la salida de audio predeterminada del sistema."))),
    field(t("Velocidad"), range(0.5, 2, 0.05, v.rate, (x) => set({ rate: x }), (x) => `${x.toFixed(2)}×`)),
    field(t("Tono"), range(0.5, 1.5, 0.05, v.pitch, (x) => set({ pitch: x }), (x) => x.toFixed(2))),
    field(t("Volumen de la voz"), range(0, 1, 0.05, v.volume, (x) => set({ volume: x }), (x) => `${Math.round(x * 100)}%`)),
    field(
      t("Qué leer"),
      select(
        [
          ["summary", t("Resumen: título, FC, formup y doctrina")],
          ["title", t("Solo el título")],
          ["full", t("Todo el ping")],
          ["template", t("Plantilla propia…")],
        ],
        v.content,
        (x) => (refresh({ content: x }), templateField.classList.toggle("hidden", x !== "template")),
      ),
    ),
    templateField,
    preview,
    field(t("Longitud máxima"), range(100, 1000, 50, v.maxChars, (x) => refresh({ maxChars: x }), (x) => t("{n} caracteres", { n: x }))),
    field(
      t("Cuándo leer"),
      select(
        [
          ["always", t("Siempre")],
          ["unfocused", t("Solo si no estás mirando la ventana de EvEX-MPP")],
        ],
        v.when,
        (x) => set({ when: x }),
      ),
    ),
    toggle(v.dnd, (x) => set({ dnd: x }), t("Leer también con «No molestar»")),
    toggle(v.stopOnFocus, (x) => set({ stopOnFocus: x }), t("Dejar de leer al volver a la ventana")),
    field(t("Solo estos grupos"), groups, t("Destinatarios del pie del ping (p. ej. «all, caps»), separados por comas. Vacío = todos.")),
    field(t("Esperar tras el sonido"), range(0, 5, 0.5, v.delay, (x) => set({ delay: x }), (x) => `${x} s`)),
    field(
      t("Veces que se lee"),
      select(
        [
          ["1", t("Una vez")],
          ["2", t("Dos veces")],
          ["3", t("Tres veces")],
        ],
        String(v.repeat),
        (x) => set({ repeat: Number(x) }),
      ),
    ),
    h(
      "div",
      { class: "row" },
      h("button", { class: "btn", type: "button", onclick: () => (stopSpeaking(), speak(pingSpeech(SAMPLE_PING, voiceSettings()), voiceSettings())) }, icon("volume-2"), t("Probar con un ping de ejemplo")),
      h("button", { class: "btn", type: "button", onclick: stopSpeaking }, icon("volume-x"), t("Detener")),
    ),
  );
  return group(
    t("Lectura en voz alta"),
    toggle(
      v.enabled,
      (x) => (set({ enabled: x }), body.classList.toggle("off", !x)),
      t("Leer los pings en voz alta"),
      speechAvailable() ? t("Al llegar un ping se lee tras su sonido, aunque las notificaciones estén desactivadas") : t("Este sistema no tiene síntesis de voz"),
    ),
    body,
  );
}

export const pingTabs = {
  pings() {
    const s = S.settings;
    const senders = h("textarea", { class: "input", rows: 3, placeholder: t("p. ej. pingbot@ejemplo.com, o solo «pingbot» para cualquier servidor") });
    senders.value = s.pingSenders.join("\n");
    senders.addEventListener("change", () => full((x) => (x.pingSenders = senders.value.split("\n").map((v) => v.trim().toLowerCase()).filter(Boolean))));
    return h(
      "div",
      {},
      group(
        t("Remitentes de pings"),
        h("p", { class: "muted small" }, t("Los mensajes de estas direcciones aparecen como tarjetas en «Pings de flota», con alarma propia y notificación prioritaria.")),
        field(t("Direcciones (una por línea)"), senders),
      ),
      pingAlertGroup(),
      group(
        t("Aviso visual"),
        field(
          t("La sirena de los pings recientes late…"),
          select(
            [
              ["0", t("Nunca")],
              ["5", t("Durante 5 minutos")],
              ["15", t("Durante 15 minutos")],
              ["30", t("Durante 30 minutos")],
              ["60", t("Durante 1 hora")],
              ["120", t("Durante 2 horas")],
              ["unseen", t("Hasta que vuelvas a abrir los pings")],
            ],
            s.pingHighlight ?? "60",
            (v) => full((x) => (x.pingHighlight = v)),
          ),
          t("Con «hasta que vuelvas a abrir los pings» solo laten los que han llegado desde la última vez que saliste de la vista de pings. Si desactivas las animaciones (Apariencia), no late nunca."),
        ),
      ),
      voiceGroup(),
      formupGroup(),
      // Pings que llegaron con la app cerrada (src/main/ping-recovery.js). Ambos activados por defecto.
      group(
        t("Pings que llegaron con la app cerrada"),
        toggle(s.pingRecovery?.pidgin !== false, (v) => look((x) => (x.pingRecovery = { ...x.pingRecovery, pidgin: v })), t("Recuperarlos de Pidgin en este PC"), t("Lee solo las conversaciones con los remitentes de pings en los registros de Pidgin, al iniciar y cada 2 minutos. No se envía nada.")),
        toggle(s.pingRecovery?.server !== false, (v) => look((x) => (x.pingRecovery = { ...x.pingRecovery, server: v })), t("Pedirlos al servidor al conectar"), t("Solo si el servidor guarda archivo de mensajes (XEP-0313); lo indica la ficha de la cuenta. Se piden los mensajes de los remitentes de pings de los últimos 7 días como mucho.")),
        h("p", { class: "muted small" }, t("También puedes buscarlos al momento con el botón de la cabecera de «Pings de flota». Los recuperados no suenan, porque ya pasaron.")),
      ),
      group(
        t("Importante si usas Pidgin a la vez"),
        h(
          "p",
          { class: "muted" },
          t("Los pings se envían a tu cuenta, no a una sala. Si tienes Pidgin y EvEX-MPP conectados a la vez, el servidor los entrega al cliente con mayor prioridad. Sube la prioridad de esta cuenta (Cuentas → Conexión avanzada) para recibirlos aquí."),
        ),
      ),
    );
  },

};

// ---------- cuenta atrás del formup (Preferencias → Pings de flota) ----------

// Apartado propio: se llama desde la pestaña de pings. Ajustes en settings.pingCountdown (valores por defecto en formup.js).
export function formupGroup() {
  const cfg = () => countdownSettings();
  const set = (patch) => full((x) => (x.pingCountdown = { ...countdownSettings(x), ...patch }));
  const c = cfg();

  const sel = select([...Object.entries(SOUNDS).map(([k, v]) => [k, t(v.name)]), ["custom", t("Archivo propio…")]], c.sound.preset, async (v) => {
    if (v === "custom" && !cfg().sound.file) {
      const url = await api("file:pick", "sound");
      if (!url) return (sel.value = cfg().sound.preset);
      set({ sound: { ...cfg().sound, preset: "custom", file: url } });
    } else set({ sound: { ...cfg().sound, preset: v } });
    previewSound(cfg().sound);
  });
  const pick = iconButton("folder-open", t("Elegir otro archivo de sonido"), async () => {
    const url = await api("file:pick", "sound");
    if (!url) return;
    set({ sound: { ...cfg().sound, preset: "custom", file: url } });
    sel.value = "custom";
    previewSound(cfg().sound);
  });
  const vol = range(0, 1, 0.05, c.sound.volume ?? 1, (v) => set({ sound: { ...cfg().sound, volume: v } }), (v) => `${Math.round(v * 100)}%`);
  vol.classList.add("sound-volume");
  vol.title = t("Volumen de este sonido");

  // Probar con el texto de un ping: qué hora del formup se lee.
  const sample = h("textarea", { class: "input", rows: 3, placeholder: t("Pega aquí un ping para ver qué hora del formup se lee") });
  const result = h("p", { class: "muted small formup-test" });
  sample.addEventListener("input", () => {
    if (!sample.value.trim()) return (result.textContent = "");
    const at = parseFormup(parsePing(sample.value), Date.now());
    result.textContent = at ? t("Formup: {eve} EVE ({local} local) · {text}", { eve: fmtEve(at), local: fmtTime(at), text: countdownText(at).text }) : t("No se encuentra ninguna hora de formup en este texto.");
  });

  return group(
    t("Cuenta atrás del formup"),
    toggle(c.enabled, (v) => set({ enabled: v }), t("Mostrar la cuenta atrás"), t("Muestra en la tarjeta del ping cuánto falta para el formup")),
    toggle(c.alert, (v) => set({ alert: v }), t("Avisar cuando llegue el formup"), t("Con burbuja y sonido, aunque esté activado «No molestar»")),
    field(
      t("Avisar antes"),
      select(
        [
          ["0", t("No, solo a la hora")],
          ["5", t("5 minutos antes")],
          ["10", t("10 minutos antes")],
          ["15", t("15 minutos antes")],
          ["30", t("30 minutos antes")],
        ],
        String(c.before),
        (v) => set({ before: Number(v) }),
      ),
    ),
    toggle(c.atTime, (v) => set({ atTime: v }), t("Avisar también a la hora exacta del formup")),
    toggle(c.sticky, (v) => set({ sticky: v }), t("El aviso se queda en pantalla hasta cerrarlo")),
    field(t("Sonido del aviso"), h("div", { class: "row sound-row" }, sel, iconButton("volume-2", t("Probar"), () => previewSound(cfg().sound)), pick, vol)),
    h(
      "p",
      { class: "muted small" },
      t("La hora se lee en hora EVE de campos como «Formup Time: 19:00» o de textos como «formup at 19:30 EVE» o «undock in 20 min». La hora del pie del ping es la de envío, no la del formup. Si el ping no trae hora, no hay cuenta atrás."),
    ),
    field(t("Probar"), sample),
    result,
  );
}
