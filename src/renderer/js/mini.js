// Contenido de la mini ventana para jugar. Los datos llegan ya preparados desde la ventana principal (mini-feed.js).
// Los elementos se crean una sola vez y después solo cambian sus textos: rehacerlos podía perder un clic si llegaban
// datos (o el tic de cada segundo) entre pulsar y soltar.
import { t, currentLang } from "./i18n.js";
import { fleetCountdown, timeAgo } from "./countdown.js";

const call = (ch, ...a) => window.evex.call(ch, ...a);
const root = document.getElementById("mini");
let state = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const open = (target) => call("mini:click", target).catch(() => {});

function counter(cls, title, target) {
  const c = el("span", `count ${cls} zero`, "0");
  c.title = title;
  c.addEventListener("click", (e) => {
    e.stopPropagation();
    open(target);
  });
  return c;
}

// ---------- estructura (una vez) ----------

const ui = {
  pings: counter("pings", t("Pings sin ver"), { convType: "pings" }),
  mentions: counter("mentions", t("Menciones"), { convType: "mentions" }),
  unread: counter("unread", t("Mensajes sin leer"), { show: true }),
  title: el("div", "title"),
  group: el("span", "group"),
  ago: el("span", "ago"),
  empty: el("div", "muted", t("Cargando…")),
  fleetsHead: el("div", "fleets-head", t("Próximas flotas")),
  fleets: [0, 1, 2].map(() => {
    const row = el("div", "fleet");
    const when = el("span", "when");
    const title = el("span", "ftitle");
    const chip = el("span", "chip");
    row.append(when, title, chip);
    row.hidden = true;
    return { row, when, title, chip };
  }),
};
const bar = el("div", "bar");
bar.append(el("span", "name", "EvEX-MPP"), ui.pings, ui.mentions, ui.unread);
const meta = el("div", "meta");
meta.append(ui.group, ui.ago);
const body = el("div", "body");
body.append(ui.title, meta, ui.empty, ui.fleetsHead, ...ui.fleets.map((f) => f.row));
body.addEventListener("click", () => open({ convType: "pings" }));
root.append(bar, body);
ui.fleetsHead.hidden = true;
ui.title.hidden = meta.hidden = true;

function setCount(c, n) {
  const text = String(n || 0);
  if (c.textContent !== text) c.textContent = text;
  c.classList.toggle("zero", !n);
}

// ---------- datos ----------

function tick() {
  if (!state) return;
  const now = Date.now();
  if (state.ping) ui.ago.textContent = timeAgo(state.ping.ts, now);
  // La primera flota lleva la cuenta atrás (si está activada); las demás, su grupo. Una flota que empezó hace más de
  // 15 min se oculta sin esperar a los datos siguientes.
  const fleets = (state.fleets || []).filter((f) => now - f.at <= 15 * 60e3);
  ui.fleetsHead.hidden = !fleets.length;
  ui.fleets.forEach((r, i) => {
    const f = fleets[i];
    r.row.hidden = !f;
    if (!f) return;
    r.row.classList.toggle("manual", !!f.manual);
    r.when.textContent = f.when;
    r.title.textContent = f.title || t("(flota sin título)");
    const cd = i === 0 && state.countdown ? fleetCountdown(f.at, now) : "";
    r.chip.textContent = cd || f.group || (f.manual ? t("a mano") : "");
    r.chip.className = `chip ${cd ? "cd" : f.group ? "group" : "plain"}`;
    r.chip.hidden = !r.chip.textContent;
    r.row.dataset.now = String(f.at <= now);
  });
}

function update(s) {
  if (!s) return;
  // Al cambiar el idioma en la app, la mini se recarga con el nuevo (se guarda en localStorage, que es compartido).
  if (s.lang && s.lang !== currentLang()) return location.reload();
  state = s;
  for (const [k, v] of Object.entries(s.colors || {})) if (v) document.documentElement.style.setProperty(`--${k}`, v);
  document.body.classList.toggle("through", !!s.clickThrough);
  root.classList.toggle("through", !!s.clickThrough);
  root.classList.toggle("empty", !s.ping);
  root.classList.toggle("has-fleets", !!s.fleets?.length);
  setCount(ui.pings, s.pings);
  setCount(ui.mentions, s.mentions);
  setCount(ui.unread, s.unread);
  body.title = s.clickThrough ? t("Los clics pasan al juego. Cámbialo en Preferencias → Pings de flota.") : t("Abrir los pings de flota");
  ui.title.hidden = meta.hidden = !s.ping;
  ui.empty.hidden = !!s.ping;
  ui.empty.textContent = t("Sin pings todavía");
  if (s.ping) {
    ui.title.textContent = s.ping.title || t("(ping sin título)");
    ui.group.hidden = !s.ping.group;
    ui.group.textContent = s.ping.group || "";
  }
  tick();
}

window.evex.on("mini-state", update);
call("mini:get")
  .then(update)
  .catch(() => {});
setInterval(tick, 1000);
// Los datos los prepara la ventana principal: si se cerró (sin «cerrar a la bandeja») no llega nada. Pulsar la mini la
// vuelve a abrir, y con ella los datos.
setTimeout(() => {
  if (!state) ui.empty.textContent = t("Abre EvEX-MPP para ver los pings (pulsa aquí)");
}, 3000);

// ---------- asa para cambiar el tamaño ----------

// Esquina de abajo a la derecha. El tamaño se pide al proceso principal, como mucho una vez por fotograma. El arrastre
// termina al soltar, al cancelarse el puntero o al perder la captura (p. ej. si otra ventana se la queda): sin eso, la
// ventana seguiría creciendo al pasar el ratón por encima.
const grip = el("div", "grip");
grip.title = t("Arrastra para cambiar el tamaño");
document.body.append(grip);
grip.addEventListener("click", (e) => e.stopPropagation());
grip.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  e.stopPropagation();
  grip.setPointerCapture(e.pointerId);
  const start = { x: e.screenX, y: e.screenY, width: window.innerWidth, height: window.innerHeight };
  let frame = 0;
  let last = null;
  const ends = ["pointerup", "pointercancel", "lostpointercapture"];
  function end() {
    cancelAnimationFrame(frame);
    frame = 0;
    last = null;
    grip.removeEventListener("pointermove", move);
    for (const n of ends) grip.removeEventListener(n, end);
  }
  function move(ev) {
    if (!ev.buttons) return end();
    last = { width: start.width + ev.screenX - start.x, height: start.height + ev.screenY - start.y };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (last) call("mini:resize", last).catch(() => {});
    });
  }
  grip.addEventListener("pointermove", move);
  for (const n of ends) grip.addEventListener(n, end);
});
