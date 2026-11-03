// Preferencias → Red y proxy, y el editor de proxy que comparten esta pestaña y la ficha de cada cuenta.
// Los datos y las IPC (account:save con proxy y proxyPassword, proxy:password, proxy:test) los resuelve el proceso
// principal; aquí solo se editan. Las contraseñas de proxy van cifradas como las de las cuentas (nunca en settings).
import { S, api } from "../state.js";
import { h, icon, iconButton, field, toggle, select, toast } from "../dom.js";
import { t } from "../i18n.js";
import { noKeyring, passwordStoreHint } from "../system.js";
import { look, group } from "./common.js";

export const PROXY_TYPES = [
  ["socks5", "SOCKS5"],
  ["http", "HTTP"],
  ["https", t("HTTPS (conexión cifrada con el proxy)")],
];
export const DEFAULT_PORTS = { socks5: 1080, http: 8080, https: 443 };
export const PROXY_DEFAULTS = { type: "socks5", host: "", port: 1080, username: "" };

// Campos de un proxy: tipo, servidor, puerto, usuario, contraseña (con ojo) y «Probar».
// - value: { type, host, port, username }, se modifica en el sitio y se avisa con onChange(value).
// - hasPassword: si ya hay una contraseña guardada (el campo lo dice en el placeholder y se puede borrar).
// - testTarget: { accountId } o { global: true }, para que el proceso principal use la guardada si no se escribe otra.
// Devuelve { el, password() }: password() da undefined (no tocar), "" (borrar) o el texto escrito.
export function proxyFields({ value, hasPassword, onChange = () => {}, testTarget = {} }) {
  // El puerto sigue al tipo mientras el usuario no lo haya cambiado a mano.
  let portTouched = Number(value.port) !== DEFAULT_PORTS[value.type || "socks5"];
  let clearSaved = false;
  const changed = () => onChange(value);

  const host = h("input", { class: "input", placeholder: "proxy.ejemplo.com", value: value.host || "", oninput: (e) => ((value.host = e.target.value.trim()), changed()) });
  const port = h("input", { class: "input", type: "number", min: 1, max: 65535, value: value.port || DEFAULT_PORTS[value.type || "socks5"] });
  port.addEventListener("input", () => {
    portTouched = true;
    value.port = Number(port.value) || 0;
    changed();
  });
  const type = select(PROXY_TYPES, value.type || "socks5", (v) => {
    value.type = v;
    if (!portTouched) {
      value.port = DEFAULT_PORTS[v];
      port.value = value.port;
    }
    changed();
  });
  const user = h("input", { class: "input", placeholder: t("Opcional"), value: value.username || "", autocomplete: "off", oninput: (e) => ((value.username = e.target.value.trim()), changed()) });

  const pass = h("input", {
    class: "input",
    type: "password",
    autocomplete: "new-password",
    disabled: noKeyring(),
    placeholder: noKeyring() ? t("No se puede guardar sin llavero") : hasPassword ? t("•••••••• (guardada — escribe para cambiarla)") : t("Opcional"),
  });
  pass.addEventListener("input", () => (clearSaved = false));
  const eye = iconButton("eye", t("Mostrar"), () => (pass.type = pass.type === "password" ? "text" : "password"));
  const forget = hasPassword
    ? iconButton("trash-2", t("Olvidar la contraseña guardada"), () => {
        clearSaved = true;
        pass.value = "";
        pass.placeholder = t("Se borrará al guardar");
      })
    : null;

  const status = h("span", { class: "proxy-status small" });
  const test = async (btn) => {
    if (!value.host) return showStatus("bad", t("Escribe el servidor del proxy"));
    btn.disabled = true;
    showStatus("", t("Probando…"));
    try {
      const r = await api("proxy:test", { proxy: { type: value.type, host: value.host, port: Number(value.port), username: value.username }, password: pass.value || undefined, ...testTarget });
      showStatus("good", t("Funciona ({ms} ms)", { ms: Math.round(r?.ms ?? 0) }));
    } catch (e) {
      showStatus("bad", e.message);
    } finally {
      btn.disabled = false;
    }
  };
  function showStatus(kind, text) {
    status.className = `proxy-status small ${kind}`;
    status.textContent = text;
  }
  const testBtn = h("button", { class: "btn", type: "button", onclick: (e) => test(e.currentTarget) }, icon("wifi"), t("Probar proxy"));

  const el = h(
    "div",
    { class: "proxy-fields" },
    h(
      "div",
      { class: "form grid2" },
      field(t("Tipo"), type),
      field(t("Puerto"), port),
      field(t("Servidor del proxy"), host),
      field(t("Usuario"), user),
      field(t("Contraseña del proxy"), h("div", { class: "input-group" }, pass, eye, forget), noKeyring() ? passwordStoreHint() : null),
    ),
    h("div", { class: "row proxy-test" }, testBtn, status),
  );
  return {
    el,
    password: () => (noKeyring() ? undefined : pass.value ? pass.value : clearSaved ? "" : undefined),
  };
}

// Proxy general: en settings.proxy (sin contraseña); la contraseña, aparte con proxy:password.
export const globalProxy = () => ({ enabled: false, ...PROXY_DEFAULTS, ...(S.settings.proxy || {}) });

export function globalProxySummary() {
  const p = globalProxy();
  return p.enabled && p.host ? `${p.type.toUpperCase()} ${p.host}:${p.port}` : "";
}

export const networkTabs = {
  network() {
    const p = globalProxy();
    const save = (value) => look((x) => (x.proxy = { ...globalProxy(), ...value }));
    const body = h("div", { class: `proxy-options ${p.enabled ? "" : "off"}` });
    const fields = proxyFields({ value: { type: p.type, host: p.host, port: p.port, username: p.username }, hasPassword: !!S.system.hasProxyPassword, onChange: save, testTarget: { global: true } });
    const savePw = h(
      "button",
      {
        class: "btn",
        type: "button",
        disabled: noKeyring(),
        onclick: async () => {
          const pw = fields.password();
          if (pw === undefined) return toast(t("Escribe la contraseña del proxy, o usa la papelera para olvidar la guardada"), { kind: "info" });
          try {
            const r = await api("proxy:password", pw);
            S.system.hasProxyPassword = !!r?.hasProxyPassword;
            toast(pw ? t("Contraseña del proxy guardada") : t("Contraseña del proxy olvidada"), { kind: "ok", timeout: 2500 });
          } catch (e) {
            toast(e.message, { kind: "error" });
          }
        },
      },
      icon("key-round"),
      t("Guardar la contraseña"),
    );
    body.append(fields.el, h("div", { class: "row" }, savePw));
    return h(
      "div",
      {},
      group(
        t("Proxy general"),
        h("p", { class: "muted small" }, t("Se usa en las cuentas que tienen «Usar el proxy general» (la opción por defecto), en la comprobación de actualizaciones, en la búsqueda de GIFs, en los emojis que se descargan y en las vistas previas de enlaces.")),
        toggle(p.enabled, (v) => (save({ enabled: v }), body.classList.toggle("off", !v)), t("Usar un proxy"), t("SOCKS5, HTTP o HTTPS")),
        body,
        h(
          "p",
          { class: "proxy-note small" },
          icon("shield"),
          t("Si el proxy no responde, EvEX-MPP no se conecta directamente sin él: verás el error. La conexión con el servidor XMPP sigue cifrada de extremo a extremo con TLS, y el nombre del servidor se resuelve a través del proxy."),
        ),
      ),
    );
  },
};
