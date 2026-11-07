// Modo FC: guardar y abrir el fichero de configuración compartible (fc-share.js).
// - Las rutas las elige SIEMPRE el usuario en el diálogo del sistema: la interfaz no puede pasar ninguna.
// - Exportar lee la configuración guardada (no la que mande la interfaz), así que solo puede salir la lista blanca.
// - Importar comprueba el tamaño antes de leer, solo acepta un fichero normal y no aplica nada: devuelve la vista previa y
//   la configuración mezclada para que la interfaz pregunte.
import fs from "node:fs";
import path from "node:path";
import { dialog as electronDialog } from "electron";
import { t } from "./i18n.js";
import { exportFcConfigText, importFcConfig, FC_SHARE_MAX_BYTES } from "./fc-share.js";

export const FC_SHARE_DEFAULT_NAME = "evex-fc-config.json";

const shareFail = (code) => Object.assign(new Error(`fc-share:${code}`), { code });

// Se abre UNA vez y todo (es un fichero normal, cuánto ocupa, leerlo) va sobre lo abierto: el fichero no puede cambiar
// entre la comprobación y la lectura. Nunca se lee más del máximo, aunque crezca mientras tanto.
export async function readSmallFile(file, max = FC_SHARE_MAX_BYTES) {
  const fh = await fs.promises.open(file, "r");
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw shareFail("bad-json");
    if (st.size > max) throw shareFail("too-big");
    const buf = Buffer.alloc(max + 1);
    let n = 0;
    for (;;) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, n);
      if (!bytesRead) break;
      n += bytesRead;
      if (n > max) throw shareFail("too-big");
    }
    return buf.subarray(0, n).toString("utf8");
  } finally {
    await fh.close();
  }
}
const filters = () => [{ name: t("Configuración del Modo FC"), extensions: ["json"] }];

// getFcMode: () => fcMode guardado. dialog se puede cambiar en los tests.
export function registerFcShareIpc(handle, { getWin = () => null, getFcMode, dialog = electronDialog }) {
  // → { saved: nombre del fichero } | { canceled: true }
  handle("fc:exportFile", async () => {
    const r = await dialog.showSaveDialog(getWin(), { title: t("Exportar la configuración del Modo FC"), defaultPath: FC_SHARE_DEFAULT_NAME, filters: filters() });
    if (r.canceled || !r.filePath) return { canceled: true };
    await fs.promises.writeFile(r.filePath, exportFcConfigText(getFcMode()), "utf8");
    return { saved: path.basename(r.filePath) };
  });
  // → { file, preview, merged } | { canceled: true }. Un fichero que no vale lanza «fc-share:<código>».
  handle("fc:importFile", async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: t("Importar una configuración del Modo FC"), properties: ["openFile"], filters: filters() });
    const file = !r.canceled && r.filePaths?.[0];
    if (!file) return { canceled: true };
    return { file: path.basename(file), ...importFcConfig(await readSmallFile(file), getFcMode()) };
  });
}
