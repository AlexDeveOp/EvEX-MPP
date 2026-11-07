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
    const st = await fs.promises.stat(file);
    if (!st.isFile()) throw Object.assign(new Error("fc-share:bad-json"), { code: "bad-json" });
    if (st.size > FC_SHARE_MAX_BYTES) throw Object.assign(new Error("fc-share:too-big"), { code: "too-big" });
    const text = await fs.promises.readFile(file, "utf8");
    return { file: path.basename(file), ...importFcConfig(text, getFcMode()) };
  });
}
