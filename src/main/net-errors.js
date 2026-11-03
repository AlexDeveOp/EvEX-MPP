// Errores de red de Chromium («net::ERR_…») en palabras, para las descargas del proceso principal (net-fetch.js).
import { t } from "./i18n.js";

const PROXY = new Set(["ERR_TUNNEL_CONNECTION_FAILED", "ERR_PROXY_CONNECTION_FAILED", "ERR_PROXY_AUTH_REQUESTED", "ERR_PROXY_AUTH_UNSUPPORTED", "ERR_MANDATORY_PROXY_CONFIGURATION_FAILED", "ERR_PROXY_CERTIFICATE_INVALID"]);

// Devuelve un Error con el mensaje traducido (y .code = "ERR_…"), o el mismo error si no se reconoce.
export function describeNetError(err) {
  const code = /\bnet::(ERR_[A-Z_]+)/.exec(String(err?.message || err))?.[1];
  if (!code) return err;
  let message;
  if (PROXY.has(code)) message = t("No se ha podido salir por el proxy configurado. Pruébalo en Preferencias → Red y proxy.");
  else if (code === "ERR_NAME_NOT_RESOLVED") message = t("No se encuentra el servidor.");
  else if (code === "ERR_INTERNET_DISCONNECTED") message = t("No hay conexión a Internet.");
  else if (code === "ERR_CONNECTION_TIMED_OUT" || code === "ERR_TIMED_OUT") message = t("Tiempo de espera agotado.");
  else if (code === "ERR_CONNECTION_REFUSED") message = t("El servidor rechazó la conexión.");
  else return err;
  return Object.assign(new Error(message, { cause: err }), { code });
}
