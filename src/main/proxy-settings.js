// Qué proxy usa cada conexión, a partir de la configuración guardada. Sin Electron, para poder probarlo.
// Si el proxy está activado pero incompleto, se lanza un error: nunca se conecta directo a escondidas.
import { t } from "./i18n.js";

// Proxy general (Preferencias → Red y proxy) con su contraseña, o null si está desactivado.
export async function globalProxy(settings, getPassword) {
  const g = settings?.proxy;
  if (!g?.enabled) return null;
  if (!g.host) throw Object.assign(new Error(t("El proxy general está activado pero no tiene servidor.")), { code: "PROXY_CONFIG" });
  return { type: g.type, host: g.host, port: g.port, username: g.username || "", password: (g.username && (await getPassword("global"))) || "" };
}

// Proxy de una cuenta: el suyo, ninguno o el general.
export async function accountProxy(acc, settings, getPassword) {
  const p = acc?.proxy || { mode: "global" };
  if (p.mode === "none") return null;
  if (p.mode !== "custom") return globalProxy(settings, getPassword);
  if (!p.host) throw Object.assign(new Error(t("El proxy propio de la cuenta no tiene servidor.")), { code: "PROXY_CONFIG" });
  return { type: p.type, host: p.host, port: p.port, username: p.username || "", password: (p.username && (await getPassword(acc.id))) || "" };
}

