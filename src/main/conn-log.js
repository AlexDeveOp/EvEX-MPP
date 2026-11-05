// Registro de conexión (userData/connection.log): estados, errores, avisos del servidor y motivos de cada reconexión,
// para poder explicar un corte después. Nunca lleva mensajes ni contraseñas. Va en inglés porque se pega en los
// informes de fallos. Al pasar de MAX_BYTES se guarda el anterior como connection.old.log y se empieza otro, así que
// como mucho ocupa el doble.
import fs from "node:fs";
import path from "node:path";

export const MAX_BYTES = 512 * 1024;

const sizeOf = (file) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0; // todavía no existe
  }
};

export function createConnLog(file, { maxBytes = MAX_BYTES, echo = !!process.env.EVEX_DEBUG } = {}) {
  const old = /\.log$/.test(file) ? file.replace(/\.log$/, ".old.log") : `${file}.old`;
  let size = -1;
  let dirReady = false;
  return (accountId, text) => {
    const line = `${new Date().toISOString()} [${accountId}] ${text}\n`;
    if (echo) process.stdout.write(`[connection] ${line}`);
    const bytes = Buffer.byteLength(line);
    try {
      if (!dirReady) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        dirReady = true;
      }
      if (size < 0) size = sizeOf(file);
      if (size > 0 && size + bytes > maxBytes) {
        try {
          fs.renameSync(file, old);
        } catch {
          // Si no se puede renombrar (Windows: otro programa lo tiene abierto), se vacía para no dejar de apuntar.
          fs.writeFileSync(file, "");
        }
        size = 0;
      }
      fs.appendFileSync(file, line);
      size += bytes;
    } catch {
      size = -1; // sin disco o sin permiso: el registro no debe romper la conexión
      dirReady = false;
    }
  };
}

// Resumen de un error sin el texto de ninguna stanza.
export function describeForLog(err) {
  if (!err) return "";
  const parts = [err.condition, err.code, err.name !== "Error" ? err.name : "", err.message].filter(Boolean);
  return [...new Set(parts)].join(" · ").slice(0, 300);
}
