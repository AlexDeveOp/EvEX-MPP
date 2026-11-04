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
// Si el servidor no dice si la sala lo permite (changeSubject null), se ofrece y, si lo rechaza, se explica por qué.
export function canEditTopic(rs) {
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
  return t("Solo los moderadores pueden cambiarlo en esta sala");
}

// La configuración de la sala es cosa de sus propietarios.
export const canConfigureRoom = (rs) => !!rs?.joined && myRoomRights(rs).affiliation === "owner";

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
  const rows = form.fields.map((f) => ({ f, ui: formField(f) })).filter((r) => r.ui);
  modal({
    title: t("Configuración de {room}", { room: c.conv.split("@")[0] }),
    icon: "settings",
    wide: true,
    className: "room-config",
    body: h(
      "div",
      { class: "form-list" },
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
            await api("room:config-set", c.accountId, c.conv, form.fields, values);
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

