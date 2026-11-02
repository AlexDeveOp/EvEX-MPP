// Panel de GIFs: «Mis GIFs» (colección propia, sin servicios externos) y búsqueda opcional en GIPHY o KLIPY.
// Se envía siempre la URL del GIF; los clientes que la entienden (XEP-0066) lo muestran como imagen.
import { S, api, onMain, updateSettings } from "./state.js";
import { h, toast, debounce } from "./dom.js";
import { t } from "./i18n.js";

const PROVIDER_NAMES = { giphy: "GIPHY", klipy: "KLIPY" };
let panel = null;

const gifs = () => S.settings.gifs || { saved: [], provider: "none", keys: {}, rating: "pg-13" };

export function closeGifPicker() {
  panel?.remove();
  panel = null;
}

// Guarda un GIF en «Mis GIFs»: se descarga una copia solo para la miniatura; al enviarlo se manda su URL.
export async function saveGif(url) {
  if (gifs().saved.some((g) => g.url === url)) return toast(t("Ese GIF ya está en Mis GIFs"), { kind: "info" });
  try {
    const item = await api("gifs:save", url);
    updateSettings((s) => (s.gifs.saved = [{ ...item, addedAt: Date.now() }, ...s.gifs.saved].slice(0, 300)));
    toast(t("Guardado en Mis GIFs"), { kind: "ok" });
  } catch (err) {
    toast(err.message, { kind: "error", timeout: 8000 });
  }
}

async function removeGif(item) {
  updateSettings((s) => (s.gifs.saved = s.gifs.saved.filter((g) => g.url !== item.url)));
  api("gifs:remove", item.thumb).catch(() => {});
}

// Clic derecho → «Guardar en Mis GIFs» (lo envía el proceso principal).
onMain("gif-save", (url) => saveGif(url));

export function openGifPicker(anchor, onPick) {
  if (panel) return closeGifPicker();
  const g = gifs();
  const hasSearch = g.provider !== "none" && g.keys?.[g.provider];
  let tab = g.saved.length || !hasSearch ? "saved" : "search";
  const body = h("div", { class: "gif-body" });
  const tabs = h("div", { class: "gif-tabs" });
  const footer = h("div", { class: "gif-footer" });

  const pick = (url, ev) => {
    onPick(url);
    if (!ev.shiftKey) closeGifPicker();
  };

  function renderSaved() {
    const add = h("input", { class: "input", placeholder: t("Pega el enlace de un GIF para guardarlo…") });
    add.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && add.value.trim()) {
        saveGif(add.value.trim()).then(() => panel && render());
        add.value = "";
      }
    });
    const list = gifs().saved;
    const grid = h(
      "div",
      { class: "gif-grid" },
      list.map((item) =>
        h(
          "button",
          { class: "gif-cell", type: "button", title: item.url, onclick: (ev) => pick(item.url, ev) },
          h("img", { src: item.thumb || item.url, alt: "", loading: "lazy" }),
          h(
            "span",
            {
              class: "gif-remove",
              title: t("Quitar de Mis GIFs"),
              onclick: (ev) => {
                ev.stopPropagation();
                removeGif(item).then(render);
              },
            },
            "×",
          ),
        ),
      ),
    );
    body.append(
      h("div", { class: "gif-top" }, add),
      list.length ? grid : h("p", { class: "muted small gif-empty" }, t("Aún no tienes GIFs guardados. Haz clic derecho en un GIF del chat → «Guardar en Mis GIFs», o pega aquí su enlace.")),
    );
  }

  function renderSearch() {
    const prov = gifs().provider;
    if (!hasSearch) {
      body.append(h("p", { class: "muted small gif-empty" }, t("Para buscar GIFs, elige GIPHY o KLIPY y pon tu clave gratuita en Preferencias → Emojis → GIFs.")));
      return;
    }
    const q = h("input", { class: "input", placeholder: t("Buscar en {provider}…", { provider: PROVIDER_NAMES[prov] }) });
    const grid = h("div", { class: "gif-grid" });
    const status = h("p", { class: "muted small gif-empty" }, t("Escribe para buscar."));
    let page = 0;
    let more = false;
    let busy = false;
    const moreBtn = h("button", { class: "btn small gif-more hidden", type: "button" }, t("Más resultados"));
    async function run(reset) {
      const query = q.value.trim();
      if (!query) {
        grid.innerHTML = "";
        status.textContent = t("Escribe para buscar.");
        moreBtn.classList.add("hidden");
        return;
      }
      if (busy) return;
      busy = true;
      if (reset) page = 0;
      status.textContent = t("Buscando…");
      try {
        const r = await api("gifs:search", { query, page });
        if (reset) grid.innerHTML = "";
        // Los resultados se muestran en el orden y con las URL que da el proveedor.
        for (const it of r.items) grid.append(h("button", { class: "gif-cell", type: "button", title: it.title, onclick: (ev) => pick(it.url, ev) }, h("img", { src: it.preview, alt: it.title, loading: "lazy" })));
        more = r.hasMore;
        status.textContent = grid.children.length ? "" : t("Sin resultados.");
        moreBtn.classList.toggle("hidden", !more);
      } catch (err) {
        status.textContent = err.message;
      } finally {
        busy = false;
      }
    }
    // Las claves gratuitas tienen un límite por hora: se espera a que el usuario deje de escribir.
    q.addEventListener("input", debounce(() => run(true), 600));
    moreBtn.onclick = () => (page++, run(false));
    body.append(h("div", { class: "gif-top" }, q), status, grid, moreBtn);
    setTimeout(() => q.focus(), 20);
  }

  function render() {
    body.innerHTML = "";
    footer.innerHTML = "";
    for (const b of tabs.children) b.classList.toggle("active", b.dataset.tab === tab);
    if (tab === "saved") renderSaved();
    else renderSearch();
    // Atribución obligatoria del proveedor, en la pestaña donde se usa su API.
    const prov = gifs().provider;
    if (tab === "search" && prov === "giphy") footer.append(h("img", { class: "giphy-mark", src: "assets/gifs/powered-by-giphy.png", alt: "Powered by GIPHY" }));
    if (tab === "search" && prov === "klipy") footer.append(h("span", { class: "muted small", html: `Powered by <b>KLIPY</b>` }));
  }

  for (const [id, label] of [
    ["saved", t("Mis GIFs")],
    ["search", t("Buscar")],
  ]) {
    tabs.append(
      h(
        "button",
        {
          class: "gif-tab",
          type: "button",
          dataset: { tab: id },
          onclick: () => {
            tab = id;
            render();
          },
        },
        label,
      ),
    );
  }

  panel = h("div", { class: "emoji-picker gif-picker" }, tabs, body, footer);
  document.getElementById("menu-root").append(panel);
  const r = anchor.getBoundingClientRect();
  const pr = panel.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pr.width - 8))}px`;
  panel.style.top = `${Math.max(8, r.top - pr.height - 8)}px`;
  render();
}

document.addEventListener("pointerdown", (e) => {
  if (panel && !panel.contains(e.target) && !e.target.closest(".gif-toggle")) closeGifPicker();
});
document.addEventListener("keydown", (e) => e.key === "Escape" && closeGifPicker());
