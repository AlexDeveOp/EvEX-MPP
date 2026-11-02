// Utilidades de DOM: creación de elementos, iconos, menús contextuales, modales y avisos.
import { ICONS } from "./data/icons.js";

import { t } from "./i18n.js";
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith("--")) el.style.setProperty(prop, val);
        else el.style[prop] = val;
      }
    }
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function icon(name, cls = "") {
  const span = document.createElement("span");
  span.className = `icon ${cls}`;
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.circle}</svg>`;
  return span;
}

export function iconButton(name, title, onClick, cls = "") {
  return h("button", { class: `icon-btn ${cls}`, title, "aria-label": title, type: "button", onclick: onClick }, icon(name));
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

// Vacía el elemento y añade los hijos, ignorando null/false (el append nativo escribiría "null").
export function fill(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

// Imágenes de vista previa que no cargan: quitar el recuadro.
document.addEventListener(
  "error",
  (e) => {
    if (e.target instanceof HTMLImageElement && e.target.closest(".preview")) e.target.closest(".preview").remove();
  },
  true,
);

// ---------- menú contextual ----------

let menuEl = null;
export function closeMenu() {
  menuEl?.remove();
  menuEl = null;
}

export function showMenu(x, y, items) {
  closeMenu();
  const root = $("#menu-root");
  menuEl = h("div", { class: "ctx-menu", role: "menu" });
  for (const it of items) {
    if (!it) continue;
    if (it === "-") {
      menuEl.append(h("div", { class: "ctx-sep" }));
      continue;
    }
    if (it.header) {
      menuEl.append(h("div", { class: "ctx-header" }, it.header));
      continue;
    }
    const btn = h(
      "button",
      {
        class: `ctx-item ${it.danger ? "danger" : ""} ${it.checked ? "checked" : ""}`,
        role: "menuitem",
        disabled: it.disabled,
        onclick: (e) => {
          e.stopPropagation();
          closeMenu();
          it.action?.();
        },
      },
      it.icon ? icon(it.icon) : h("span", { class: "icon" }),
      h("span", { class: "ctx-label" }, it.label),
      it.checked ? icon("check", "ctx-check") : null,
      it.hint ? h("span", { class: "ctx-hint" }, it.hint) : null,
    );
    menuEl.append(btn);
  }
  root.append(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menuEl.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
}

export function menuFor(el, items) {
  const r = el.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, typeof items === "function" ? items() : items);
}

document.addEventListener("pointerdown", (e) => {
  if (menuEl && !menuEl.contains(e.target)) closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});
window.addEventListener("blur", closeMenu);

// ---------- modales ----------

const modalStack = [];

export function modal({ title, icon: ic, body, actions = [], wide, onClose, className = "" }) {
  const root = $("#modal-root");
  const close = () => {
    overlay.classList.add("closing");
    setTimeout(() => overlay.remove(), 140);
    const i = modalStack.indexOf(api);
    if (i >= 0) modalStack.splice(i, 1);
    onClose?.();
  };
  const footer = actions.length
    ? h(
        "footer",
        { class: "modal-footer" },
        actions.map((a) =>
          a === "spacer"
            ? h("span", { class: "spacer" })
            : h("button", { class: `btn ${a.primary ? "primary" : ""} ${a.danger ? "danger" : ""}`, type: "button", onclick: () => a.action?.(close) }, a.icon ? icon(a.icon) : null, a.label),
        ),
      )
    : null;
  const dialog = h(
    "div",
    { class: `modal ${wide ? "wide" : ""} ${className}`, role: "dialog", "aria-modal": "true" },
    h("header", { class: "modal-header" }, ic ? icon(ic) : null, h("h2", {}, title), iconButton("x", t("Cerrar"), close, "modal-close")),
    h("div", { class: "modal-body" }, body),
    footer,
  );
  const overlay = h("div", { class: "modal-overlay", onmousedown: (e) => e.target === overlay && close() }, dialog);
  root.append(overlay);
  const api = { close, el: dialog, body: dialog.querySelector(".modal-body"), footer };
  modalStack.push(api);
  setTimeout(() => dialog.querySelector("[autofocus], input:not([type=checkbox]):not([type=color]), select, textarea")?.focus(), 30);
  return api;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modalStack.length && !menuEl) modalStack[modalStack.length - 1].close();
});

export function prompt({ title, label, value = "", placeholder = "", type = "text", okLabel = t("Aceptar"), icon: ic }) {
  return new Promise((resolve) => {
    let done = false;
    const input = h("input", { class: "input", type, value, placeholder, autofocus: true });
    const finish = (v, close) => {
      done = true;
      resolve(v);
      close();
    };
    const m = modal({
      title,
      icon: ic,
      body: h("label", { class: "field" }, label ? h("span", { class: "field-label" }, label) : null, input),
      actions: ["spacer", { label: t("Cancelar"), action: (c) => finish(null, c) }, { label: okLabel, primary: true, action: (c) => finish(input.value, c) }],
      onClose: () => !done && resolve(null),
    });
    input.addEventListener("keydown", (e) => e.key === "Enter" && finish(input.value, m.close));
  });
}

export function confirmDialog({ title, message, okLabel = t("Aceptar"), danger }) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title,
      body: h("p", { class: "muted" }, message),
      actions: [
        "spacer",
        { label: t("Cancelar"), action: (c) => ((done = true), resolve(false), c()) },
        { label: okLabel, primary: !danger, danger, action: (c) => ((done = true), resolve(true), c()) },
      ],
      onClose: () => !done && resolve(false),
    });
  });
}

// ---------- avisos ----------

export function toast(message, { kind = "info", timeout = 5000, actions = [], icon: ic } = {}) {
  const root = $("#toast-root");
  const el = h(
    "div",
    { class: `toast ${kind}` },
    icon(ic || { info: "info", ok: "check", error: "triangle-alert", warn: "triangle-alert", ping: "siren" }[kind] || "info"),
    h("div", { class: "toast-msg" }, message),
    actions.map((a) => h("button", { class: `btn small ${a.primary ? "primary" : ""}`, onclick: () => (a.action(), dismiss()) }, a.label)),
    iconButton("x", t("Cerrar"), () => dismiss(), "toast-close"),
  );
  const dismiss = () => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 200);
  };
  root.append(el);
  if (timeout) setTimeout(dismiss, timeout);
  return dismiss;
}

// ---------- formularios ----------

export function field(label, control, hint) {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, hint ? h("span", { class: "field-hint" }, hint) : null);
}

export function toggle(checked, onChange, label, hint) {
  const input = h("input", { type: "checkbox", checked, onchange: (e) => onChange(e.target.checked) });
  return h("label", { class: "toggle-row" }, h("span", { class: "toggle-text" }, h("span", {}, label), hint ? h("small", { class: "muted" }, hint) : null), h("span", { class: "switch" }, input, h("span", { class: "slider" })));
}

export function select(options, value, onChange) {
  return h(
    "select",
    { class: "input", onchange: (e) => onChange(e.target.value) },
    options.map(([v, label]) => h("option", { value: v, selected: String(v) === String(value) }, label)),
  );
}

export function range(min, max, step, value, onInput, fmt = (v) => v) {
  const out = h("span", { class: "range-value" }, fmt(value));
  const input = h("input", {
    type: "range",
    min,
    max,
    step,
    value,
    oninput: (e) => {
      out.textContent = fmt(Number(e.target.value));
      onInput(Number(e.target.value));
    },
  });
  return h("div", { class: "range-row" }, input, out);
}

export function debounce(fn, ms) {
  let timer;
  return (...a) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...a), ms);
  };
}

// Mantiene la fila señalada al repintar una lista. Las filas nuevas no tienen :hover hasta que se mueve el ratón, y en
// listas que se repintan a menudo (presencias, número de personas) el color parpadeaba. Cada fila lleva data-key; la
// fila con la misma clave recibe .is-hover en cuanto se pinta. Devuelve la función que hay que llamar tras repintar.
export function keepHover(root, selector) {
  let key = null;
  const apply = () => {
    for (const el of root.querySelectorAll(".is-hover")) el.classList.remove("is-hover");
    if (key) for (const el of root.querySelectorAll(selector)) if (el.dataset.key === key) el.classList.add("is-hover");
  };
  root.addEventListener("mouseover", (e) => {
    const it = e.target.closest(selector);
    const k = it && root.contains(it) ? it.dataset.key || null : null;
    if (k !== key) {
      key = k;
      apply();
    }
  });
  root.addEventListener("mouseleave", () => {
    key = null;
    apply();
  });
  return apply;
}

export function rafThrottle(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
}
