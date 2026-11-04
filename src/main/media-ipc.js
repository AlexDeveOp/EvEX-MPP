// Ficheros del usuario: elegir ficheros, imágenes para los fondos (arrastradas, pegadas o descargadas), emojis propios,
// temas, avatar, GIFs guardados, sonidos de Pidgin y fuentes del sistema. Todo se copia a userData/media.
import { dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import * as store from "./store.js";
import { scanPidginSounds } from "./pidgin-import.js";
import { searchGifs, downloadGif } from "./gifs.js";
import { mediaDir } from "./paths.js";
import { sniffImage, isAnimated, reencodeImage } from "./image-reencode.js";
import { parseFcList } from "./platform.js";
import { t, tk, currentLang } from "./i18n.js";

// Los nombres se traducen al abrir el diálogo (el idioma puede cambiar en marcha).
const fileFilters = (kind) => (FILTERS[kind] || []).map((f) => ({ ...f, name: t(f.name) }));

const FILTERS = {
  image: [{ name: tk("Imágenes"), extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"] }],
  sound: [{ name: tk("Sonidos"), extensions: ["mp3", "wav", "ogg", "m4a", "flac"] }],
  video: [{ name: tk("Vídeo"), extensions: ["mp4", "webm"] }],
};

function copyToMedia(src, sub = "files") {
  const data = fs.readFileSync(src);
  const hash = crypto.createHash("sha1").update(data).digest("hex").slice(0, 20);
  const ext = path.extname(src).toLowerCase();
  const name = `${hash}${ext}`;
  fs.mkdirSync(mediaDir(sub), { recursive: true });
  const dest = mediaDir(sub, name);
  // "wx" falla si ya existe: el nombre es el hash del contenido, así que ya está copiado.
  try {
    fs.writeFileSync(dest, data, { flag: "wx" });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  return `media://evex/${sub}/${name}`;
}

// Fuentes instaladas: el registro de Windows, o fontconfig (`fc-list`) en Linux.
function listSystemFonts() {
  if (process.platform !== "win32") {
    return new Promise((resolve) => execFile("fc-list", [":", "family"], { maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err ? [] : parseFcList(out))));
  }
  const keys = ["HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts", "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"];
  const query = (k) =>
    new Promise((resolve) => execFile("reg", ["query", k], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err ? "" : out)));
  const STYLE = /\b(bold|italic|oblique|light|semilight|semibold|demibold|black|heavy|thin|extralight|extrabold|ultralight|ultrabold|medium|regular|condensed|narrow|semicondensed|extended|book|normal)\b/gi;
  return Promise.all(keys.map(query)).then((outs) => {
    const names = new Set();
    for (const line of outs.join("\n").split(/\r?\n/)) {
      const m = line.match(/^\s{4}(.+?)\s+REG_SZ\s+/);
      if (!m) continue;
      for (const part of m[1].replace(/\s*\((TrueType|OpenType|All res)\)\s*$/i, "").split(/\s*&\s*/)) {
        const fam = part.replace(STYLE, "").replace(/\s+/g, " ").trim();
        if (fam && !/^\d/.test(fam)) names.add(fam);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  });
}

export function registerMediaIpc(handle, { getWin, getConn, fetchImpl }) {
  // Sonidos de Pidgin: se buscan en el Pidgin instalado y se copian a la carpeta de la app (no se incluyen con EvEX-MPP).
  // GIFs: búsqueda con la clave del usuario y copias locales de «Mis GIFs» (solo para la miniatura).
  handle("gifs:search", ({ query, page }) => {
    const g = store.get().settings.gifs;
    return searchGifs({ provider: g.provider, key: g.keys?.[g.provider], query, page, rating: g.rating, lang: currentLang(), fetchImpl });
  });
  // «Mis GIFs» guarda solo el enlace (al enviarlo también se manda el enlace): se descarga para comprobar que de
  // verdad es una imagen, pero no se escribe en disco. Las miniaturas copiadas por versiones anteriores siguen sirviendo.
  handle("gifs:save", async (url) => {
    const { buffer } = await downloadGif(url, { fetchImpl });
    if (!sniffImage(buffer)) throw new Error(t("Ese enlace no es una imagen ({type}).", { type: "?" }));
    return { url };
  });
  handle("gifs:remove", (thumb) => {
    const m = String(thumb || "").match(/^media:\/\/evex\/gifs\/([0-9a-f]{20}\.[a-z]{3,4})$/);
    if (m) fs.rmSync(mediaDir("gifs", m[1]), { force: true });
    return true;
  });

  handle("sounds:pidginScan", () => {
    const r = scanPidginSounds();
    return { found: r.found, sounds: Object.fromEntries(Object.entries(r.sounds).map(([k, v]) => [k, { name: path.basename(v.file), custom: v.custom }])) };
  });
  handle("sounds:pidginImport", (kinds) => {
    const r = scanPidginSounds();
    const out = {};
    for (const k of kinds || []) if (r.sounds[k]) out[k] = copyToMedia(r.sounds[k].file, "sounds");
    return out;
  });

  handle("file:pick", async (kind) => {
    const r = await dialog.showOpenDialog(getWin(), { properties: ["openFile"], filters: fileFilters(kind) });
    if (r.canceled || !r.filePaths[0]) return null;
    return copyToMedia(r.filePaths[0], kind === "sound" ? "sounds" : "files");
  });

  // Imágenes de fuera de la app para los fondos: arrastradas desde el Explorador, pegadas del portapapeles o desde una
  // dirección de Internet. Siempre se copian a la carpeta de la app (así el fondo sigue aunque se borre el original).
  const IMAGE_EXT = FILTERS.image[0].extensions;
  const MAX_IMAGE = 25 * 1024 * 1024;
  const saveImageBuffer = (buffer, ext) => {
    const name = `${crypto.createHash("sha1").update(buffer).digest("hex").slice(0, 20)}.${ext}`;
    fs.mkdirSync(mediaDir("files"), { recursive: true });
    try {
      fs.writeFileSync(mediaDir("files", name), buffer, { flag: "wx" });
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
    return `media://evex/files/${name}`;
  };
  handle("image:importPath", (file) => {
    const ext = path.extname(String(file || "")).slice(1).toLowerCase();
    if (!IMAGE_EXT.includes(ext)) throw new Error(t("Ese archivo no es una imagen ({ext}).", { ext: ext || "?" }));
    const st = fs.statSync(file);
    if (!st.isFile()) throw new Error(t("Ese archivo no es una imagen ({ext}).", { ext }));
    if (st.size > MAX_IMAGE) throw new Error(t("La imagen es demasiado grande (máximo {mb} MB).", { mb: 25 }));
    return copyToMedia(file, "files");
  });
  // Imagen pegada (Ctrl+V o «Pegar imagen»): la interfaz la lee del portapapeles y manda sus bytes.
  // Se comprueba la cabecera del fichero: no basta con el tipo que diga el portapapeles.
  const MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46, 0x38], webp: [0x52, 0x49, 0x46, 0x46] };
  handle("image:importBytes", (data, type) => {
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[String(type).toLowerCase()];
    const buffer = Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data || []));
    if (!ext || !MAGIC[ext].every((b, i) => buffer[i] === b)) throw new Error(t("No hay ninguna imagen copiada en el portapapeles."));
    if (buffer.length > MAX_IMAGE) throw new Error(t("La imagen es demasiado grande (máximo {mb} MB).", { mb: 25 }));
    return saveImageBuffer(buffer, ext);
  });
  // Imagen desde una dirección de Internet (también al arrastrarla desde el navegador): se comprueba por su cabecera, las
  // animadas no se admiten y las demás se vuelven a codificar (image-reencode.js): nunca se guardan los bytes descargados.
  handle("image:importUrl", async (url) => {
    const { buffer } = await downloadGif(String(url || "").trim(), { fetchImpl, maxBytes: MAX_IMAGE });
    const kind = sniffImage(buffer);
    if (!kind) throw new Error(t("Ese enlace no es una imagen ({type}).", { type: "?" }));
    if (isAnimated(buffer, kind)) throw new Error(t("Las imágenes animadas no se pueden añadir desde un enlace. Guárdala en tu PC y arrástrala desde el Explorador, o usa «Elegir archivo…»."));
    let out;
    try {
      out = await reencodeImage(buffer, kind);
    } catch {
      throw new Error(t("No se pudo leer la imagen"));
    }
    return saveImageBuffer(out.buffer, out.ext);
  });

  handle("emoji:import", async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: t("Elige imágenes (GIF, PNG, WebP…) — el nombre del fichero será el :código:"), properties: ["openFile", "multiSelections"], filters: fileFilters("image") });
    if (r.canceled) return [];
    return r.filePaths.map((f) => ({
      name: path.basename(f, path.extname(f)).toLowerCase().replace(/[^a-z0-9_+-]+/g, "_"),
      url: copyToMedia(f, "emoji"),
    }));
  });

  handle("theme:export", async (data) => {
    const r = await dialog.showSaveDialog(getWin(), { defaultPath: `${(data.name || "tema").replace(/[^\w-]+/g, "_")}.evex-theme.json`, filters: [{ name: t("Tema EvEX"), extensions: ["json"] }] });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2));
    return true;
  });
  handle("theme:import", async () => {
    const r = await dialog.showOpenDialog(getWin(), { properties: ["openFile"], filters: [{ name: t("Tema EvEX"), extensions: ["json"] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return JSON.parse(fs.readFileSync(r.filePaths[0], "utf8"));
  });

  // Avatar propio ya recortado y comprimido en la ventana (avatar-image.js). Se comprueba que sea de verdad una imagen
  // PNG, JPEG o GIF y que no pase del tamaño que acepta un perfil XMPP; pep es la versión fija para XEP-0084.
  const AVATAR_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif" };
  const AVATAR_MAX = 96 * 1024;
  const avatarBuffer = (data, type) => {
    const ext = AVATAR_TYPES[String(type).toLowerCase()];
    const buffer = Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data || []));
    if (!ext || !MAGIC[ext].every((b, i) => buffer[i] === b)) throw new Error(t("No se pudo leer la imagen"));
    if (buffer.length > AVATAR_MAX) throw new Error(t("La imagen es demasiado grande para un avatar."));
    return buffer;
  };
  handle("avatar:publish", async (id, img, pep) => {
    const data = avatarBuffer(img?.data, img?.type);
    const pepData = pep ? { data: avatarBuffer(pep.data, pep.type), type: pep.type, width: Number(pep.width) || 96, height: Number(pep.height) || 96 } : null;
    return getConn(id).setOwnAvatar(data, img.type, { pep: pepData });
  });
  handle("avatar:remove", (id) => getConn(id).removeOwnAvatar());

  handle("fonts:list", () => listSystemFonts());
}
