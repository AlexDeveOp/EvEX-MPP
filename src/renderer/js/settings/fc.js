// Preferencias → Modo FC: enviar pings al bot de tu alianza. Apagado de serie: con el interruptor apagado, lo demás
// se ve en gris y no se puede tocar. Todo se guarda solo en este equipo (S.settings.fcMode; la forma válida la
// asegura normalizeFcMode en src/main/store.js).
import { S, rosterOf } from "../state.js";
import { h, icon, iconButton, field, toggle, select, prompt, toast, clear, confirmDialog } from "../dom.js";
import { t } from "../i18n.js";
import { full, group } from "./common.js";
import { pingsConv, loadHistory } from "../convs.js";
import { learnedGroups, groupRows, groupUsable, upsertGroup, removeGroup, sameGroup } from "../fc-groups.js";
import { webUrlOk } from "../fc-compose.js";
import { sortSaved, renameSaved, removeSaved, moveSaved } from "../fc-quick.js";
import { timeAgo } from "../format.js";

// «Compartir configuración» (exportar e importar, en otro fichero): cada parte registra aquí sus controles,
// addFcShareControls(() => elemento | null), una vez al arrancar. La sección solo sale si hay algo registrado y, al
// contrario que el resto, se puede usar con el modo apagado (se importa la configuración y luego se activa).
const shareControls = [];
export function addFcShareControls(build) {
  shareControls.push(build);
}

// Pestañas de la ventana «Enviar ping», en el orden de serie.
export const FC_TAB_LABELS = { quick: () => t("Ping rápido"), template: () => t("Plantilla"), paste: () => t("Pegar texto") };

// Campos de la plantilla: id, nombre y marcador del formato del texto.
export const FC_FIELDS = [
  ["type", () => t("Tipo de flota"), "{tipo}"],
  ["fc", () => t("FC"), "{fc}"],
  ["time", () => t("Hora del formup"), "{hora}"],
  ["place", () => t("Lugar"), "{lugar}"],
  ["doctrine", () => t("Doctrina"), "{doctrina}"],
  ["comms", () => t("Comms"), "{comms}"],
  ["pap", () => t("PAP"), "{pap}"],
  ["notes", () => t("Notas"), "{notas}"],
];
// El mismo que DEFAULT_SETTINGS.fcMode.template.format (src/main/store.js); un test comprueba que no se separen.
export const DEFAULT_FORMAT = "{tipo} · FC: {fc}\nFormup: {hora} EVE · {lugar}\nDoctrine: {doctrina} · Comms: {comms}\n{notas}";

// Cómo le dice el bot a qué grupo va el ping. Para añadir otro modo: aquí, en FC_GROUP_MODES (store.js) y en el envío.
const GROUP_MODES = [
  ["address", () => t("Una dirección por grupo"), () => t("Cada grupo tiene su contacto o sala")],
  ["line", () => t("Una línea al principio del ping"), () => t("El bot lee una orden, p. ej. «!ping caps»")],
  ["web", () => t("Web de la alianza"), () => t("Se envía desde una página web: la app copia el texto y la abre")],
];
// El bloque «Avanzado» sigue abierto al repintar.
let advancedOpen = false;

const fc = () => S.settings.fcMode;
const set = (fn, repaint) => {
  full((s) => fn(s.fcMode));
  repaint?.();
};

function fcTab() {
  const box = h("div", { class: "fc-settings" });
  const paint = () => {
    const scroll = box.closest(".settings-content")?.scrollTop;
    clear(box).append(...fcContent(paint));
    const sc = box.closest(".settings-content");
    if (sc && scroll != null) sc.scrollTop = scroll;
  };
  paint();
  // Los grupos aprendidos salen de los pings guardados: si aún no se han cargado, se cargan y se repinta.
  const pc = pingsConv();
  if (!pc.loaded) loadHistory(pc).then(() => box.isConnected && paint(), () => {});
  return box;
}

function fcContent(repaint) {
  const f = fc();
  const master = h(
    "div",
    { class: `fc-master ${f.enabled ? "on" : ""}` },
    toggle(f.enabled, (v) => set((x) => (x.enabled = v), repaint), f.enabled ? t("Modo FC activado") : t("Modo FC"), f.enabled ? t("«Enviar ping» está en la barra lateral, debajo de Pings de flota.") : t("Para FCs: enviar pings al bot de tu alianza desde EvEX-MPP. Apagado, no cambia nada.")),
  );
  const rest = h("div", { class: `fc-rest ${f.enabled ? "" : "fc-disabled"}` }, channelGroup(repaint), tabsGroup(repaint), templateGroup(repaint), groupsGroup(repaint), savedGroup(repaint), safetyGroup(repaint));
  if (!f.enabled) {
    rest.inert = true;
    rest.setAttribute("aria-disabled", "true");
  }
  return [master, rest, shareGroup()].filter(Boolean);
}

function shareGroup() {
  const parts = [];
  for (const build of shareControls) {
    try {
      const el = build();
      if (el) parts.push(el);
    } catch (e) {
      console.error(e);
    }
  }
  return parts.length ? group(t("Compartir configuración"), h("div", { class: "fc-share" }, parts)) : null;
}

// ---------- pings rápidos guardados ----------

const SAVED_ORDER_LABELS = [
  ["used", () => t("Los que más uso primero")],
  ["alpha", () => t("Por orden alfabético")],
  ["manual", () => t("A mano")],
];

function savedGroup(repaint) {
  const f = fc();
  const list = sortSaved(f.saved, f.savedOrder);
  const manual = f.savedOrder === "manual";
  const rows = list.map((item, i) => {
    const origin = item.kind === "paste" ? t("texto pegado") : t("de la plantilla");
    const used = item.lastUsed ? t("usado {ago}", { ago: timeAgo(item.lastUsed) }) : t("nunca usado");
    const rename = async () => {
      const name = await prompt({ title: t("Cambiar el nombre"), label: t("Nombre del ping guardado"), value: item.name, icon: "pencil" });
      if (name != null) set((x) => (x.saved = renameSaved(x.saved, item.id, name)), repaint);
    };
    const remove = async () => {
      if (await confirmDialog({ title: t("Borrar el ping guardado"), message: t("¿Borrar «{name}» de Ping rápido?", { name: item.name }), okLabel: t("Borrar"), danger: true }))
        set((x) => (x.saved = removeSaved(x.saved, item.id)), repaint);
    };
    return h(
      "div",
      { class: "fc-saved-row", dataset: { id: item.id } },
      h("span", { class: "fc-saved-name" }, item.name),
      h("span", { class: "muted small fc-saved-meta" }, `${origin} · ${used}`, item.groups.length ? ` · ${item.groups.join(", ")}` : ""),
      manual ? moveButton("chevron-up", t("Subir"), i === 0, () => set((x) => (x.saved = moveSaved(x.saved, item.id, -1)), repaint)) : null,
      manual ? moveButton("chevron-down", t("Bajar"), i === list.length - 1, () => set((x) => (x.saved = moveSaved(x.saved, item.id, 1)), repaint)) : null,
      iconButton("pencil", t("Cambiar el nombre"), rename),
      iconButton("trash-2", t("Borrar"), remove),
    );
  });
  return group(
    t("Pings rápidos guardados"),
    rows.length
      ? h("div", { class: "fc-saved-list" }, rows)
      : h("p", { class: "muted small" }, t("Aún no hay ninguno. Para guardar uno, marca «Guardar en Ping rápido» al enviarlo desde Plantilla o Pegar texto.")),
    field(t("Orden en «Ping rápido»"), select(SAVED_ORDER_LABELS.map(([v, l]) => [v, l()]), f.savedOrder, (v) => set((x) => (x.savedOrder = v), repaint))),
  );
}

// ---------- canal del bot ----------

const chanValue = (c) => (c.jid ? `${c.kind || "chat"}|${c.accountId}|${c.jid}` : "");

function channelOptions() {
  const out = [];
  for (const acc of S.accounts) {
    const tag = S.accounts.length > 1 ? ` · ${acc.jid}` : "";
    for (const r of acc.rooms || []) out.push([`groupchat|${acc.id}|${r.jid}`, `# ${r.name || r.jid}${tag}`, r.jid]);
    for (const [jid, c] of rosterOf(acc.id)) out.push([`chat|${acc.id}|${jid}`, `${c.name || jid}${c.name ? ` (${jid})` : ""}${tag}`, jid]);
  }
  return out;
}

function channelGroup(repaint) {
  const c = fc().channel;
  const opts = channelOptions();
  const cur = chanValue(c);
  const known = opts.some(([v]) => v === cur);
  const custom = !!c.jid && !known;
  const sel = select([["", t("Sin elegir")], ...opts.map(([v, label]) => [v, label]), ["other", t("Escribir una dirección…")]], custom ? "other" : cur, (v) => {
    if (v === "other") return set((x) => (x.channel = { accountId: x.channel.accountId || S.accounts[0]?.id || "", jid: "", kind: x.channel.kind || "chat" }), () => repaintCustom(true));
    const [kind, accountId, ...jid] = v.split("|");
    set((x) => (x.channel = v ? { accountId, jid: jid.join("|"), kind } : { accountId: "", jid: "", kind: "" }), () => repaintCustom(false));
  });
  sel.classList.add("fc-channel-select");
  const customBox = h("div", { class: "fc-channel-custom" });
  const repaintCustom = (show) => {
    clear(customBox);
    if (!show) return;
    const ch = fc().channel;
    const jid = h("input", { class: "input mono", type: "text", value: ch.jid, placeholder: "pings-bot@salas.ejemplo.com", spellcheck: "false" });
    jid.addEventListener("input", () => set((x) => (x.channel = { ...x.channel, jid: jid.value.trim() })));
    const kind = select([["chat", t("Contacto (chat privado)")], ["groupchat", t("Sala")]], ch.kind || "chat", (v) => set((x) => (x.channel = { ...x.channel, kind: v })));
    const acc = S.accounts.length > 1 ? select(S.accounts.map((a) => [a.id, a.jid]), ch.accountId, (v) => set((x) => (x.channel = { ...x.channel, accountId: v }))) : null;
    customBox.append(h("div", { class: "row" }, jid, kind, acc));
  };
  repaintCustom(custom || sel.value === "other");
  return group(
    t("Canal del bot de pings"),
    field(t("Dónde se envía el ping"), sel, t("La sala o el contacto del bot de tu alianza. Solo se guarda en tu PC.")),
    customBox,
    !S.accounts.length ? h("p", { class: "muted small" }, t("Añade una cuenta para poder elegir sus salas y contactos.")) : null,
  );
}

// ---------- pestañas de la ventana ----------

function tabsGroup(repaint) {
  const f = fc();
  const move = (i, d) =>
    set((x) => {
      const tabs = [...x.tabs];
      [tabs[i], tabs[i + d]] = [tabs[i + d], tabs[i]];
      x.tabs = tabs;
    }, repaint);
  const rows = f.tabs.map((id, i) =>
    h(
      "div",
      { class: `fc-tabrow ${f.defaultTab === id ? "default" : ""}`, dataset: { tab: id } },
      h("span", { class: "fc-tabnum" }, String(i + 1)),
      h("span", { class: "fc-tabname" }, FC_TAB_LABELS[id]()),
      h("label", { class: "fc-tabdefault" }, h("input", { type: "radio", name: "fc-default-tab", checked: f.defaultTab === id, onchange: () => set((x) => (x.defaultTab = id), repaint) }), t("Se abre en esta")),
      moveButton("chevron-up", t("Subir"), i === 0, () => move(i, -1)),
      moveButton("chevron-down", t("Bajar"), i === f.tabs.length - 1, () => move(i, 1)),
    ),
  );
  return group(t("Pestañas de la ventana «Enviar ping»"), h("p", { class: "muted small" }, t("Cambia el orden con las flechas y elige con cuál se abre.")), h("div", { class: "fc-tabs" }, rows));
}

function moveButton(ic, title, disabled, onClick) {
  const b = iconButton(ic, title, onClick, "fc-move");
  b.disabled = disabled;
  return b;
}

// ---------- plantilla ----------

function templateGroup(repaint) {
  const tp = fc().template;
  const chips = FC_FIELDS.map(([id, label]) => {
    const on = tp.fields.includes(id);
    return h(
      "button",
      {
        class: `chip fc-field ${on ? "on" : "off"}`,
        type: "button",
        "aria-pressed": String(on),
        title: on ? t("Quitar este campo de la plantilla") : t("Añadir este campo a la plantilla"),
        onclick: () => set((x) => (x.template = { ...x.template, fields: FC_FIELDS.map(([k]) => k).filter((k) => (k === id ? !on : x.template.fields.includes(k))) }), repaint),
      },
      on ? null : "+ ",
      label(),
    );
  });
  const format = h("textarea", { class: "input mono fc-format", rows: 5, spellcheck: "false" });
  format.value = tp.format;
  format.addEventListener("input", () => set((x) => (x.template = { ...x.template, format: format.value })));
  const reset = h("button", { class: "btn small ghost", type: "button", onclick: () => set((x) => (x.template = { ...x.template, format: DEFAULT_FORMAT }), repaint) }, icon("history"), t("Volver al de serie"));
  reset.disabled = tp.format === DEFAULT_FORMAT;
  const sign = h("input", { class: "input", type: "text", value: tp.signAs, placeholder: "Bob FC", maxlength: 100 });
  sign.addEventListener("input", () => set((x) => (x.template = { ...x.template, signAs: sign.value })));
  const marks = FC_FIELDS.map(([, , m]) => m).join(" ");
  return group(
    t("Plantilla"),
    field(t("Campos"), h("div", { class: "fc-chips" }, chips), t("Pulsa para quitar o añadir.")),
    field(t("Formato del texto"), format, t("Cómo se monta el ping. Cada alianza tiene el suyo. Marcadores: {marks}", { marks })),
    h("div", { class: "row fc-format-actions" }, reset),
    field(t("Firmar como"), sign, t("Tu nombre de FC en el ping ({fc}).", { fc: "{fc}" })),
  );
}

// ---------- grupos de destino ----------

function groupsGroup(repaint) {
  const f = fc();
  const mode = f.groupMode;
  const modes = h(
    "div",
    { class: "fc-modes", role: "radiogroup", "aria-label": t("Cómo le dice tu bot a qué grupo va") },
    GROUP_MODES.map(([id, title, sub]) =>
      h(
        "label",
        { class: `fc-mode ${mode === id ? "sel" : ""}` },
        h("input", { type: "radio", name: "fc-group-mode", value: id, checked: mode === id, onchange: () => set((x) => (x.groupMode = id), repaint) }),
        h("span", {}, h("b", {}, title()), h("small", { class: "muted" }, sub())),
      ),
    ),
  );
  let lineField = null;
  if (mode === "line") {
    const line = h("input", { class: "input mono", type: "text", value: f.lineFormat, placeholder: "!ping {grupo}", spellcheck: "false", maxlength: 200 });
    line.addEventListener("input", () => set((x) => (x.lineFormat = line.value)));
    lineField = field(t("Formato de la línea"), line, t("Va en la primera línea del ping. {grupo} se cambia por el nombre del grupo.", { grupo: "{grupo}" }));
  }
  let webField = null;
  if (mode === "web") {
    const url = h("input", { class: "input mono", type: "url", value: f.webUrl, placeholder: "https://pings.ejemplo.com", spellcheck: "false", maxlength: 2000 });
    const err = h("span", { class: "field-hint fc-url-error", hidden: true }, t("Tiene que empezar por https:// o http://."));
    const check = () => {
      const v = url.value.trim();
      const ok = !v || webUrlOk(v);
      err.hidden = ok;
      url.classList.toggle("invalid", !ok);
      // Una dirección que no es web no se guarda: al enviar se abriría en el navegador.
      if (ok) set((x) => (x.webUrl = v));
    };
    url.addEventListener("input", check);
    webField = h("div", {}, field(t("Página de pings de tu alianza"), url, t("Al enviar, la app no manda nada por Jabber: copia el texto exacto, abre esta página en el navegador y tú eliges el grupo y lo pegas allí.")), err);
  }

  const rows = groupRows(f.groups, learnedGroups(pingsConv().messages));
  const save = (name, patch) => set((x) => (x.groups = upsertGroup(x.groups, name, patch)), repaint);
  const head = h(
    "div",
    { class: `fc-grow fc-ghead ${mode}` },
    h("span", {}, t("Grupo")),
    h("span", {}, t("De dónde sale")),
    mode === "address" ? h("span", {}, t("Dirección del grupo")) : null,
    h("span", {}, t("Botón")),
    h("span", {}, t("De serie")),
    h("span", {}),
  );
  const list = rows.map((r) => {
    const usable = groupUsable(r, mode);
    const origin = r.manual ? t("añadido a mano") : r.count === 1 ? t("visto en 1 ping") : t("visto en {n} pings", { n: r.count });
    let addr = null;
    if (mode === "address") {
      addr = h("input", { class: "input mono small", type: "text", value: r.address, placeholder: t("Sin dirección"), spellcheck: "false", "aria-label": t("Dirección de {g}", { g: r.name }) });
      // Al salir del campo: si se guardara con cada tecla, la fila se repintaría y se perdería el foco.
      addr.addEventListener("change", () => save(r.name, r.saved ? { address: addr.value.trim() } : { address: addr.value.trim(), button: true }));
    }
    const btn = h("input", { type: "checkbox", checked: usable, "aria-label": t("Botón de {g}", { g: r.name }), onchange: (e) => save(r.name, { button: e.target.checked }) });
    btn.disabled = mode === "address" && !r.address;
    const isDefault = sameGroup(f.defaultGroup, r.name) && !!f.defaultGroup;
    const def = h("input", {
      type: "radio",
      name: "fc-default-group",
      checked: isDefault && usable,
      "aria-label": t("{g} de serie", { g: r.name }),
      // Pulsar el que ya está marcado lo desmarca: ningún grupo de serie.
      onclick: () => set((x) => (x.defaultGroup = isDefault ? "" : r.name), repaint),
    });
    def.disabled = !usable;
    return h(
      "div",
      { class: `fc-grow ${mode} ${usable ? "" : "unused"}`, dataset: { group: r.name } },
      h("span", { class: "fc-gname mono" }, r.name),
      h("span", {}, h("span", { class: "fc-tag" }, origin)),
      addr,
      h("label", { class: "switch small" }, btn, h("span", { class: "slider" })),
      def,
      r.manual ? iconButton("trash-2", t("Quitar {g}", { g: r.name }), () => set((x) => ((x.groups = removeGroup(x.groups, r.name)), sameGroup(x.defaultGroup, r.name) && (x.defaultGroup = "")), repaint)) : h("span", {}),
    );
  });
  const add = h(
    "button",
    {
      class: "btn small fc-add-group",
      type: "button",
      onclick: async () => {
        const name = (await prompt({ title: t("Añadir un grupo a mano"), label: t("Nombre del grupo, tal como lo usa el bot"), placeholder: "supers", icon: "users" }))?.trim();
        if (!name) return;
        if (rows.some((r) => sameGroup(r.name, name))) return toast(t("El grupo {g} ya está en la lista.", { g: name }), { kind: "warn" });
        set((x) => (x.groups = [...x.groups, { name: name.slice(0, 80), address: "", button: true, manual: true }]), repaint);
      },
    },
    icon("plus"),
    t("Añadir un grupo a mano"),
  );
  return group(
    t("Grupos de destino"),
    h("p", { class: "muted small" }, t("Quién recibe cada grupo lo decide el servidor de tu alianza. La app aprende los grupos del pie de los pings que te llegan («… broadcast from bob to caps …») y tú eliges cuáles salen como botones.")),
    h("p", { class: "fc-subhead" }, t("Cómo le dice tu bot a qué grupo va (pregúntalo a tu FC)")),
    modes,
    lineField,
    webField,
    h("div", { class: "fc-groups" }, head, list.length ? list : h("p", { class: "muted small fc-nogroups" }, t("Aún no hay grupos: salen solos cuando te llegan pings, o añádelos a mano."))),
    h("div", { class: "row fc-groups-foot" }, add, mode === "address" ? h("span", { class: "muted small" }, t("Un grupo sin dirección no sale como botón.")) : null),
    mode === "web" ? null : advancedBlock(f),
  );
}

// Avanzado: para reconocer mejor la respuesta del bot. Vacío = lo de serie.
function advancedBlock(f) {
  const input = (key, placeholder) => {
    const el = h("input", { class: "input mono", type: "text", value: f[key], placeholder, spellcheck: "false", maxlength: key === "botNick" ? 100 : 300 });
    el.addEventListener("input", () => set((x) => (x[key] = key === "botNick" ? el.value.trim() : el.value)));
    return el;
  };
  const box = h(
    "details",
    { class: "fc-advanced", open: advancedOpen },
    h("summary", {}, t("Avanzado")),
    field(t("Apodo del bot en la sala"), input("botNick", "pingbot"), t("Solo si el canal del bot es una sala: así se sabe qué mensaje es su respuesta. Sin él, en una sala el ping sale como «sin confirmar».")),
    field(t("Texto que indica que se ha enviado"), input("sentPattern", "Broadcast sent"), t("Si tu bot contesta con algo propio. Vacío: se reconocen «sent», «delivered»… Admite /expresión/i.")),
    field(t("Texto que indica que se ha rechazado"), input("rejectedPattern", "/not allowed/i"), t("Vacío: se reconocen «denied», «not allowed», «no permission»…")),
  );
  box.addEventListener("toggle", () => (advancedOpen = box.open));
  return box;
}

// ---------- seguridad ----------

function safetyGroup(repaint) {
  const f = fc();
  return group(
    t("Seguridad"),
    toggle(f.confirm, (v) => set((x) => (x.confirm = v), repaint), t("Pedir confirmación antes de enviar"), t("Enseña el texto final y a qué canal va.")),
    toggle(f.confirmMulti, (v) => set((x) => (x.confirmMulti = v), repaint), t("Avisar antes de enviar a más de un grupo a la vez"), t("Cada grupo recibe su propio ping.")),
  );
}

export const fcTabs = { fc: fcTab };
