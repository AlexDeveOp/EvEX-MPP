// Registro de conexión (userData/connection.log): estados, errores, avisos del servidor y motivos de cada reconexión,
// para poder explicar un corte después. Nunca lleva mensajes ni contraseñas. Va en inglés porque se pega en los
// informes de fallos. Al pasar de MAX_BYTES se guarda el anterior como connection.old.log y se empieza otro, así que
// como mucho ocupa el doble.
import fs from "node:fs";
import path from "node:path";

export const MAX_BYTES = 512 * 1024;

export function createConnLog(file, { maxBytes = MAX_BYTES, echo = !!process.env.EVEX_DEBUG } = {}) {
  let size = -1;
  return (accountId, text) => {
    const line = `${new Date().toISOString()} [${accountId}] ${text}\n`;
    if (echo) process.stdout.write(`[connection] ${line}`);
    try {
      if (size < 0) size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      if (size + line.length > maxBytes) {
        fs.renameSync(file, file.replace(/\.log$/, ".old.log"));
        size = 0;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, line);
      size += Buffer.byteLength(line);
    } catch {
      size = -1; // sin disco o sin permiso: el registro no debe romper la conexión
    }
  };
}

// Resumen de un error sin el texto de ninguna stanza.
export function describeForLog(err) {
  if (!err) return "";
  const parts = [err.condition, err.code, err.name !== "Error" ? err.name : "", err.message].filter(Boolean);
  return [...new Set(parts)].join(" · ").slice(0, 300);
}
