import { test } from "node:test";
import assert from "node:assert/strict";
import { searchGifs, downloadGif, isProviderUrl, PROVIDERS } from "../../src/main/gifs.js";

const KEY = "clave-de-prueba-1234";
const fakeFetch = (body, { status = 200, headers = {} } = {}) => {
  const f = async (url, opts) => {
    f.calls.push({ url, opts });
    return {
      ok: status < 400,
      status,
      headers: { get: (h) => headers[h.toLowerCase()] ?? null },
      json: async () => body,
      arrayBuffer: async () => (body instanceof Uint8Array ? body.buffer : new ArrayBuffer(0)),
    };
  };
  f.calls = [];
  return f;
};

// Respuestas reducidas con la forma documentada de cada API.
const GIPHY = {
  data: [
    { id: "abc", title: "o7", images: { fixed_width_small: { url: "https://media1.giphy.com/media/abc/100w.gif", webp: "https://media1.giphy.com/media/abc/100w.webp", width: "100", height: "80" }, downsized: { url: "https://media1.giphy.com/media/abc/giphy-downsized.gif" }, original: { url: "https://media1.giphy.com/media/abc/giphy.gif" } } },
    { id: "sin-imagen", images: {} },
  ],
  pagination: { offset: 0, count: 2, total_count: 120 },
};
const KLIPY = {
  result: true,
  data: {
    data: [{ id: 8041071659142944, slug: "hello-hi-662", title: "Hello", file: { md: { gif: { url: "https://static.klipy.com/ii/x/md.gif", width: 220, height: 200 } }, xs: { webp: { url: "https://static.klipy.com/ii/x/xs.webp", width: 90, height: 80 } } } }],
    current_page: 1,
    per_page: 24,
    has_next: false,
  },
};

test("GIPHY: construye la búsqueda y normaliza la respuesta sin tocar las URL", async () => {
  const f = fakeFetch(GIPHY);
  const r = await searchGifs({ provider: "giphy", key: KEY, query: "  fleet up  ", page: 1, rating: "pg", lang: "es", fetchImpl: f });
  const u = new URL(f.calls[0].url);
  assert.equal(u.origin + u.pathname, "https://api.giphy.com/v1/gifs/search");
  assert.equal(u.searchParams.get("q"), "fleet up");
  assert.equal(u.searchParams.get("offset"), "24");
  assert.equal(u.searchParams.get("rating"), "pg");
  assert.equal(u.searchParams.get("lang"), "es");
  assert.deepEqual(r.items, [{ id: "abc", title: "o7", preview: "https://media1.giphy.com/media/abc/100w.webp", width: 100, height: 80, url: "https://media1.giphy.com/media/abc/giphy-downsized.gif" }]);
  assert.equal(r.hasMore, true);
});

test("KLIPY: la clave va en la ruta y se mapea el filtro de contenido", async () => {
  const f = fakeFetch(KLIPY);
  const r = await searchGifs({ provider: "klipy", key: KEY, query: "hola", rating: "g", lang: "es", fetchImpl: f });
  const u = new URL(f.calls[0].url);
  assert.equal(u.pathname, `/api/v1/${KEY}/gifs/search`);
  assert.equal(u.searchParams.get("content_filter"), "high");
  assert.equal(u.searchParams.get("page"), "1");
  assert.deepEqual(r.items[0], { id: "8041071659142944", title: "Hello", preview: "https://static.klipy.com/ii/x/xs.webp", width: 90, height: 80, url: "https://static.klipy.com/ii/x/md.gif" });
  assert.equal(r.hasMore, false);
});

test("searchGifs: la búsqueda se recorta a 50 caracteres y vacía no gasta llamadas", async () => {
  const f = fakeFetch(GIPHY);
  await searchGifs({ provider: "giphy", key: KEY, query: "x".repeat(80), fetchImpl: f });
  assert.equal(new URL(f.calls[0].url).searchParams.get("q").length, 50);
  const g = fakeFetch(GIPHY);
  assert.deepEqual(await searchGifs({ provider: "giphy", key: KEY, query: "   ", fetchImpl: g }), { items: [], hasMore: false });
  assert.equal(g.calls.length, 0);
});

test("searchGifs: errores claros sin proveedor, sin clave, clave rechazada y límite por hora", async () => {
  await assert.rejects(searchGifs({ provider: "none", key: KEY, query: "a" }), /buscador/);
  await assert.rejects(searchGifs({ provider: "giphy", key: "", query: "a" }), /clave/);
  await assert.rejects(searchGifs({ provider: "klipy", key: "../../x y", query: "a" }), /clave/);
  await assert.rejects(searchGifs({ provider: "giphy", key: KEY, query: "a", fetchImpl: fakeFetch({}, { status: 403 }) }), /rechaza la clave/);
  await assert.rejects(searchGifs({ provider: "giphy", key: KEY, query: "a", fetchImpl: fakeFetch({}, { status: 429 }) }), /límite/);
});

test("isProviderUrl reconoce los GIFs de GIPHY y KLIPY", () => {
  assert.ok(isProviderUrl("https://media2.giphy.com/media/abc/giphy.gif"));
  assert.ok(isProviderUrl("https://static.klipy.com/ii/x.gif"));
  assert.ok(isProviderUrl("https://klipy.co/x.gif"));
  assert.ok(!isProviderUrl("https://i.imgur.com/x.gif"));
  assert.ok(!isProviderUrl("https://notgiphy.com.example/x.gif"));
  assert.ok(!isProviderUrl("no es una url"));
});

test("downloadGif: guarda imágenes de otras webs y rechaza buscadores, no imágenes y ficheros grandes", async () => {
  const gif = new TextEncoder().encode("GIF89a....");
  const ok = await downloadGif("https://i.imgur.com/x.gif", { fetchImpl: fakeFetch(gif, { headers: { "content-type": "image/gif" } }) });
  assert.equal(ok.ext, "gif");
  assert.equal(ok.buffer.length, gif.length);
  await assert.rejects(downloadGif("https://media.giphy.com/media/a/giphy.gif"), /no permiten guardar/);
  await assert.rejects(downloadGif("file:///C:/Windows/win.ini"), /no válido/);
  await assert.rejects(downloadGif("https://ejemplo.com/x", { fetchImpl: fakeFetch(gif, { headers: { "content-type": "text/html" } }) }), /no es una imagen/);
  await assert.rejects(downloadGif("https://ejemplo.com/x.gif", { maxBytes: 4, fetchImpl: fakeFetch(gif, { headers: { "content-type": "image/gif" } }) }), /demasiado grande/);
  await assert.rejects(downloadGif("https://ejemplo.com/x.gif", { maxBytes: 4, fetchImpl: fakeFetch(gif, { headers: { "content-type": "image/gif", "content-length": "999999" } }) }), /demasiado grande/);
});

test("cada proveedor tiene el enlace para pedir la clave", () => {
  assert.match(PROVIDERS.giphy.keyUrl, /^https:\/\/developers\.giphy\.com\//);
  assert.match(PROVIDERS.klipy.keyUrl, /^https:\/\/partner\.klipy\.com\//);
});
