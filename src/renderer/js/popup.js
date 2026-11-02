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

async function init() {
  const d = await call("popup:get", id);
  if (!d) return;
  for (const [k, v] of Object.entries(d.colors || {})) document.documentElement.style.setProperty(`--${k}`, v);
  card.classList.add(d.kind === "ping" ? "ping" : "msg", (d.corner || "").startsWith("top") ? "in-top" : "in-bottom");

  const head = el("div", "head");
  head.append(el("div", "badge", d.kind === "ping" ? "!" : "✉"), el("div", "title", d.title));
  head.append(el("span", "app", d.kind === "ping" ? "PING DE FLOTA" : "EvEX-MPP"));
  const close = el("button", "close", "✕");
  close.title = "Cerrar";
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
    const t = el("div", "time");
    t.append(el("span", "", "🕒"));
    if (d.time.local) t.append(el("span", "", `${d.time.local} local`));
    if (d.time.eve) t.append(el("span", "eve", `${d.time.eve} EVE`));
    body.append(t);
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
