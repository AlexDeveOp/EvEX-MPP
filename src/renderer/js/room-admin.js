// Administración de salas desde la interfaz: permiso y cuadro para editar el tema, errores al cambiarlo
// y la ventana de configuración de la sala (formulario muc#owner del servidor).
import { S, api, roomState } from "./state.js";
import { h, iconButton, modal, toast, field, toggle, select } from "./dom.js";
import { systemMessage } from "./convs.js";
import { currentLang, t } from "./i18n.js";

// ---------- permisos ----------

// Nuestro rol y afiliación en la sala (pueden cambiar mientras estamos dentro: se miran en la lista de participantes).
export function myRoomRights(rs) {
  const me = rs?.occupants?.get(rs.nick);
  return { role: me?.role || rs?.role || "none", affiliation: me?.affiliation || rs?.affiliation || "none" };
}

// ¿Puedo cambiar el tema? Los moderadores siempre (XEP-0045); los participantes, si la sala lo permite.
// La etiqueta «editar» y el menú solo se ofrecen con permiso confirmado: si el servidor no dice si la sala
// lo permite (changeSubject null), no se muestran.
export function canEditTopic(rs) {
  if (!rs?.joined) return false;
  const { role } = myRoomRights(rs);
  if (role === "moderator") return true;
  if (role === "participant") return rs.changeSubject === true;
  return false;
}

// Para /topic basta con no saber que está prohibido: el comando se intenta y, si el servidor lo rechaza, se explica.
export function mayTryTopic(rs) {
  if (!rs?.joined) return false;
  const { role } = myRoomRights(rs);
  if (role === "moderator") return true;
  if (role === "participant") return rs.changeSubject !== false;
  return false;
}

// Motivo para el menú cuando no se puede cambiar el tema.
export function topicLockedReason(rs) {
  if (!rs?.joined) return t("No estás en la sala");
  const { role } = myRoomRights(rs);
  if (role === "visitor") return t("Los visitantes no pueden cambiarlo");
  if (role === "participant" && rs.changeSubject == null) return t("La sala no indica que los participantes puedan cambiarlo");
  return t("Solo los moderadores pueden cambiarlo en esta sala");
}

// La configuración de la sala es cosa de sus propietarios.
export const canConfigureRoom = (rs) => !!rs?.joined && myRoomRights(rs).affiliation === "owner";

const RANK = { none: 0, outcast: 0, member: 1, admin: 2, owner: 3 };

// Qué puedo cambiarle a un participante desde el clic derecho (XEP-0045):
// - moderador (rol, mientras siga en la sala): lo dan y quitan administradores y propietarios, no a otro administrador o propietario;
// - miembro: lo dan y quitan administradores y propietarios, a quien no tenga una afiliación mayor;
// - administrador y propietario: solo los propietarios.
// Devuelve [{ key, label, icon, opts, done }] con opts para «room:moderate».
export function occupantAdminActions(me, o) {
  if (!me || !o || o.self) return [];
  const mine = me.affiliation || "none";
  const theirs = o.affiliation || "none";
  const isAdmin = mine === "admin" || mine === "owner";
  const isOwner = mine === "owner";
  const out = [];
  if (isAdmin && RANK[theirs] < 2) {
    if (o.role === "moderator") out.push({ key: "unmod", label: t("Quitar moderador"), icon: "shield", opts: { nick: o.nick, role: "participant" }, done: t("{nick} ya no es moderador.", { nick: o.nick }) });
    else out.push({ key: "mod", label: t("Hacer moderador"), icon: "shield-check", opts: { nick: o.nick, role: "moderator" }, done: t("{nick} ahora es moderador.", { nick: o.nick }) });
  }
  if (!o.jid) return out; // en salas semianónimas no se conoce la dirección real: sin ella no hay afiliaciones
  const jid = o.jid.split("/")[0];
  if (isAdmin && RANK[theirs] <= 1) {
    if (theirs === "member") out.push({ key: "unmember", label: t("Quitar de miembros"), icon: "user-x", opts: { jid, affiliation: "none" }, done: t("{nick} ya no es miembro.", { nick: o.nick }) });
    else out.push({ key: "member", label: t("Hacer miembro"), icon: "user-plus", opts: { jid, affiliation: "member" }, done: t("{nick} ahora es miembro.", { nick: o.nick }) });
  }
  if (isOwner) {
    if (theirs === "admin") out.push({ key: "unadmin", label: t("Quitar administrador"), icon: "shield", opts: { jid, affiliation: "none" }, done: t("{nick} ya no es administrador.", { nick: o.nick }) });
    else if (theirs !== "owner") out.push({ key: "admin", label: t("Hacer administrador"), icon: "shield-check", opts: { jid, affiliation: "admin" }, done: t("{nick} ahora es administrador.", { nick: o.nick }) });
    if (theirs === "owner") out.push({ key: "unowner", label: t("Quitar propietario"), icon: "crown", opts: { jid, affiliation: "none" }, done: t("{nick} ya no es propietario.", { nick: o.nick }) });
    else out.push({ key: "owner", label: t("Hacer propietario"), icon: "crown", opts: { jid, affiliation: "owner" }, done: t("{nick} ahora es propietario.", { nick: o.nick }) });
  }
  return out;
}

// Aviso cuando cambian nuestros propios permisos en la sala (nos hacen moderador, administrador…). null si no cambia nada.
export function selfRightsText(before, after) {
  if (!before || !after) return null;
  const AFF = { owner: t("Ahora eres propietario de esta sala."), admin: t("Ahora eres administrador de esta sala."), member: t("Ahora eres miembro de esta sala.") };
  if (before.affiliation !== after.affiliation) {
    if (AFF[after.affiliation] && RANK[after.affiliation] > RANK[before.affiliation || "none"]) return AFF[after.affiliation];
    const LOST = { owner: t("Ya no eres propietario de esta sala."), admin: t("Ya no eres administrador de esta sala."), member: t("Ya no eres miembro de esta sala.") };
    return LOST[before.affiliation] || t("Han cambiado tus permisos en esta sala.");
  }
  if (before.role !== after.role) {
    if (after.role === "moderator") return t("Ahora eres moderador en esta sala.");
    if (before.role === "moderator") return t("Ya no eres moderador en esta sala.");
    if (after.role === "visitor") return t("Ahora eres visitante: no puedes escribir en esta sala.");
    if (before.role === "visitor") return t("Ya puedes escribir en esta sala.");
  }
  return null;
}

// Listas de permisos de la ventana de configuración. La «✕» quita a la persona de la lista del todo (afiliación
// «none»), no la baja a la lista siguiente.
export const AFFILIATION_LISTS = [
  { affiliation: "owner", title: () => t("Propietarios"), hint: () => t("Pueden cambiarlo todo, también la configuración y quién manda."), removeTo: "none" },
  { affiliation: "admin", title: () => t("Administradores"), hint: () => t("Entran como moderadores y gestionan miembros y vetos."), removeTo: "none" },
  { affiliation: "member", title: () => t("Miembros"), hint: () => t("Pueden entrar aunque la sala sea solo para miembros."), removeTo: "none" },
  { affiliation: "outcast", title: () => t("Vetados"), hint: () => t("No pueden entrar en la sala."), removeTo: "none" },
];

// ---------- cambiar el tema ----------

// Mensajes de cambio de tema enviados: si el servidor los rechaza, el error llega con su id («message-error»).
const pendingSubjects = new Map(); // id -> { accountId, room }

export async function setTopic(c, text) {
  const subject = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  const id = await api("room:subject", c.accountId, c.conv, subject);
  if (id) {
    pendingSubjects.set(id, { accountId: c.accountId, room: c.conv });
    setTimeout(() => pendingSubjects.delete(id), 60000);
  }
  return subject;
}

// Lo llama app.js con cada «message-error»: devuelve el texto si era un cambio de tema rechazado, o null.
export function topicErrorText(ev) {
  if (!ev?.id || !pendingSubjects.has(ev.id)) return null;
  pendingSubjects.delete(ev.id);
  if (ev.condition === "forbidden" || ev.condition === "not-allowed") return t("No tienes permiso para cambiar el tema de esta sala. Pídeselo a un moderador.");
  return t("No se ha podido cambiar el tema: {message}", { message: ev.message || ev.condition || "?" });
}

// Texto de la línea que avisa del cambio de tema.
export function topicChangedText(by, subject) {
  return subject ? t("{by} cambió el tema: {subject}", { by, subject }) : t("{by} quitó el tema de la sala.", { by });
}

// Cuadro desplegado bajo la cabecera con el tema actual: se edita o se pega uno nuevo entero.
// Enter acepta, Mayús+Enter añade una línea y Esc cancela. Vacío = quitar el tema.
export function openTopicEditor(c, p) {
  if (p.topicEditor) {
    p.topicEditor.querySelector("textarea")?.focus();
    return;
  }
  const rs = roomState(c.accountId, c.conv);
  const ta = h("textarea", { class: "topic-input", rows: 3, spellcheck: S.settings.behavior?.spellcheck !== false, "aria-label": t("Tema de la sala") });
  ta.value = rs.subject || "";
  const count = h("span", { class: "topic-count" });
  const updateCount = () => (count.textContent = t("{n} caracteres", { n: ta.value.trim().length }));
  const close = () => {
    box.remove();
    p.topicEditor = null;
    p.composer?.focus();
  };
  const accept = async () => {
    const text = ta.value;
    if (text.trim() === (rs.subject || "").trim()) return close();
    okBtn.disabled = true;
    try {
      await setTopic(c, text);
      close();
    } catch (e) {
      okBtn.disabled = false;
      systemMessage(c, t("No se ha podido cambiar el tema: {message}", { message: e.message }), { icon: "triangle-alert" });
    }
  };
  const okBtn = iconButton("check", t("Aceptar (Enter)"), accept, "topic-ok");
  const noBtn = iconButton("x", t("Cancelar (Esc)"), close, "topic-cancel");
  ta.addEventListener("input", updateCount);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      accept();
    }
  });
  const box = h(
    "div",
    { class: "topic-editor" },
    ta,
    h("div", { class: "topic-row" }, h("span", { class: "topic-hint" }, t("Enter acepta · Mayús+Enter salto de línea · Esc cancela · vacío = quitar el tema")), h("span", { class: "spacer" }), count, okBtn, noBtn),
  );
  p.topicEditor = box;
  p.header.after(box);
  updateCount();
  ta.focus();
  ta.select();
}

// ---------- configuración de la sala ----------

const HIDDEN_FIELDS = new Set(["FORM_TYPE"]);
const LIST_FIELDS = new Set(["muc#roomconfig_roomadmins", "muc#roomconfig_roomowners"]);

// Un campo del formulario del servidor (XEP-0004). Devuelve { el, value } (value: función o null) o null si no se muestra.
function formField(f) {
  if (f.type === "hidden" || HIDDEN_FIELDS.has(f.var)) return null;
  const label = f.label || f.var;
  const hint = f.desc || null;
  if (f.type === "fixed") return { el: h("p", { class: "muted small" }, f.values.join(" ")), value: null };
  if (f.type === "boolean") {
    let on = f.values[0] === "1" || f.values[0] === "true";
    return { el: toggle(on, (v) => (on = v), label, hint), value: () => on };
  }
  if (f.type === "list-single") {
    let v = f.values[0] ?? f.options[0]?.value ?? "";
    return { el: field(label, select(f.options.map((o) => [o.value, o.label]), v, (x) => (v = x)), hint), value: () => [v] };
  }
  if (f.type === "list-multi") {
    const chosen = new Set(f.values);
    const el = h("div", { class: "field" }, h("span", { class: "field-label" }, label), f.options.map((o) => toggle(chosen.has(o.value), (on) => (on ? chosen.add(o.value) : chosen.delete(o.value)), o.label)), hint ? h("span", { class: "field-hint" }, hint) : null);
    return { el, value: () => f.options.map((o) => o.value).filter((v) => chosen.has(v)) };
  }
  if (f.type === "text-multi" || f.type === "jid-multi") {
    const ta = h("textarea", { class: "input", rows: 3 });
    ta.value = f.values.join("\n");
    return { el: field(label, ta, hint), value: () => ta.value.split("\n").map((s) => s.trim()) };
  }
  const input = h("input", { class: "input", type: f.type === "text-private" ? "password" : "text", value: f.values[0] || "" });
  return { el: field(label, input, hint), value: () => [input.value] };
}

export async function openRoomConfig(c) {
  let form;
  try {
    form = await api("room:config-get", c.accountId, c.conv, currentLang());
  } catch (e) {
    systemMessage(c, t("No se ha podido abrir la configuración de la sala: {message}", { message: e.message }), { icon: "triangle-alert" });
    return;
  }
  if (!form?.fields?.length) {
    systemMessage(c, t("El servidor no ha enviado ninguna opción de configuración para esta sala."), { icon: "info" });
    return;
  }
  // Las listas de propietarios y administradores del formulario se gestionan en «Permisos»: si también se enviaran
  // al guardar, devolverían las listas a como estaban al abrir la ventana.
  const fields = form.fields.filter((f) => !LIST_FIELDS.has(f.var));
  const rows = fields.map((f) => ({ f, ui: formField(f) })).filter((r) => r.ui);
  const perms = h("div", { class: "perm-lists" }, h("p", { class: "muted small" }, t("Cargando…")));
  loadPermissions(c, perms);
  modal({
    title: t("Configuración de {room}", { room: c.conv.split("@")[0] }),
    icon: "settings",
    wide: true,
    className: "room-config",
    body: h(
      "div",
      { class: "form-list" },
      h("h3", { class: "form-section" }, t("Permisos")),
      h("p", { class: "muted small" }, t("Quién manda en la sala, aunque no esté dentro ahora. Estos cambios se aplican al momento, sin pulsar «Guardar».")),
      perms,
      h("h3", { class: "form-section" }, t("Opciones de la sala")),
      h("p", { class: "muted small" }, form.instructions || t("Opciones de la sala que da el servidor. Los nombres vienen del servidor y pueden estar en otro idioma.")),
      rows.map((r) => r.ui.el),
    ),
    actions: [
      "spacer",
      { label: t("Cancelar"), action: (close) => close() },
      {
        label: t("Guardar"),
        primary: true,
        icon: "check",
        action: async (close) => {
          const values = {};
          for (const { f, ui } of rows) if (ui.value) values[f.var] = ui.value();
          try {
            await api("room:config-set", c.accountId, c.conv, fields, values);
            close();
            systemMessage(c, t("Configuración de la sala guardada."), { icon: "check" });
          } catch (e) {
            toast(t("No se ha podido guardar la configuración: {message}", { message: e.message }), { kind: "error" });
          }
        },
      },
    ],
  });
}

// Apartado «Permisos»: las listas que guarda el servidor (propietarios, administradores, miembros y vetados),
// con «✕» para quitar a alguien y un campo para añadirlo por su dirección.
async function loadPermissions(c, box) {
  const lists = await Promise.all(
    AFFILIATION_LISTS.map((l) =>
      api("room:affiliations", c.accountId, c.conv, l.affiliation).then(
        (items) => ({ ...l, items }),
        (e) => ({ ...l, items: [], error: e.message }),
      ),
    ),
  );
  const apply = async (jid, affiliation, done) => {
    try {
      await api("room:moderate", c.accountId, c.conv, { jid, affiliation });
      systemMessage(c, done, { icon: "check" });
      loadPermissions(c, box);
    } catch (e) {
      toast(e.message, { kind: "error" });
    }
  };
  box.replaceChildren(
    ...lists.map((l) => {
      const input = h("input", { class: "input small", type: "text", placeholder: t("usuario@ejemplo.com"), "aria-label": t("Dirección para añadir a {list}", { list: l.title() }) });
      const add = () => {
        const jid = input.value.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+$/.test(jid)) return toast(t("Escribe una dirección como usuario@ejemplo.com"), { kind: "warn" });
        apply(jid, l.affiliation, t("{jid} añadido a «{list}».", { jid, list: l.title() }));
      };
      input.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), add()));
      return h(
        "section",
        { class: "perm-list", dataset: { affiliation: l.affiliation } },
        h("div", { class: "perm-head" }, h("strong", {}, l.title()), h("span", { class: "chip" }, String(l.items.length)), h("span", { class: "muted small" }, l.hint())),
        l.error
          ? h("p", { class: "muted small" }, l.error)
          : l.items.length
            ? h(
                "ul",
                {},
                l.items.map((it) =>
                  h(
                    "li",
                    {},
                    h("span", { class: "perm-jid" }, it.jid),
                    it.reason ? h("span", { class: "muted small" }, it.reason) : null,
                    iconButton("x", t("Quitar a {jid}", { jid: it.jid }), () => apply(it.jid, l.removeTo, t("{jid} quitado de «{list}».", { jid: it.jid, list: l.title() })), "perm-remove"),
                  ),
                ),
              )
            : h("p", { class: "muted small" }, t("Nadie.")),
        l.error ? null : h("div", { class: "perm-add" }, input, h("button", { class: "btn small", type: "button", onclick: add }, t("Añadir"))),
      );
    }),
  );
}
