// Modo FC: ventana «Enviar ping» con sus pestañas (Ping rápido, Plantilla, Pegar texto), la barra «Para», la
// confirmación y el resultado de cada grupo. La lógica sin DOM está en fc-compose.js; el envío, en fc-send.js /
// fc:send (proceso principal).
//
// El texto del ping va TAL CUAL: el pegado se envía con sus caracteres invisibles (opsec) y no se recorta; las marcas
// amarillas de los invisibles solo se pintan en el editor.
import { S, api, conn, account } from "./state.js";
import { h, icon, modal, clear, toast } from "./dom.js";
import { t } from "./i18n.js";
import { fmtTime } from "./format.js";
import { countdownText } from "./formup.js";
import { parsePing, pingCard } from "./pings.js";
import { parseFormup } from "./fleet-time.js";
import { pingsConv, openConv } from "./convs.js";
import { addFleet } from "./fleets.js";
import { openSettings } from "./settings.js";
import { FC_FIELDS, FC_TAB_LABELS } from "./settings/fc.js";
import * as fcc from "./fc-compose.js";

const TAB_ICONS = { quick: "zap", template: "file-text", paste: "clipboard-copy" };

const STATUS_LABELS = {
  sent: () => t("enviado"),
  delivered: () => t("entregado: te ha llegado tu copia"),
  accepted: () => t("no rechazado por el servidor"),
  rejected: () => t("el bot no lo ha aceptado"),
  error: () => t("no se ha podido enviar"),
  unconfirmed: () => t("sin confirmar"),
  copied: () => t("copiado"),
};
const STATUS_ICONS = { ok: "check", "ok-soft": "check-check", neutral: "circle-minus", error: "x", warn: "clock", info: "copy" };

const BLOCKERS = {
  empty: () => t("Escribe o pega el texto del ping."),
  "no-groups": () => t("Elige al menos un grupo en «Para»."),
  "no-url": () => t("Falta la página de pings de tu alianza (Preferencias → Modo FC)."),
  "no-account": () => t("Elige el canal del bot en Preferencias → Modo FC."),
  "no-channel": () => t("Falta el canal del bot (Preferencias → Modo FC)."),
  offline: () => t("La cuenta no está conectada."),
};

// Códigos de error de fc-send.js (buildPlan): llegan como texto «fc:<código>», a veces envuelto por la IPC. Si no es
// uno de ellos, se enseña el mensaje tal cual.
const SEND_ERRORS = {
  "no-address": () => t("Ese grupo no tiene dirección."),
  "no-bot": () => t("Falta el canal del bot (Preferencias → Modo FC)."),
  "unknown-mode": () => t("Modo de envío desconocido."),
  "not-jabber": () => t("Este modo no se envía por Jabber."),
  "no-text": () => t("Escribe o pega el texto del ping."),
  "no-groups": () => t("Elige al menos un grupo en «Para»."),
};
const sendError = (msg) => {
  const code = String(msg ?? "").match(/\bfc:([a-z-]+)\b/)?.[1];
  return code && SEND_ERRORS[code] ? SEND_ERRORS[code]() : msg || t("Error desconocido");
};

let open = null; // la ventana abierta (solo una a la vez)

export function openSendPing() {
  if (open) return;
  const fc = S.settings.fcMode;
  const state = {
    // Mientras «Ping rápido» sea solo un aviso (llega en el paso 3), se abre en la siguiente pestaña.
    tab: fc.defaultTab === "quick" ? fc.tabs.find((x) => x !== "quick") : fc.tabs.includes(fc.defaultTab) ? fc.defaultTab : fc.tabs[0],
    values: { type: "", time: fcc.hmIn(30), quick: 30, place: "", doctrine: "", comms: "", fc: fc.template.signAs || "", pap: "", notes: "" },
    paste: "",
    showInvisible: true,
    addToCalendar: true,
    groups: [],
    selected: new Set(),
    sending: false,
  };
  state.groups = fcc.barGroups(fc, pingsConv().messages);
  for (const g of fcc.initialGroups(state.groups, fc.defaultGroup)) state.selected.add(g);

  const tabsNav = h("nav", { class: "fc-wtabs", role: "tablist" });
  const panel = h("div", { class: "fc-wpanel" });
  const toBar = h("div", { class: "fc-to" });
  const where = h("span", { class: "fc-where" });
  const blocker = h("span", { class: "fc-blocker" });
  const sendBtn = h("button", { class: "btn primary fc-send-btn", type: "button", onclick: () => trySend() });
  const foot = h(
    "footer",
    { class: "fc-wfoot" },
    where,
    blocker,
    h("span", { class: "spacer" }),
    h("button", { class: "btn", type: "button", onclick: () => win.close() }, t("Cancelar")),
    sendBtn,
  );
  const body = h("div", { class: "fc-win" }, tabsNav, panel, toBar, foot);
  const win = modal({ title: t("Enviar ping"), icon: "megaphone", wide: true, className: "fc-send-modal", body, onClose: () => (open = null) });
  open = win;

  // ---------- texto que se enviaría ----------
  const currentText = () => {
    if (state.tab === "template") return fcc.templateText(fc.template.format, state.values, fc.template.fields);
    if (state.tab === "paste") return state.paste;
    return "";
  };
  const selectedGroups = () => state.groups.filter((g) => state.selected.has(g.name));
  const blockerKey = () =>
    state.tab === "quick" ? "quick" : fcc.sendBlocker(fc, { text: currentText(), groups: selectedGroups(), accounts: S.accounts, isOnline: (id) => conn(id).state === "online" });

  function paintFoot() {
    const key = blockerKey();
    sendBtn.hidden = state.tab === "quick";
    clear(sendBtn).append(icon(fc.groupMode === "web" ? "external-link" : "send"), state.sending ? t("Enviando…") : fc.groupMode === "web" ? t("Copiar y abrir la web") : t("Enviar ping"));
    sendBtn.disabled = !!key || state.sending;
    blocker.textContent = key && key !== "quick" && key !== "empty" ? BLOCKERS[key]?.() || "" : "";
    clear(where).append(...whereText(fc));
  }

  // ---------- pestañas ----------
  function paintTabs() {
    clear(tabsNav);
    for (const id of fc.tabs)
      tabsNav.append(
        h(
          "button",
          { class: `fc-wtab ${state.tab === id ? "sel" : ""}`, type: "button", role: "tab", "aria-selected": String(state.tab === id), dataset: { tab: id }, onclick: () => showTab(id) },
          icon(TAB_ICONS[id]),
          FC_TAB_LABELS[id](),
        ),
      );
  }
  function showTab(id) {
    state.tab = id;
    paintTabs();
    clear(panel);
    if (id === "quick") panel.append(quickPanel());
    else if (id === "template") panel.append(templatePanel());
    else panel.append(pastePanel());
    toBar.hidden = id === "quick";
    paintFoot();
  }

  // ---------- Ping rápido (paso 3) ----------
  function quickPanel() {
    return h(
      "div",
      { class: "fc-quick" },
      icon("zap", "fc-soon-icon"),
      h("p", {}, h("strong", {}, t("Los pings rápidos guardados llegan pronto"))),
      h("p", { class: "muted small" }, t("Podrás guardar un ping desde Plantilla o Pegar texto y enviarlo después con dos clics. De momento, usa una de esas pestañas.")),
      h("div", { class: "row" }, ...["template", "paste"].filter((x) => fc.tabs.includes(x)).map((x) => h("button", { class: "btn small", type: "button", onclick: () => showTab(x) }, icon(TAB_ICONS[x]), FC_TAB_LABELS[x]()))),
    );
  }

  // ---------- Plantilla ----------
  function templatePanel() {
    const on = (id) => fc.template.fields.includes(id);
    const label = (id) => FC_FIELDS.find(([k]) => k === id)?.[1]() || id;
    const preview = h("div", { class: "fc-preview" });
    const update = () => {
      paintPreview(preview, fcc.templateText(fc.template.format, state.values, fc.template.fields));
      paintFoot();
    };
    const input = (id, attrs = {}) => {
      const el = h("input", { class: "input", type: "text", value: state.values[id], spellcheck: "false", ...attrs });
      el.addEventListener("input", () => ((state.values[id] = el.value), update()));
      return el;
    };
    const form = h("div", { class: "fc-form" });
    if (on("type")) {
      const typeIn = input("type", { placeholder: t("Tipo de flota"), "aria-label": t("Tipo de flota") });
      const chips = h("div", { class: "fc-chips" });
      const paintChips = () =>
        clear(chips).append(
          ...fcc.FLEET_TYPES.map((x) =>
            h("button", { class: `chip fc-pick ${state.values.type === x ? "sel" : ""}`, type: "button", onclick: () => ((state.values.type = x), (typeIn.value = x), paintChips(), update()) }, x),
          ),
        );
      typeIn.addEventListener("input", paintChips);
      paintChips();
      form.append(h("div", { class: "fc-fld" }, h("span", { class: "fc-lab" }, label("type")), chips, typeIn));
    }
    if (on("time")) {
      const timeIn = h("input", { class: "input mono fc-time", type: "text", value: state.values.time, inputmode: "numeric", maxlength: 5, "aria-label": t("Hora EVE") });
      const hint = h("span", { class: "fc-time-hint muted small" });
      const quick = h("div", { class: "fc-chips" });
      const paintTime = () => {
        const at = fcc.formupAt(state.values.time);
        hint.textContent = at ? t("EVE · {local} en tu hora · {left}", { local: fmtTime(at), left: countdownText(at).text }) : t("Escribe la hora EVE, p. ej. 19:00");
        timeIn.classList.toggle("invalid", !at);
        clear(quick).append(
          ...fcc.QUICK_TIMES.map((m) =>
            h(
              "button",
              {
                class: `chip fc-pick ${state.values.quick === m ? "sel" : ""}`,
                type: "button",
                onclick: () => {
                  state.values.time = fcc.hmIn(m);
                  state.values.quick = m;
                  timeIn.value = state.values.time;
                  paintTime();
                  update();
                },
              },
              m === 0 ? t("Ya") : m < 60 ? t("+{n} min", { n: m }) : t("+{n} h", { n: m / 60 }),
            ),
          ),
        );
      };
      timeIn.addEventListener("input", () => {
        state.values.time = timeIn.value;
        state.values.quick = null;
        paintTime();
        update();
      });
      paintTime();
      form.append(h("div", { class: "fc-fld" }, h("span", { class: "fc-lab" }, label("time")), h("div", { class: "row fc-time-row" }, timeIn, hint), quick));
    }
    const grid = h("div", { class: "fc-grid" });
    for (const id of ["place", "doctrine", "comms", "fc", "pap"]) if (on(id)) grid.append(h("label", { class: "fc-fld" }, h("span", { class: "fc-lab" }, label(id)), input(id)));
    if (grid.children.length) form.append(grid);
    if (on("notes")) form.append(h("label", { class: "fc-fld" }, h("span", { class: "fc-lab" }, t("Notas (opcional)")), input("notes")));
    if (!form.children.length) form.append(h("p", { class: "muted small" }, t("La plantilla no tiene campos: actívalos en Preferencias → Modo FC.")));
    const edit = h(
      "button",
      {
        class: "btn small ghost fc-edit-text",
        type: "button",
        onclick: () => {
          state.paste = fcc.templateText(fc.template.format, state.values, fc.template.fields);
          showTab("paste");
        },
      },
      icon("pencil"),
      t("Editar el texto antes de enviar"),
    );
    edit.hidden = !fc.tabs.includes("paste");
    update();
    return h("div", { class: "fc-split" }, form, h("div", { class: "fc-side" }, preview, edit));
  }

  // «Así lo verán» (la tarjeta de la vista de pings, sin botones) y el texto exacto.
  function paintPreview(box, text) {
    clear(box);
    box.append(h("span", { class: "fc-lab" }, t("Así lo verán")));
    if (text) {
      const card = pingCard({ key: "fc-preview", ts: Date.now(), body: text, nick: fc.template.signAs || account(fcc.sendAccount(fc, S.accounts)?.id)?.alias || "" });
      card.querySelectorAll(".ping-foot button").forEach((b) => b.remove());
      card.inert = true;
      card.classList.add("fc-preview-card");
      box.append(card);
    } else box.append(h("p", { class: "muted small" }, t("Rellena los campos para ver el ping.")));
    box.append(h("span", { class: "fc-lab" }, t("Texto que se enviará")), h("pre", { class: "fc-text" }, text));
  }

  // ---------- Pegar texto ----------
  function pastePanel() {
    const area = h("textarea", { class: "fc-editor-input", spellcheck: "false", placeholder: t("Pega aquí el ping tal y como lo tienes"), "aria-label": t("Texto del ping") });
    area.value = state.paste;
    const backdrop = h("div", { class: "fc-editor-marks", "aria-hidden": "true" });
    const editor = h("div", { class: `fc-editor ${state.showInvisible ? "marks" : ""}` }, backdrop, area);
    const notice = h("div", { class: "fc-inv-notice" });
    const side = h("div", { class: "fc-understood" });
    const paintMarks = () => {
      clear(backdrop);
      for (const r of fcc.invisibleRuns(state.paste)) backdrop.append(r.inv ? h("span", { class: "fc-inv", dataset: { name: r.inv }, title: r.inv }, r.text) : r.text);
      // Un salto de línea final no ocupa sitio en un div: se añade un espacio para que cuadre con el textarea.
      backdrop.append(" ");
      backdrop.scrollTop = area.scrollTop;
    };
    const paintNotice = () => {
      const n = fcc.countInvisible(state.paste);
      clear(notice);
      notice.hidden = !state.paste;
      notice.classList.toggle("has", n > 0);
      notice.append(
        icon("shield"),
        h(
          "span",
          {},
          n
            ? (n === 1 ? t("1 carácter invisible.") : t("{n} caracteres invisibles.", { n })) + " " + t("Se envían tal cual: EvEX-MPP no quita ni cambia nada de lo que pegas. Las marcas amarillas solo se ven aquí.")
            : t("Se envía tal cual: EvEX-MPP no quita ni cambia nada de lo que pegas."),
        ),
      );
    };
    const update = () => {
      paintMarks();
      paintNotice();
      paintUnderstood(side);
      paintFoot();
    };
    area.addEventListener("input", () => ((state.paste = area.value), update()));
    area.addEventListener("scroll", () => (backdrop.scrollTop = area.scrollTop));
    const showInv = h("input", {
      type: "checkbox",
      checked: state.showInvisible,
      onchange: (e) => {
        state.showInvisible = e.target.checked;
        editor.classList.toggle("marks", state.showInvisible);
      },
    });
    update();
    setTimeout(() => area.focus(), 50);
    return h(
      "div",
      { class: "fc-split paste" },
      h("div", { class: "fc-paste-main" }, h("div", { class: "row fc-paste-head" }, h("span", { class: "fc-lab" }, t("Pega el ping tal y como lo tienes")), h("label", { class: "fc-check" }, showInv, t("Mostrar invisibles"))), editor, notice),
      side,
    );
  }

  // «Lo que entiende la app»: lo que lee parsePing (para el calendario y la cuenta atrás). No cambia el texto.
  function paintUnderstood(box) {
    clear(box);
    box.append(h("span", { class: "fc-lab" }, t("Lo que entiende la app")), h("p", { class: "muted small" }, t("Para tu calendario y la cuenta atrás. No cambia el texto.")));
    if (!state.paste.trim()) return;
    const p = parsePing(state.paste);
    const at = parseFormup(p, Date.now());
    const rows = [[t("Título"), p.title]];
    for (const f of p.fields) rows.push([f.key, f.value]);
    box.append(h("dl", { class: "fc-kv" }, rows.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])));
    box.append(
      at
        ? h("p", { class: "fc-ok small" }, icon("clock"), t("Formup: {eve} EVE ({left})", { eve: fcc.eveHM(at), left: countdownText(at).text }))
        : h("p", { class: "muted small" }, icon("clock"), t("No encuentro la hora del formup.")),
    );
    const cal = h("input", { type: "checkbox", checked: state.addToCalendar && !!at, onchange: (e) => (state.addToCalendar = e.target.checked) });
    cal.disabled = !at;
    box.append(h("label", { class: "fc-check fc-cal" }, cal, t("Añadirlo también a mi calendario")));
  }

  // ---------- barra «Para» ----------
  function paintTo() {
    clear(toBar);
    toBar.append(h("span", { class: "fc-to-label" }, t("Para")));
    if (!state.groups.length) {
      toBar.append(
        h("span", { class: "muted small" }, t("No hay grupos con botón.")),
        h("button", { class: "btn small ghost", type: "button", onclick: () => (win.close(), openSettings("fc")) }, t("Configurarlos en Preferencias")),
      );
      return;
    }
    for (const g of state.groups) {
      const sel = state.selected.has(g.name);
      toBar.append(
        h(
          "button",
          {
            class: `fc-to-btn ${sel ? "sel" : ""}`,
            type: "button",
            "aria-pressed": String(sel),
            title: g.address || "",
            onclick: () => {
              if (sel) state.selected.delete(g.name);
              else state.selected.add(g.name);
              paintTo();
              paintFoot();
            },
          },
          sel ? icon("check") : null,
          g.name,
        ),
      );
    }
    const n = state.selected.size;
    toBar.append(h("span", { class: "fc-to-count muted small" }, n === 0 ? t("Ningún grupo") : n === 1 ? t("1 grupo") : fc.groupMode === "web" ? t("{n} grupos", { n }) : t("{n} grupos · sale un ping a cada uno", { n })));
  }

  // ---------- enviar ----------
  async function trySend() {
    if (blockerKey() || state.sending) return;
    const text = currentText();
    const groups = selectedGroups();
    const at = state.tab === "template" ? fcc.formupAt(state.values.time) : parseFormup(parsePing(text), Date.now());
    if (fc.confirm || (fc.confirmMulti && groups.length > 1)) {
      if (!(await confirmSend(fc, text, groups, at))) return;
    }
    const startedAt = Date.now();
    let results;
    if (fc.groupMode === "web") {
      try {
        // Como el botón «Copiar» de los pings: el texto exacto, con sus invisibles.
        await navigator.clipboard.writeText(text);
      } catch (e) {
        return toast(t("No se ha podido copiar el texto: {e}", { e: e?.message || e }), { kind: "error" });
      }
      api("shell:open", fc.webUrl).catch(() => {});
      results = fcc.webResults(groups);
    } else {
      const acc = fcc.sendAccount(fc, S.accounts);
      state.sending = true;
      paintFoot();
      try {
        results = await api("fc:send", acc.id, fcc.buildRequest(fc, groups, text));
      } catch (e) {
        results = groups.map((g) => ({ group: g.name, status: "error", reason: sendError(e?.message), reply: null, echo: false }));
      } finally {
        state.sending = false;
        paintFoot();
      }
    }
    const sum = fcc.summarize(results);
    // Al calendario solo si ha salido hacia algún grupo (lo copiado para la web también cuenta). Si te llega tu copia
    // del ping, ese ping ya pone la flota en el calendario: no se añade otra.
    if (state.tab === "paste" && state.addToCalendar && at && sum.rejected < sum.total) addToCalendarUnlessEcho(text, at, groups, startedAt);
    showResults(fc, results, fcc.sendAccount(fc, S.accounts)?.id, () => {
      if (sum.allSent || sum.copied === sum.total) win.close();
    });
  }

  paintTo();
  showTab(state.tab);
}

// La copia puede llegar un poco después del resultado: se espera hasta 5 s antes de añadir la flota a mano.
async function addToCalendarUnlessEcho(text, at, groups, since) {
  const arrived = () => pingsConv().messages.some((m) => !m.out && m.ts >= since - 60e3 && String(m.body).startsWith(text));
  for (let i = 0; i < 10 && !arrived(); i++) await new Promise((r) => setTimeout(r, 500));
  if (arrived()) return;
  addFleet({ at, title: parsePing(text).title, group: groups.map((g) => g.name).join(", "), source: "manual" });
}

// «A # pings-bot» / «A la dirección de cada grupo» / «En la web de tu alianza».
function whereText(fc) {
  if (fc.groupMode === "web") return [t("En la web de tu alianza")];
  if (fc.groupMode === "address") return [t("A la dirección de cada grupo")];
  const ch = fc.channel;
  if (!ch.jid) return [];
  return [t("Canal:"), " ", h("span", { class: "mono fc-chan" }, channelName(ch))];
}

function channelName(ch) {
  if (ch.kind !== "groupchat") return ch.jid;
  const room = account(ch.accountId)?.rooms?.find((r) => r.jid === ch.jid);
  return `# ${room?.name || ch.jid}`;
}

function confirmSend(fc, text, groups, at) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v, close) => ((done = true), resolve(v), close());
    const dest =
      fc.groupMode === "web"
        ? t("Se copiará el texto y se abrirá la web de tu alianza; allí eliges el grupo y lo pegas.")
        : fc.groupMode === "address"
          ? t("Va a {groups}, a la dirección de cada grupo. El bot lo reenvía a todos los que tienen acceso, y un ping enviado no se puede retirar.", { groups: groups.map((g) => g.name).join(", ") })
          : t("Va a {chan} para {groups}. El bot lo reenvía a todos los que tienen acceso, y un ping enviado no se puede retirar.", { chan: channelName(fc.channel), groups: groups.map((g) => g.name).join(", ") });
    const notes = [];
    if (groups.length > 1 && fc.groupMode !== "web") notes.push(t("Sale un ping a cada uno de los {n} grupos.", { n: groups.length }));
    if (at) notes.push(t("Formup a las {eve} EVE, {left}", { eve: fcc.eveHM(at), left: countdownText(at).text }));
    modal({
      title: groups.length > 1 && fc.groupMode !== "web" ? t("¿Enviar este ping a {n} grupos?", { n: groups.length }) : t("¿Enviar este ping?"),
      icon: "megaphone",
      className: "fc-confirm",
      body: h("div", { class: "fc-confirm-body" }, h("p", { class: "muted" }, dest), h("pre", { class: "fc-text" }, text), notes.length ? h("ul", { class: "fc-notes" }, notes.map((n) => h("li", {}, icon("check"), n))) : null),
      actions: [
        "spacer",
        { label: t("Volver"), action: (c) => finish(false, c) },
        { label: fc.groupMode === "web" ? t("Copiar y abrir la web") : t("Enviar ahora"), icon: fc.groupMode === "web" ? "external-link" : "send", primary: true, action: (c) => finish(true, c) },
      ],
      onClose: () => !done && resolve(false),
    });
  });
}

function showResults(fc, results, accountId, onClose) {
  const sum = fcc.summarize(results);
  const title =
    fc.groupMode === "web"
      ? t("Texto copiado")
      : sum.allSent
        ? sum.total === 1
          ? t("Ping enviado")
          : t("Ping enviado a los {n} grupos", { n: sum.total })
        : t("Ping enviado a {sent} de {total} grupos", { sent: sum.sent, total: sum.total });
  const rows = results.map((r) => {
    const tone = fcc.statusTone(r.status);
    const label = (STATUS_LABELS[r.status] || STATUS_LABELS.unconfirmed)();
    const extra = [];
    if (r.status === "copied") extra.push(h("div", { class: "fc-res-help" }, t("Copiado. Elige el grupo {g} en la web de tu alianza y pégalo.", { g: r.group })));
    if (r.reply) extra.push(h("div", { class: "fc-res-quote" }, t("Respuesta del bot: {r}", { r: r.reply })));
    if (r.status === "rejected") {
      if (r.reason && r.reason !== r.reply) extra.push(h("div", { class: "fc-res-quote" }, r.reason));
      extra.push(h("div", { class: "fc-res-help" }, t("Normalmente es que tu cuenta no tiene permiso para enviar a este grupo en la aplicación de tu alianza. No es un fallo de EvEX-MPP.")));
    }
    if (r.status === "error") extra.push(h("div", { class: "fc-res-quote" }, r.reason || ""));
    if (r.status === "unconfirmed") extra.push(h("div", { class: "fc-res-help" }, t("El bot no ha contestado a tiempo. Puede haberse enviado o no: míralo antes de repetirlo.")));
    if (r.status === "accepted") extra.push(h("div", { class: "fc-res-help" }, t("El servidor no ha dado error, pero el bot no ha contestado: no se sabe si se ha enviado.")));
    return h(
      "div",
      { class: `fc-res ${tone}`, dataset: { group: r.group, status: r.status } },
      icon(STATUS_ICONS[tone] || "clock", "fc-res-icon"),
      h("div", { class: "fc-res-main" }, h("div", {}, h("span", { class: "mono fc-res-group" }, r.group), " · ", label), ...extra),
    );
  });
  modal({
    title,
    icon: sum.allSent || sum.copied === sum.total ? "check" : "triangle-alert",
    className: "fc-results",
    body: h(
      "div",
      { class: "fc-results-body" },
      rows,
      fc.groupMode === "web" ? null : h("p", { class: "muted small" }, t("Si el bot no responde a tiempo, el grupo sale como «sin confirmar», nunca como enviado.")),
    ),
    actions: [
      // La respuesta del bot se guarda en su chat privado (que no se abre solo): desde aquí se llega a él. Solo en el
      // modo «línea»: en el de «dirección» los errores los da el servicio, no hay chat con un bot.
      fc.groupMode === "line" && accountId && fc.channel.jid
        ? { label: t("Ver chat con el bot"), icon: "message-square", action: (c) => (c(), openConv(accountId, fc.channel.jid, fc.channel.kind === "groupchat" ? "groupchat" : "chat")) }
        : null,
      "spacer",
      { label: t("Cerrar"), primary: true, action: (c) => c() },
    ].filter(Boolean),
    onClose,
  });
}
