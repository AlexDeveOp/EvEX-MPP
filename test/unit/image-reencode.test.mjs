// Imágenes desde Internet (alertas CodeQL #24 y #25): «Mis GIFs» no escribe nada en disco y los fondos por enlace solo
// guardan lo que devuelve la recodificación, nunca los bytes descargados. Las animadas por enlace se rechazan.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, session } from "electron";
import { sniffImage, isAnimated, reencodeImage } from "../../src/main/image-reencode.js";
import { registerMediaIpc } from "../../src/main/media-ipc.js";
import { tempDir } from "./helpers.mjs";

const b64 = (s) => Buffer.from(s, "base64");
// Muestras reales mínimas.
const PNG = b64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==");
const GIF1 = b64("R0lGODlhAQABAIAAAP8AAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==");
const GIF2 = b64("R0lGODlhAgACAPAAAP8AAAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQAMgAAACwAAAAAAgACAAACAoRRACH5BAAyAAAALAAAAAACAAIAgAAA/wAAAAIChFEAOw==");
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const riff = (fourcc, extra) => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.from(fourcc), Buffer.alloc(4), extra]);
const WEBP_STATIC = riff("VP8 ", Buffer.alloc(10));
const WEBP_ANIM = riff("VP8X", Buffer.from([0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
const ftyp = (major, ...compat) => Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftyp" + major), Buffer.alloc(4), Buffer.from(compat.join(""))]);

test("sniffImage reconoce el formato por la cabecera, no por la extensión ni el tipo del servidor", () => {
  assert.equal(sniffImage(PNG), "png");
  assert.equal(sniffImage(JPG), "jpg");
  assert.equal(sniffImage(GIF1), "gif");
  assert.equal(sniffImage(WEBP_STATIC), "webp");
  assert.equal(sniffImage(ftyp("avif", "mif1")), "avif");
  assert.equal(sniffImage(ftyp("mif1", "miaf", "avif")), "avif");
  assert.equal(sniffImage(Buffer.from("<html>no soy una imagen</html>")), null);
  assert.equal(sniffImage(Buffer.from("MZ\x90\x00")), null);
  assert.equal(sniffImage(Buffer.alloc(0)), null);
});

test("isAnimated distingue imágenes fijas de animadas", () => {
  assert.equal(isAnimated(GIF1, "gif"), false);
  assert.equal(isAnimated(GIF2, "gif"), true);
  assert.equal(isAnimated(Buffer.concat([GIF1.subarray(0, 20), Buffer.from([0x99])]), "gif"), true, "un GIF mal formado se trata como animado");
  assert.equal(isAnimated(WEBP_STATIC, "webp"), false);
  assert.equal(isAnimated(WEBP_ANIM, "webp"), true);
  assert.equal(isAnimated(ftyp("avif", "mif1"), "avif"), false);
  assert.equal(isAnimated(ftyp("avis", "msf1"), "avif"), true);
  assert.equal(isAnimated(PNG, "png"), false);
});

test("reencodeImage usa una ventana de un solo uso sin red y devuelve solo lo que genera Chromium", async () => {
  const OUT = Buffer.concat([PNG, Buffer.from("recodificado")]);
  let code = "";
  BrowserWindow.executeResult = (c) => ((code = c), OUT.toString("base64"));
  try {
    const r = await reencodeImage(WEBP_STATIC, "webp");
    assert.equal(r.ext, "png");
    assert.deepEqual(r.buffer, OUT);
    assert.ok(code.includes(WEBP_STATIC.toString("base64")) && code.includes('"image/webp"') && code.includes('"image/png"'));
    const win = BrowserWindow.created.at(-1);
    assert.equal(win.destroyed, true, "la ventana se destruye");
    assert.equal(win.options.webPreferences.sandbox, true);
    assert.equal(win.options.webPreferences.nodeIntegration, false);
    const filter = session.fromPartition("evex-reencode").webRequest.filter;
    const ask = (url) => new Promise((resolve) => filter({ url }, resolve));
    assert.deepEqual(await ask("https://ejemplo.com/x.png"), { cancel: true }, "sin red");
    assert.deepEqual(await ask("about:blank"), { cancel: false });
    // Las JPEG siguen en JPEG.
    BrowserWindow.executeResult = () => JPG.toString("base64");
    assert.equal((await reencodeImage(JPG, "jpg")).ext, "jpg");
    // Si la salida no es del formato pedido, se rechaza.
    BrowserWindow.executeResult = () => Buffer.from("basura").toString("base64");
    await assert.rejects(reencodeImage(PNG, "png"));
  } finally {
    delete BrowserWindow.executeResult;
  }
});

// Manejadores reales de media-ipc.js con una descarga simulada y la carpeta de datos en un directorio temporal.
let dir;
let handlers;
const fakeFetch = (bytes, type) => async () => ({ ok: true, status: 200, headers: { get: (h) => (h.toLowerCase() === "content-type" ? type : null) }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) });
const setup = (bytes, type) => {
  handlers = {};
  registerMediaIpc((name, fn) => (handlers[name] = fn), { getWin: () => null, getConn: () => null, fetchImpl: fakeFetch(bytes, type) });
};
const filesIn = (sub) => (fs.existsSync(path.join(dir, "media", sub)) ? fs.readdirSync(path.join(dir, "media", sub)) : []);

beforeEach((t) => {
  dir = tempDir(t);
  app.testUserData = dir;
  t.after(() => delete app.testUserData);
});

test("«Mis GIFs» guarda solo el enlace y no escribe nada en disco", async () => {
  setup(GIF2, "image/gif");
  assert.deepEqual(await handlers["gifs:save"]("https://ejemplo.com/o7.gif"), { url: "https://ejemplo.com/o7.gif" });
  assert.deepEqual(filesIn("gifs"), []);
  // Un enlace que dice ser GIF pero no lo es se rechaza.
  setup(Buffer.from("<html>no</html>"), "image/gif");
  await assert.rejects(handlers["gifs:save"]("https://ejemplo.com/falso.gif"), /no es una imagen/);
});

test("fondo por enlace: se guarda la imagen recodificada, no los bytes descargados", async () => {
  const OUT = Buffer.concat([PNG, Buffer.from("recodificado")]);
  BrowserWindow.executeResult = () => OUT.toString("base64");
  try {
    const downloaded = Buffer.concat([PNG, Buffer.from("datos escondidos al final")]);
    setup(downloaded, "image/png");
    const ref = await handlers["image:importUrl"]("https://ejemplo.com/fondo.png");
    const [name] = filesIn("files");
    assert.equal(ref, `media://evex/files/${name}`);
    const saved = fs.readFileSync(path.join(dir, "media", "files", name));
    assert.deepEqual(saved, OUT);
    assert.equal(saved.includes("datos escondidos"), false);
  } finally {
    delete BrowserWindow.executeResult;
  }
});

test("fondo por enlace: las animadas y lo que no es imagen se rechazan sin escribir nada", async () => {
  setup(GIF2, "image/gif");
  await assert.rejects(handlers["image:importUrl"]("https://ejemplo.com/animado.gif"), /animadas/);
  setup(WEBP_ANIM, "image/webp");
  await assert.rejects(handlers["image:importUrl"]("https://ejemplo.com/animado.webp"), /animadas/);
  setup(Buffer.from("MZ ejecutable"), "image/png");
  await assert.rejects(handlers["image:importUrl"]("https://ejemplo.com/virus.png"), /no es una imagen/);
  assert.deepEqual(filesIn("files"), []);
});
