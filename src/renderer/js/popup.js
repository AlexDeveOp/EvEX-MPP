import { t } from "./i18n.js";
// Contenido de una burbuja de notificación. Los datos llegan ya preparados desde la ventana principal.
const id = new URLSearchParams(location.search).get("id");
const call = (ch, ...a) => window.evex.call(ch, ...a);
const card = document.getElementById("card");

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// La sirena de los pings (la misma que en la app), en blanco. Si el color de aviso del tema es claro (Nord, Dracula…),
// la insignia se oscurece lo justo para que el blanco se lea (4,5:1) sin perder el tono.
const SIREN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"/><path d="M21 12h1"/><path d="M18.5 4.5 18 5"/><path d="M2 12h1"/><path d="M12 2v1"/><path d="m4.929 4.929.707.707"/><path d="M12 12v6"/></svg>';
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function sirenBadge(bg) {
  const b = el("div", "badge");
  b.innerHTML = SIREN;
  b.style.color = "#fff";
  if (!/^#[0-9a-f]{6}$/i.test(bg || "")) bg = "#f59e0b";
  const rgb = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
  let k = 0;
  const shade = () => "#" + rgb.map((v) => Math.round(v * (1 - k)).toString(16).padStart(2, "0")).join("");
  while (k < 0.9 && 1.05 / (luminance(shade()) + 0.05) < 4.5) k += 0.02;
  b.style.background = shade();
  return b;
}

async function init() {
  const d = await call("popup:get", id);
  if (!d) return;
  for (const [k, v] of Object.entries(d.colors || {})) document.documentElement.style.setProperty(`--${k}`, v);
  card.classList.add(d.kind === "ping" ? "ping" : "msg", (d.corner || "").startsWith("top") ? "in-top" : "in-bottom");
  // Aviso de una regla por palabra clave: su color y su nombre en la cabecera.
  if (/^#[0-9a-f]{6}$/i.test(d.accent || "")) {
    card.classList.add("rule");
    card.style.setProperty("--accent", d.accent);
  }

  const head = el("div", "head");
  head.append(d.kind === "ping" ? sirenBadge(d.accent || d.colors?.warn) : el("div", "badge", "✉"), el("div", "title", d.title));
  if (d.tag) head.append(el("span", "tag", d.tag));
  head.append(el("span", "app", d.kind === "ping" ? t("PING DE FLOTA") : "EvEX-MPP"));
  const close = el("button", "close", "✕");
  close.title = t("Cerrar");
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    call("popup:close", id);
  });
  head.append(close);

  const body = el("div", "body");
  if (d.text) body.append(el("div", "", d.text));
  if (d.fields?.length) {
    const dl = el("dl", "fields");
    for (const f of d.fields) dl.append(el("dt", "", f.key), el("dd", "", f.value));
    body.append(dl);
  }
  if (d.time) {
    const row = el("div", "time");
    row.append(el("span", "", "🕒"));
    if (d.time.local) row.append(el("span", "", t("{local} local", { local: d.time.local })));
    if (d.time.eve) row.append(el("span", "eve", t("{eve} EVE", { eve: d.time.eve })));
    body.append(row);
  }
  if (d.footer) body.append(el("div", "foot", d.footer));
  card.append(head, body);

  card.addEventListener("click", () => call("popup:click", id));
  card.addEventListener("mouseenter", () => call("popup:hover", id, true));
  card.addEventListener("mouseleave", () => call("popup:hover", id, false));
  requestAnimationFrame(() => call("popup:size", id, card.getBoundingClientRect().height + 4));
}

window.evex.on("popup-close", () => card.classList.add("out"));
init();
