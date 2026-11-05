// Manejadores de ficheros del usuario (media-ipc.js): copias a userData/media, diálogos, temas, emojis, sonidos de
// Pidgin, avatar y fuentes. Los diálogos de Electron se simulan rellenando el `dialog` del stub.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { app, dialog } from "electron";
import { registerMediaIpc } from "../../src/main/media-ipc.js";
import * as store from "../../src/main/store.js";
import { tempDir } from "./helpers.mjs";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
const GIF = Buffer.from("R0lGODlhAQABAIAAAP8AAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

let dir;
let handlers;
let conn;
let fetchCalls;
const fakeFetch = async (url) => {
  fetchCalls.push(String(url));
  const body = JSON.stringify({ data: [] });
  return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => JSON.parse(body), text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
};
const setup = () => {
  handlers = {};
  conn = { calls: [], setOwnAvatar: async (...a) => (conn.calls.push(["set", ...a]), "ok"), removeOwnAvatar: async () => (conn.calls.push(["remove"]), "removed") };
  registerMediaIpc((name, fn) => (handlers[name] = fn), { getWin: () => null, getConn: () => conn, fetchImpl: fakeFetch });
};
const media = (...p) => path.join(dir, "media", ...p);
const fileOf = (ref) => media(...ref.replace("media://evex/", "").split("/"));
const write = (name, data) => {
  const f = path.join(dir, name);
  fs.writeFileSync(f, data);
  return f;
};

beforeEach((t) => {
  dir = tempDir(t);
  app.testUserData = dir;
  fetchCalls = [];
  setup();
  t.after(() => {
    delete app.testUserData;
    for (const k of Object.keys(dialog)) delete dialog[k];
  });
});

test("registra todos los canales de ficheros", () => {
  for (const ch of ["gifs:search", "gifs:save", "gifs:remove", "sounds:pidginScan", "sounds:pidginImport", "file:pick", "image:importPath", "image:importBytes", "image:importUrl", "emoji:import", "theme:export", "theme:import", "avatar:publish", "avatar:remove", "fonts:list"]) {
    assert.equal(typeof handlers[ch], "function", ch);
  }
});

test("file:pick copia el fichero elegido con el hash de su contenido y no lo duplica", async () => {
  const src = write("foto.PNG", PNG);
  dialog.showOpenDialog = async (_win, opts) => {
    assert.deepEqual(opts.properties, ["openFile"]);
    assert.ok(opts.filters[0].extensions.includes("png"));
    return { canceled: false, filePaths: [src] };
  };
  const ref = await handlers["file:pick"]("image");
  assert.match(ref, /^media:\/\/evex\/files\/[0-9a-f]{20}\.png$/);
  assert.deepEqual(fs.readFileSync(fileOf(ref)), PNG);
  // El mismo contenido da el mismo nombre: la segunda copia no falla ni crea otro fichero.
  assert.equal(await handlers["file:pick"]("image"), ref);
  assert.equal(fs.readdirSync(media("files")).length, 1);
  // Los sonidos van a su carpeta.
  const wav = write("aviso.wav", Buffer.from("RIFF....WAVE"));
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [wav] });
  assert.match(await handlers["file:pick"]("sound"), /^media:\/\/evex\/sounds\/[0-9a-f]{20}\.wav$/);
  // Cancelar no copia nada.
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  assert.equal(await handlers["file:pick"]("image"), null);
});

test("image:importPath solo admite imágenes por extensión, ficheros y hasta 25 MB", async () => {
  const ok = write("fondo.jpg", JPG);
  assert.match(handlers["image:importPath"](ok), /^media:\/\/evex\/files\/[0-9a-f]{20}\.jpg$/);
  assert.throws(() => handlers["image:importPath"](write("nota.txt", "hola")), /no es una imagen \(txt\)/);
  assert.throws(() => handlers["image:importPath"](""), /no es una imagen \(\?\)/);
  const folder = path.join(dir, "carpeta.png");
  fs.mkdirSync(folder);
  assert.throws(() => handlers["image:importPath"](folder), /no es una imagen/);
  const big = path.join(dir, "enorme.png");
  fs.writeFileSync(big, "");
  fs.truncateSync(big, 25 * 1024 * 1024 + 1);
  assert.throws(() => handlers["image:importPath"](big), /demasiado grande/);
});

test("image:importBytes comprueba la cabecera de la imagen pegada, no solo el tipo", () => {
  const ref = handlers["image:importBytes"](new Uint8Array(PNG), "image/PNG");
  assert.match(ref, /^media:\/\/evex\/files\/[0-9a-f]{20}\.png$/);
  assert.deepEqual(fs.readFileSync(fileOf(ref)), PNG);
  // Mismos bytes otra vez: ya estaba guardada.
  assert.equal(handlers["image:importBytes"]([...PNG], "image/png"), ref);
  assert.throws(() => handlers["image:importBytes"](new Uint8Array(GIF), "image/png"), /No hay ninguna imagen/);
  assert.throws(() => handlers["image:importBytes"](new Uint8Array(PNG), "text/html"), /No hay ninguna imagen/);
  assert.throws(() => handlers["image:importBytes"](null, "image/png"), /No hay ninguna imagen/);
  const big = Buffer.concat([GIF, Buffer.alloc(25 * 1024 * 1024)]);
  assert.throws(() => handlers["image:importBytes"](new Uint8Array(big), "image/gif"), /demasiado grande/);
});

test("emoji:import usa el nombre del fichero como :código: y copia cada imagen", async () => {
  const a = write("Party Parrot!.gif", GIF);
  const b = write("o7.png", PNG);
  dialog.showOpenDialog = async (_win, opts) => {
    assert.ok(opts.properties.includes("multiSelections"));
    return { canceled: false, filePaths: [a, b] };
  };
  const list = await handlers["emoji:import"]();
  assert.deepEqual(
    list.map((e) => e.name),
    ["party_parrot_", "o7"],
  );
  for (const e of list) assert.ok(fs.existsSync(fileOf(e.url)), e.url);
  assert.ok(list.every((e) => e.url.startsWith("media://evex/emoji/")));
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  assert.deepEqual(await handlers["emoji:import"](), []);
});

test("theme:export y theme:import guardan y leen el tema en JSON", async () => {
  const out = path.join(dir, "mio.evex-theme.json");
  dialog.showSaveDialog = async (_win, opts) => {
    // El nombre propuesto no lleva caracteres raros.
    assert.equal(opts.defaultPath, "Mi_tema_.evex-theme.json");
    return { canceled: false, filePath: out };
  };
  const theme = { name: "Mi tema!", colors: { accent: "#123456" } };
  assert.equal(await handlers["theme:export"](theme), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, "utf8")), theme);
  dialog.showSaveDialog = async (_win, opts) => (assert.equal(opts.defaultPath, "tema.evex-theme.json"), { canceled: true });
  assert.equal(await handlers["theme:export"]({}), false);

  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [out] });
  assert.deepEqual(await handlers["theme:import"](), theme);
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  assert.equal(await handlers["theme:import"](), null);
});

test("gifs:remove solo borra miniaturas de la carpeta de GIFs", () => {
  fs.mkdirSync(media("gifs"), { recursive: true });
  const name = "0123456789abcdef0123.gif";
  fs.writeFileSync(media("gifs", name), GIF);
  const outside = write("importante.gif", GIF);
  assert.equal(handlers["gifs:remove"](`media://evex/gifs/${name}`), true);
  assert.equal(fs.existsSync(media("gifs", name)), false);
  // Rutas que no son una miniatura de la app no se tocan.
  for (const bad of ["media://evex/gifs/../../importante.gif", outside, "", null]) assert.equal(handlers["gifs:remove"](bad), true);
  assert.ok(fs.existsSync(outside));
});

test("gifs:search usa el proveedor y la clave de Preferencias", async () => {
  const g = store.get().settings.gifs;
  const saved = structuredClone(g);
  try {
    g.provider = "giphy";
    g.keys = { ...(g.keys || {}), giphy: "clave-de-prueba" };
    await handlers["gifs:search"]({ query: "o7", page: 0 }).catch(() => {});
    assert.ok(fetchCalls.some((u) => u.includes("giphy") && u.includes("clave-de-prueba") && u.includes("o7")), fetchCalls.join("\n"));
  } finally {
    Object.assign(g, saved);
  }
});

test("sounds:pidginScan y sounds:pidginImport usan los sonidos de Pidgin y copian solo los pedidos", (t) => {
  const purple = path.join(dir, ".purple");
  fs.mkdirSync(purple);
  const wav = write("mi-aviso.wav", Buffer.from("RIFF0000WAVEfmt "));
  fs.writeFileSync(
    path.join(purple, "prefs.xml"),
    `<?xml version='1.0' encoding='UTF-8' ?><pref version='1' name='/'><pref name='pidgin'><pref name='sound'><pref name='file'><pref name='im_recv' type='path' value='${wav.replace(/&/g, "&amp;").replace(/'/g, "&apos;")}'/></pref></pref></pref></pref>`,
  );
  const before = process.env.EVEX_PURPLE_DIR;
  process.env.EVEX_PURPLE_DIR = purple;
  t.after(() => (before === undefined ? delete process.env.EVEX_PURPLE_DIR : (process.env.EVEX_PURPLE_DIR = before)));

  const scan = handlers["sounds:pidginScan"]();
  assert.equal(scan.found, true);
  assert.deepEqual(scan.sounds.private, { name: "mi-aviso.wav", custom: true });
  const out = handlers["sounds:pidginImport"](["private", "noexiste"]);
  assert.deepEqual(Object.keys(out), ["private"]);
  assert.match(out.private, /^media:\/\/evex\/sounds\/[0-9a-f]{20}\.wav$/);
  assert.ok(fs.existsSync(fileOf(out.private)));
  assert.deepEqual(handlers["sounds:pidginImport"](null), {});
});

test("avatar:publish comprueba tipo, cabecera y tamaño antes de publicar", async () => {
  assert.equal(await handlers["avatar:publish"]("acc", { data: [...PNG], type: "image/png" }), "ok");
  const [, data, type, opts] = conn.calls[0];
  assert.deepEqual(data, PNG);
  assert.equal(type, "image/png");
  assert.equal(opts.pep, null);
  // Con la versión para XEP-0084.
  await handlers["avatar:publish"]("acc", { data: new Uint8Array(JPG), type: "image/jpeg" }, { data: new Uint8Array(PNG), type: "image/png", width: "64" });
  assert.deepEqual(conn.calls[1][3].pep, { data: PNG, type: "image/png", width: 64, height: 96 });
  await assert.rejects(handlers["avatar:publish"]("acc", { data: [...PNG], type: "image/webp" }), /No se pudo leer la imagen/);
  await assert.rejects(handlers["avatar:publish"]("acc", { data: [...GIF], type: "image/png" }), /No se pudo leer la imagen/);
  await assert.rejects(handlers["avatar:publish"]("acc", { data: [...Buffer.concat([PNG, Buffer.alloc(96 * 1024)])], type: "image/png" }), /demasiado grande/);
  await assert.rejects(handlers["avatar:publish"]("acc", null), /No se pudo leer la imagen/);
  assert.equal(await handlers["avatar:remove"]("acc"), "removed");
  assert.deepEqual(conn.calls.at(-1), ["remove"]);
});

test("fonts:list devuelve las familias del sistema sin estilos, ordenadas y sin repetir", async () => {
  const fonts = await handlers["fonts:list"]();
  assert.ok(Array.isArray(fonts));
  assert.deepEqual(fonts, [...new Set(fonts)].sort((a, b) => a.localeCompare(b)));
  for (const f of fonts) assert.doesNotMatch(f, /\b(Bold|Italic)\b|\((TrueType|OpenType)\)/, f);
});
