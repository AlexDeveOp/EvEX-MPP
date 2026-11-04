// Qué proxy usa cada conexión, a partir de la configuración guardada. Sin Electron, para poder probarlo.
// Si el proxy está activado pero incompleto, se lanza un error: nunca se conecta directo a escondidas.
import { t } from "./i18n.js";

// Con usuario, hace falta su contraseña: si no está (p. ej. Linux sin llavero, tras reiniciar), se lanza
// NEED_PROXY_PASSWORD para que la interfaz la pida, en vez de intentarlo sin ella y que el proxy la rechace.
async function withPassword(p, getPassword, key, label) {
  const username = p.username || "";
  if (!username) return { type: p.type, host: p.host, port: p.port, username: "", password: "" };
  const password = await getPassword(key);
  if (!password) throw Object.assign(new Error(t("Falta la contraseña del proxy {proxy}.", { proxy: label })), { code: "NEED_PROXY_PASSWORD" });
  return { type: p.type, host: p.host, port: p.port, username, password };
}

// Proxy general (Preferencias → Red y proxy) con su contraseña, o null si está desactivado.
export async function globalProxy(settings, getPassword) {
  const g = settings?.proxy;
  if (!g?.enabled) return null;
  if (!g.host) throw Object.assign(new Error(t("El proxy general está activado pero no tiene servidor.")), { code: "PROXY_CONFIG" });
  return withPassword(g, getPassword, "global", `${g.host}:${g.port}`);
}

// Proxy de una cuenta: el suyo, ninguno o el general.
export async function accountProxy(acc, settings, getPassword) {
  const p = acc?.proxy || { mode: "global" };
  if (p.mode === "none") return null;
  if (p.mode !== "custom") return globalProxy(settings, getPassword);
  if (!p.host) throw Object.assign(new Error(t("El proxy propio de la cuenta no tiene servidor.")), { code: "PROXY_CONFIG" });
  return withPassword(p, getPassword, acc.id, `${p.host}:${p.port}`);
}
