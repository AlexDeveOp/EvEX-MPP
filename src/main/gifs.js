// GIFs: búsqueda opcional en GIPHY o KLIPY con la clave propia del usuario, y la colección «Mis GIFs».
// Condiciones de GIPHY: no guardar ni cachear sus GIFs ni sus URL, no reordenar ni filtrar resultados, no mezclarlos
// con otros proveedores, no hacer de intermediario y mostrar «Powered by GIPHY». Por eso «Mis GIFs» no admite GIFs
// de los buscadores (KLIPY se trata igual mientras no se puedan leer sus condiciones) y las miniaturas se cargan
// directamente desde su CDN en la interfaz.
import { t } from "./i18n.js";

const PER_PAGE = 24;
const MAX_QUERY = 50; // GIPHY: «Maximum length: 50 chars»

// rating de GIPHY → content_filter de KLIPY
const KLIPY_FILTER = { g: "high", pg: "medium", "pg-13": "low", r: "off" };

export const PROVIDERS = {
  giphy: {
    name: "GIPHY",
    keyUrl: "https://developers.giphy.com/dashboard/",
    url: ({ key, query, page, rating, lang }) =>
      `https://api.giphy.com/v1/gifs/search?${new URLSearchParams({ api_key: key, q: query, limit: String(PER_PAGE), offset: String(page * PER_PAGE), rating, lang })}`,
    parse(json) {
      const items = (json?.data || []).map((g) => {
        const im = g.images || {};
        const preview = im.fixed_width_small || im.fixed_width || im.preview_gif || {};
        // Se envía la versión de menos de 2 MB; si no existe, la original.
        const send = im.downsized?.url || im.original?.url || "";
        return { id: String(g.id), title: g.title || "", preview: preview.webp || preview.url || "", width: +preview.width || 0, height: +preview.height || 0, url: send };
      });
      const p = json?.pagination || {};
      return { items: items.filter((i) => i.url && i.preview), hasMore: (p.offset || 0) + (p.count || 0) < (p.total_count || 0) };
    },
  },
  klipy: {
    name: "KLIPY",
    keyUrl: "https://partner.klipy.com/api-keys",
    url: ({ key, query, page, rating, lang }) =>
      `https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/search?${new URLSearchParams({ q: query, page: String(page + 1), per_page: String(PER_PAGE), content_filter: KLIPY_FILTER[rating] || "medium", locale: lang === "es" ? "es" : "us" })}`,
    parse(json) {
      const d = json?.data || {};
      const items = (d.data || []).map((g) => {
        const f = g.file || {};
        const preview = f.xs?.webp || f.xs?.gif || f.sm?.webp || f.sm?.gif || {};
        const send = f.md?.gif?.url || f.hd?.gif?.url || f.sm?.gif?.url || "";
        return { id: String(g.id ?? g.slug), title: g.title || "", preview: preview.url || "", width: +preview.width || 0, height: +preview.height || 0, url: send };
      });
      return { items: items.filter((i) => i.url && i.preview), hasMore: !!d.has_next };
    },
  },
};

const HOSTS = [/(^|\.)giphy\.com$/i, /(^|\.)klipy\.(com|co)$/i];
// ¿Es un GIF de un buscador? (no se puede guardar en «Mis GIFs»).
export function isProviderUrl(url) {
  try {
    const host = new URL(url).hostname;
    return HOSTS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

export async function searchGifs({ provider, key, query, page = 0, rating = "pg-13", lang = "en", fetchImpl = fetch }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(t("No hay ningún buscador de GIFs configurado."));
  if (!key || !/^[\w.-]{8,200}$/.test(key)) throw new Error(t("Falta la clave de {provider} (Preferencias → Emojis → GIFs).", { provider: p.name }));
  const q = String(query || "").trim().slice(0, MAX_QUERY);
  if (!q) return { items: [], hasMore: false };
  const res = await fetchImpl(p.url({ key, query: q, page, rating, lang }), { headers: { Accept: "application/json" } });
  if (res.status === 401 || res.status === 403) throw new Error(t("{provider} rechaza la clave. Revísala en Preferencias → Emojis → GIFs.", { provider: p.name }));
  if (res.status === 429) throw new Error(t("Has llegado al límite de búsquedas de {provider} por hora. Prueba un poco más tarde.", { provider: p.name }));
  if (!res.ok) throw new Error(t("{provider} respondió con el código {status}", { provider: p.name, status: res.status }));
  return { provider, ...p.parse(await res.json()) };
}

const TYPES = { "image/gif": "gif", "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/avif": "avif" };

// Descarga un GIF para «Mis GIFs» (copia local para la miniatura; al enviarlo se manda su URL original).
export async function downloadGif(url, { fetchImpl = fetch, maxBytes = 15 * 1024 * 1024 } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(t("Enlace no válido."));
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(t("Enlace no válido."));
  if (isProviderUrl(url)) throw new Error(t("Las condiciones de GIPHY y KLIPY no permiten guardar sus GIFs. Búscalo otra vez cuando lo necesites."));
  const res = await fetchImpl(url, { redirect: "follow" });
  if (!res.ok) throw new Error(t("No se pudo descargar ({status}).", { status: res.status }));
  const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const ext = TYPES[type];
  if (!ext) throw new Error(t("Ese enlace no es una imagen ({type}).", { type: type || "?" }));
  const len = Number(res.headers.get("content-length") || 0);
  if (len > maxBytes) throw new Error(t("La imagen es demasiado grande (máximo {mb} MB).", { mb: Math.round(maxBytes / 1048576) }));
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(t("La imagen es demasiado grande (máximo {mb} MB).", { mb: Math.round(maxBytes / 1048576) }));
  return { buffer: buf, ext };
}
