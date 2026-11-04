// Imágenes descargadas de Internet: nunca se guardan tal cual llegan. Se comprueba de qué tipo son por su cabecera (no
// por lo que diga el servidor), se rechazan las animadas y las demás se dibujan con el decodificador de Chromium en una
// ventana oculta y se vuelven a codificar desde los píxeles. Lo que se escribe en disco lo ha generado la app, así que
// no puede llevar nada escondido del fichero original (datos al final, ficheros políglotas, metadatos).
import { BrowserWindow, session } from "electron";

// Firma (primeros bytes) de cada formato admitido.
export function sniffImage(buf) {
  const b = buf || [];
  const at = (i, ...bytes) => bytes.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (at(0, 0xff, 0xd8, 0xff)) return "jpg";
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  // AVIF: caja «ftyp» con la marca avif o avis (principal o entre las compatibles, p. ej. «mif1 … avif»).
  if (at(4, 0x66, 0x74, 0x79, 0x70) && /avi[fs]/.test(Buffer.from(b.slice(8, 64)).toString("latin1"))) return "avif";
  return null;
}

// ¿Tiene más de un fotograma? GIF: se recorren sus bloques contando imágenes; WebP: marca de animación de VP8X;
// AVIF: secuencia («avis»). Si un GIF está mal formado se trata como animado (y se rechaza).
export function isAnimated(buf, kind) {
  if (kind === "webp") return buf.length > 20 && buf.toString("latin1", 12, 16) === "VP8X" && (buf[20] & 0x02) !== 0;
  if (kind === "avif") return buf.toString("latin1", 8, 12) === "avis" || /avis/.test(buf.toString("latin1", 16, Math.min(buf.length, 64)));
  if (kind !== "gif") return false;
  let i = 13;
  if (buf[10] & 0x80) i += 3 * 2 ** ((buf[10] & 0x07) + 1);
  const skipSubBlocks = () => {
    while (i < buf.length && buf[i] !== 0) i += buf[i] + 1;
    i++;
  };
  let frames = 0;
  while (i < buf.length) {
    const block = buf[i];
    if (block === 0x3b) return frames > 1;
    if (block === 0x21) {
      i += 2;
      skipSubBlocks();
    } else if (block === 0x2c) {
      if (++frames > 1) return true;
      const packed = buf[i + 9];
      i += 10;
      if (packed & 0x80) i += 3 * 2 ** ((packed & 0x07) + 1);
      i++; // tamaño mínimo del código LZW
      skipSubBlocks();
    } else {
      return true;
    }
  }
  return true;
}

// Se ejecuta dentro de la ventana oculta: decodifica con createImageBitmap y vuelve a codificar desde un lienzo.
const RECODE = `async (b64, type, outType) => {
  const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const image = await createImageBitmap(new Blob([data], { type }));
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext("2d").drawImage(image, 0, 0);
  image.close();
  const out = await canvas.convertToBlob({ type: outType, quality: 0.92 });
  const bytes = new Uint8Array(await out.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}`;

const MIME = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" };
const TIMEOUT = 20000;

// Vuelve a codificar una imagen fija: las JPEG siguen en JPEG (fotos: mucho más pequeñas) y el resto pasa a PNG.
// La ventana es de un solo uso, sin red (sesión propia en memoria que cancela cualquier petición) y sin acceso a Node.
export async function reencodeImage(buf, kind) {
  const outExt = kind === "jpg" ? "jpg" : "png";
  const ses = session.fromPartition("evex-reencode");
  ses.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !details.url.startsWith("about:") }));
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  let timer;
  try {
    await win.loadURL("about:blank");
    const call = `(${RECODE})(${JSON.stringify(buf.toString("base64"))}, ${JSON.stringify(MIME[kind])}, ${JSON.stringify(MIME[outExt])})`;
    const b64 = await Promise.race([win.webContents.executeJavaScript(call), new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT)))]);
    const out = Buffer.from(b64, "base64");
    if (sniffImage(out) !== outExt) throw new Error("bad output");
    return { buffer: out, ext: outExt };
  } finally {
    clearTimeout(timer);
    win.destroy();
  }
}
