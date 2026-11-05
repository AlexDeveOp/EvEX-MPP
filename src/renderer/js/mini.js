// Contenido de la mini ventana para jugar. Los datos llegan ya preparados desde la ventana principal (mini-feed.js);
// aquí solo se pintan y se actualiza la cuenta atrás cada segundo.
import { t } from "./i18n.js";
import { countdownText, timeAgo } from "./countdown.js";

const call = (ch, ...a) => window.evex.call(ch, ...a);
const root = document.getElementById("mini");
let state = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function count(cls, n, title, target) {
  const c = el("span", `count ${cls}${n ? "" : " zero"}`, String(n));
  c.title = title;
  c.addEventListener("click", (e) => {
    e.stopPropagation();
    call("mini:click", target).catch(() => {});
  });
  return c;
}

function formupLine(f, now) {
  const c = countdownText(f.at, now, { eveDateTime: () => f.eveDateTime, eve: () => f.eve });
  if (c.state === "old") return null;
  const line = el("div", "formup");
  line.dataset.state = c.state;
  line.append(el("span", "cd", c.text), el("span", "when", f.local ? `${f.eve} EVE · ${f.local}` : `${f.eve} EVE`));
  return line;
}

function paint() {
  const now = Date.now();
  const s = state;
  root.replaceChildren();
  if (!s) {
    root.append(el("div", "bar", "EvEX-MPP"), el("div", "body muted", t("Cargando…")));
    return;
  }
  for (const [k, v] of Object.entries(s.colors || {})) if (v) document.documentElement.style.setProperty(`--${k}`, v);
  root.classList.toggle("through", !!s.clickThrough);
  root.classList.toggle("empty", !s.ping);

  const bar = el("div", "bar");
  bar.append(el("span", "name", "EvEX-MPP"));
  bar.append(count("pings", s.pings || 0, t("Pings sin ver"), { accountId: null, conv: "*", convType: "pings" }));
  if (s.mentions != null) bar.append(count("mentions", s.mentions, t("Menciones"), { show: true }));
  bar.append(count("unread", s.unread || 0, t("Mensajes sin leer"), { show: true }));

  const body = el("div", "body");
  body.title = s.clickThrough ? t("Los clics pasan al juego. Cámbialo desde la bandeja o en Preferencias → Pings de flota.") : t("Abrir los pings de flota");
  if (s.ping) {
    body.append(el("div", "title", s.ping.title || t("(ping sin título)")));
    const meta = el("div", "meta");
    if (s.ping.group) meta.append(el("span", "group", s.ping.group));
    meta.append(el("span", "ago", timeAgo(s.ping.ts, now)));
    body.append(meta);
  } else body.append(el("div", "muted", t("Sin pings todavía")));
  const f = s.formup && formupLine(s.formup, now);
  if (f) body.append(f);
  body.addEventListener("click", () => call("mini:click", { accountId: null, conv: "*", convType: "pings" }).catch(() => {}));
  root.append(bar, body);
}

window.evex.on("mini-state", (s) => {
  state = s;
  paint();
});
call("mini:get")
  .then((s) => {
    if (s) state = s;
    paint();
  })
  .catch(() => paint());
// La cuenta atrás y el «hace X min» cambian solos.
setInterval(() => state && paint(), 1000);
