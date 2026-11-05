// Preferencias → Notificaciones: avisos, sonidos y reglas por palabra clave.
import { S, api } from "../state.js";
import { h, icon, iconButton, modal, field, toggle, select, range, clear, toast, confirmDialog } from "../dom.js";
import { PRESETS as SOUNDS, SOUND_GROUPS, previewSound, outputDevices } from "../sounds.js";
import { newRule, normalizeRule, compileRule } from "../keywords.js";
import { t } from "../i18n.js";
import { isWindows, onWindows, trayAvailable } from "../system.js";
import { look, full, group, soundRow, popupTestColors } from "./common.js";
import { dndGroup } from "./dnd-schedule.js";

export const notificationTabs = {
  notifications() {
    const n = S.settings.notifications;
    const set = (fn) => look((x) => fn(x.notifications));
    const kw = h("textarea", { class: "input", rows: 2, placeholder: t("Una palabra o frase por línea (p. ej. «cyno», «titan», tu nombre de personaje)"), value: (n.keywords || []).join("\n") });
    kw.value = (n.keywords || []).join("\n");
    kw.addEventListener("change", () => full((x) => (x.notifications.keywords = kw.value.split("\n").map((s) => s.trim()).filter(Boolean))));
    // Salida de audio: se rellena al abrir (la lista depende de los dispositivos conectados).
    const device = select([["", onWindows(t("Predeterminada de Windows"), t("Predeterminada del sistema"))]], n.outputDevice || "", (v) => (set((x) => (x.outputDevice = v)), previewSound(S.settings.notifications.sounds.private)));
    outputDevices().then((list) => {
      for (const d of list) device.append(h("option", { value: d.id }, d.label));
      device.value = list.some((d) => d.id === n.outputDevice) ? n.outputDevice : "";
    });
    return h(
      "div",
      {},
      group(
        t("General"),
        toggle(n.enabled, (v) => set((x) => (x.enabled = v)), t("Notificaciones de escritorio")),
        toggle(n.showPreview, (v) => set((x) => (x.showPreview = v)), t("Mostrar el texto del mensaje en la notificación")),
        isWindows() ? toggle(n.flashTaskbar, (v) => set((x) => (x.flashTaskbar = v)), t("Hacer parpadear la barra de tareas")) : null,
      ),
      dndGroup(),
      group(
        t("Aspecto del aviso"),
        field(
          t("Tipo de notificación"),
          select(
            [
              ["custom", t("Burbuja de EvEX-MPP (sube desde la barra de tareas, siempre encima)")],
              ["windows", onWindows(t("Notificación de Windows (centro de notificaciones)"), t("Notificación del sistema"))],
              ["both", t("Ambas")],
            ],
            n.popupStyle,
            (v) => set((x) => (x.popupStyle = v)),
          ),
          t("La burbuja propia también se ve sobre EVE en modo ventana sin bordes"),
        ),
        field(
          t("Esquina de la pantalla"),
          select(
            [
              ["bottom-left", t("Abajo a la izquierda")],
              ["bottom-right", t("Abajo a la derecha")],
              ["top-left", t("Arriba a la izquierda")],
              ["top-right", t("Arriba a la derecha")],
            ],
            n.popupCorner,
            (v) => set((x) => (x.popupCorner = v)),
          ),
        ),
        field(t("Duración de los avisos de mensajes"), range(3, 30, 1, n.popupDuration, (v) => set((x) => (x.popupDuration = v)), (v) => `${v} s`)),
        toggle(n.pingSticky, (v) => set((x) => (x.pingSticky = v)), t("Los pings se quedan en pantalla hasta cerrarlos"), t("Si no, desaparecen como los mensajes")),
        trayAvailable() ? toggle(n.trayBlink, (v) => set((x) => (x.trayBlink = v)), t("Parpadear el «!» de la bandeja con pings sin leer")) : null,
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn", onclick: () => (api("notify:test", "msg", popupTestColors()), previewSound(S.settings.notifications.sounds.private)) }, icon("message-square"), t("Probar aviso de mensaje")),
          h("button", { class: "btn", onclick: () => (api("notify:test", "ping", popupTestColors()), previewSound(S.settings.notifications.sounds.ping)) }, icon("siren"), t("Probar aviso de ping")),
        ),
      ),
      group(
        t("Cuándo avisar"),
        toggle(n.privateMessages, (v) => set((x) => (x.privateMessages = v)), t("Mensajes privados")),
        toggle(n.mentions, (v) => set((x) => (x.mentions = v)), t("Cuando te mencionan en una sala")),
        toggle(n.allRoomMessages, (v) => set((x) => (x.allRoomMessages = v)), t("Todos los mensajes de todas las salas"), t("Se puede ajustar por sala con clic derecho")),
        toggle(n.pings, (v) => set((x) => (x.pings = v)), t("Pings de flota (remitentes configurados en «Pings de flota»)")),
        field(t("Palabras clave que cuentan como mención"), kw),
      ),
      keywordRulesGroup(),
      group(
        t("Sonidos"),
        toggle(n.sound, (v) => set((x) => (x.sound = v)), t("Reproducir sonidos")),
        field(t("Volumen general"), range(0, 1, 0.05, n.volume, (v) => set((x) => (x.volume = v)), (v) => `${Math.round(v * 100)}%`)),
        field(t("Salida de audio"), device, t("Por ejemplo, los auriculares para oír los avisos mientras juegas")),
        h("div", { class: "row" }, h("button", { class: "btn", onclick: importPidginSounds }, icon("import"), t("Importar sonidos de Pidgin"))),
      ),
      SOUND_GROUPS.map(([name, kinds]) =>
        group(
          t("Sonidos: {group}", { group: t(name) }),
          kinds.map(([kind, label]) => soundRow(kind, label)),
          name === "Flota" ? h("div", { class: "row" }, h("button", { class: "btn small", type: "button", onclick: () => document.querySelector('.settings-tab[data-tab="pings"]')?.click() }, icon("siren"), t("Todos los ajustes de los pings: «Pings de flota»"))) : null,
        ),
      ),
    );
  },

};

// ---------- reglas por palabra clave ----------

// Cada regla: palabras, cómo se buscan, dónde, qué aviso da, su sonido y su color. Manda la primera que coincide.
function keywordRulesGroup() {
  const list = h("div", { class: "rule-list" });
  const rules = () => (S.settings.notifications.keywordRules || []).map(normalizeRule);
  const save = (next) => full((x) => (x.notifications.keywordRules = next));
  const update = (id, fn) => save(rules().map((r) => (r.id === id ? normalizeRule((fn(r), r)) : r)));
  const render = () => {
    clear(list);
    const all = rules();
    if (!all.length) list.append(h("p", { class: "muted small" }, t("Todavía no hay reglas.")));
    all.forEach((r, i) => list.append(ruleCard(r, i, all.length)));
  };

  const ruleCard = (r, i, total) => {
    const status = h("span", { class: "rule-status small" });
    const sample = h("input", { class: "input", placeholder: t("Escribe un texto para probar la regla") });
    const check = () => {
      const cur = rules().find((x) => x.id === r.id) || r;
      const { re, error } = compileRule(cur);
      status.className = "rule-status small";
      if (error) return ((status.textContent = t("Expresión no válida: {error}", { error })), status.classList.add("bad"));
      if (!re) return (status.textContent = t("Añade al menos una palabra"));
      if (!sample.value) return (status.textContent = "");
      re.lastIndex = 0;
      const ok = re.test(sample.value);
      status.textContent = ok ? t("✓ Coincide") : t("✗ No coincide");
      status.classList.add(ok ? "good" : "bad");
    };
    sample.addEventListener("input", check);

    const enabled = h("input", { type: "checkbox", checked: r.enabled, onchange: (e) => (update(r.id, (x) => (x.enabled = e.target.checked)), card.classList.toggle("off", !e.target.checked)) });
    const name = h("input", { class: "input rule-name", placeholder: t("Nombre de la regla (opcional)"), value: r.name });
    name.addEventListener("change", () => update(r.id, (x) => (x.name = name.value.trim())));
    const color = h("input", { type: "color", class: "rule-color", value: r.color, title: t("Color del resaltado y del aviso") });
    color.addEventListener("change", () => (update(r.id, (x) => (x.color = color.value)), card.style.setProperty("--kw", color.value)));
    const words = h("textarea", { class: "input", rows: 2, placeholder: t("Una palabra o frase por línea (p. ej. «titan», «cyno», «Ferox»)") });
    words.value = r.words.join("\n");
    words.addEventListener("change", () => (update(r.id, (x) => (x.words = words.value.split("\n"))), check()));

    const where = (key, label) =>
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: r.where[key], onchange: (e) => update(r.id, (x) => (x.where[key] = e.target.checked)) }), label);

    // Sonido: el normal del aviso, uno de la lista o un archivo propio, con su volumen.
    const cur = () => (rules().find((x) => x.id === r.id) || r).sound;
    const preview = () => previewSound(cur().preset === "default" ? S.settings.notifications.sounds.mention : cur());
    const sel = select([["default", t("Sonido normal del aviso")], ...Object.entries(SOUNDS).map(([k, v]) => [k, t(v.name)]), ["custom", t("Archivo propio…")]], r.sound.preset, async (v) => {
      if (v === "custom" && !cur().file) {
        const url = await api("file:pick", "sound");
        if (!url) return (sel.value = cur().preset);
        update(r.id, (x) => (x.sound = { ...x.sound, preset: "custom", file: url }));
      } else update(r.id, (x) => (x.sound = { ...x.sound, preset: v }));
      preview();
    });
    const pick = iconButton("folder-open", t("Elegir otro archivo de sonido"), async () => {
      const url = await api("file:pick", "sound");
      if (!url) return;
      update(r.id, (x) => (x.sound = { ...x.sound, preset: "custom", file: url }));
      sel.value = "custom";
      preview();
    });
    const vol = range(0, 1, 0.05, r.sound.volume ?? 1, (v) => update(r.id, (x) => (x.sound = { ...x.sound, volume: v })), (v) => `${Math.round(v * 100)}%`);
    vol.classList.add("sound-volume");
    vol.title = t("Volumen de este sonido");

    const move = (dir) => {
      const all = rules();
      const j = i + dir;
      [all[i], all[j]] = [all[j], all[i]];
      save(all);
      render();
    };
    const remove = async () => {
      const ok = await confirmDialog({ title: t("Quitar regla"), message: t("¿Quitar la regla «{name}»?", { name: r.name || r.words[0] || t("sin nombre") }), okLabel: t("Quitar"), danger: true });
      if (!ok) return;
      save(rules().filter((x) => x.id !== r.id));
      render();
    };

    const card = h(
      "div",
      { class: `rule-card ${r.enabled ? "" : "off"}`, style: { "--kw": r.color } },
      h(
        "div",
        { class: "rule-head" },
        h("label", { class: "switch", title: t("Activar o desactivar la regla") }, enabled, h("span", { class: "slider" })),
        name,
        color,
        i > 0 ? iconButton("arrow-down", t("Subir (tiene prioridad sobre las de abajo)"), () => move(-1), "rule-up") : null,
        i < total - 1 ? iconButton("arrow-down", t("Bajar"), () => move(1)) : null,
        iconButton("trash-2", t("Quitar regla"), remove),
      ),
      field(t("Palabras"), words),
      h(
        "div",
        { class: "rule-grid" },
        field(
          t("Cómo se buscan"),
          select(
            [
              ["word", t("Palabra completa")],
              ["contains", t("Dentro de cualquier palabra")],
              ["regex", t("Expresión regular (una por línea)")],
            ],
            r.match,
            (v) => (update(r.id, (x) => (x.match = v)), check()),
          ),
        ),
        field(
          t("Qué hace"),
          select(
            [
              ["always", t("Avisar siempre")],
              ["mention", t("Avisar como una mención")],
              ["never", t("Solo resaltar")],
            ],
            r.notify,
            (v) => update(r.id, (x) => (x.notify = v)),
          ),
        ),
      ),
      h("p", { class: "field-hint rule-hint" }, t("«Avisar siempre» avisa aunque la sala esté silenciada; «como una mención» respeta las salas silenciadas.")),
      field(t("Dónde"), h("div", { class: "row rule-where" }, where("rooms", t("Salas")), where("private", t("Mensajes privados")), where("pings", t("Pings de flota")))),
      field(t("Sonido"), h("div", { class: "row sound-row" }, sel, iconButton("volume-2", t("Probar"), preview), pick, vol)),
      toggle(r.sticky, (v) => update(r.id, (x) => (x.sticky = v)), t("La burbuja se queda en pantalla hasta cerrarla")),
      toggle(r.dnd, (v) => update(r.id, (x) => (x.dnd = v)), t("Avisar también con «No molestar»")),
      field(t("Probar"), h("div", { class: "row rule-test" }, sample, status)),
    );
    check();
    return card;
  };

  render();
  return group(
    t("Reglas por palabra clave"),
    h("p", { class: "muted small" }, t("Resalta con su color los mensajes y pings que contienen ciertas palabras y les da un aviso y un sonido propios. Si coinciden varias reglas, manda la de más arriba.")),
    list,
    h("button", { class: "btn", onclick: () => (save([...rules(), newRule()]), render()) }, icon("plus"), t("Añadir regla")),
  );
}

// Copia los sonidos del Pidgin instalado (los personalizados si los hay) y deja elegir a qué avisos aplicarlos.
async function importPidginSounds() {
  const scan = await api("sounds:pidginScan");
  if (!scan.found) return toast(t("No se ha encontrado Pidgin instalado ni sonidos configurados en él."), { kind: "warn" });
  const label = Object.fromEntries(SOUND_GROUPS.flatMap(([, kinds]) => kinds));
  // Los de contactos vienen desmarcados: en salas grandes suenan mucho.
  const checks = Object.entries(scan.sounds).map(([kind, info]) => {
    const input = h("input", { type: "checkbox", checked: !kind.startsWith("contact") });
    return { kind, input, row: h("label", { class: "check-row" }, input, h("span", {}, t(label[kind])), h("span", { class: "muted small" }, `${info.name}${info.custom ? ` (${t("personalizado")})` : ""}`)) };
  });
  modal({
    title: t("Importar sonidos de Pidgin"),
    body: h("div", {}, h("p", { class: "muted small" }, t("Se copian del Pidgin instalado en tu PC. El ping de flota no se cambia.")), checks.map((c) => c.row)),
    actions: [
      { label: t("Cancelar"), action: (close) => close() },
      {
        label: t("Importar"),
        primary: true,
        action: async (close) => {
          const kinds = checks.filter((c) => c.input.checked).map((c) => c.kind);
          const urls = await api("sounds:pidginImport", kinds);
          look((x) => {
            for (const [kind, url] of Object.entries(urls)) x.notifications.sounds[kind] = { ...x.notifications.sounds[kind], preset: "custom", file: url };
          });
          close();
          toast(t("Sonidos de Pidgin importados: {n}", { n: Object.keys(urls).length }), { kind: "ok" });
          // Volver a pintar la pestaña para que se vean los sonidos nuevos.
          document.querySelector('.settings-tab[data-tab="notifications"]')?.click();
        },
      },
    ],
  });
}
