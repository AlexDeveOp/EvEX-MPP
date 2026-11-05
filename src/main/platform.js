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
  return ["[Desktop Entry]", "Type=Application", "Name=EvEX-MPP", "Comment=XMPP chat client", `Exec=${[exe, ...args].map(quoteExec).join(" ")}`, "Icon=evex-mpp", "Terminal=false", "X-GNOME-Autostart-enabled=true", ""].join("\n");
}

// Qué ejecutar al iniciar sesión: el fichero .AppImage si se conoce, o el ejecutable instalado (.deb). Un AppImage
// extraído o montado vive en /tmp y desaparece al cerrar: entonces no hay ruta fiable (null).
export function autostartExec({ appImage = "", execPath = "" } = {}) {
  if (appImage) return appImage;
  if (!execPath || /^\/tmp\/(\.mount_|appimage_extracted_)/.test(execPath)) return null;
  return execPath;
}

// Dónde guarda las contraseñas el sistema: "os" en Windows y macOS; en Linux, "keyring" o "basic_text".
// En Linux se mira el prefijo de un texto cifrado de prueba: "v11" = clave guardada en el llavero (GNOME Keyring,
// KWallet); "v10" = clave fija de Chromium, la misma en todos los equipos, es decir, sin llavero. No sirve
// safeStorage.getSelectedStorageBackend(): con el cifrado asíncrono de Electron siempre dice "basic_text".
export function linuxStorageKind(prefix) {
  return prefix === "v11" ? "keyring" : "basic_text";
}

export const hasSecureStorage = (kind) => kind === "os" || kind === "keyring";

// Versión de la Microsoft Store (MSIX). Windows la instala en WindowsApps\<nombre completo del paquete>\app\, y ese
// nombre es «Nombre_Versión_Arquitectura_Recurso_IdEditor». Lo que la app escribe en %APPDATA% acaba en
// %LOCALAPPDATA%\Packages\<Nombre>_<IdEditor>\LocalCache\Roaming: el Explorador no ve esa redirección, así que «Abrir
// carpeta de datos» tiene que abrir la carpeta real. Devuelve null fuera de un paquete.
export function storePackageFamily(execPath) {
  const parts = String(execPath || "").split(/[\\/]/);
  const i = parts.findIndex((p) => p.toLowerCase() === "windowsapps");
  const full = i >= 0 ? parts[i + 1] : "";
  const m = /^([^_]+)_[^_]+_[^_]+_[^_]*_([a-z0-9]{13})$/i.exec(full || "");
  return m ? `${m[1]}_${m[2]}` : null;
}

export function storeUserDataDir({ execPath, localAppData, userData }) {
  const family = storePackageFamily(execPath);
  if (!family || !localAppData || !userData) return null;
  const roaming = /[\\/]AppData[\\/]Roaming[\\/](.+)$/i.exec(userData);
  if (!roaming) return null;
  return path.win32.join(localAppData, "Packages", family, "LocalCache", "Roaming", roaming[1]);
}
