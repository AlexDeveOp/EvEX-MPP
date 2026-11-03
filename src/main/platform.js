// Diferencias entre sistemas (Windows, Linux) en funciones puras: rutas de Pidgin, fuentes, inicio automático y llavero.
// Reciben el sistema y el entorno como parámetros para poder probarlas en cualquier plataforma.
import path from "node:path";

// Carpeta de datos de Pidgin: %APPDATA%\.purple en Windows y ~/.purple en Linux.
export function purpleDirFor({ platform = process.platform, env = process.env, home = "" } = {}) {
  if (env.EVEX_PURPLE_DIR) return env.EVEX_PURPLE_DIR;
  if (platform === "win32") return path.win32.join(env.APPDATA || "", ".purple");
  return path.posix.join(home || env.HOME || "", ".purple");
}

// Carpetas donde Pidgin deja sus sonidos: Archivos de programa en Windows y el paquete del sistema en Linux.
export function pidginSoundDirsFor({ platform = process.platform, env = process.env } = {}) {
  if (platform === "win32") {
    return [env["ProgramFiles(x86)"], env.ProgramFiles, env.ProgramW6432].filter(Boolean).map((p) => path.win32.join(p, "Pidgin", "sounds", "purple"));
  }
  return ["/usr/share/sounds/purple", "/usr/local/share/sounds/purple"];
}

// Salida de `fc-list : family` (una línea por fuente, con los nombres traducidos separados por comas) → familias únicas.
export function parseFcList(out) {
  const names = new Set();
  for (const line of String(out || "").split(/\r?\n/)) {
    const fam = line.split(",")[0].replace(/\\-/g, "-").trim();
    if (fam && !fam.startsWith(".")) names.add(fam);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

// Inicio automático en Linux: un .desktop en ~/.config/autostart (estándar de freedesktop.org).
export function autostartFile(home) {
  return path.posix.join(home, ".config", "autostart", "evex-mpp.desktop");
}

// Las rutas con espacios van entre comillas; dentro de ellas se escapan las comillas y las barras.
const quoteExec = (s) => (/[\s"\\`$]/.test(s) ? `"${s.replace(/(["\\`$])/g, "\\$1")}"` : s);

export function desktopEntry({ exe, args = [] }) {
  return ["[Desktop Entry]", "Type=Application", "Name=EvEX-MPP", "Comment=XMPP chat client", `Exec=${[exe, ...args].map(quoteExec).join(" ")}`, "Terminal=false", "X-GNOME-Autostart-enabled=true", ""].join("\n");
}

// Dónde guarda las contraseñas el sistema: "os" en Windows y macOS; en Linux, el llavero que haya elegido Chromium.
// "basic_text" significa que no hay llavero: las contraseñas solo quedarían ofuscadas, así que no se guardan.
export function secretStorageKind({ platform = process.platform, backend = "" } = {}) {
  if (platform !== "linux") return "os";
  return backend || "unknown";
}

export const hasSecureStorage = (kind) => kind !== "basic_text" && kind !== "unknown";
