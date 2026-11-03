// fetch para el proceso principal sobre net.request de Electron. Usa la red de Chromium igual que net.fetch (proxy,
// caché, redirecciones), pero además responde al evento «login»: el puente local del proxy pide credenciales y
// net.fetch no sabe darlas (comprobado en Electron 45: ante un 407 no emite «login»).
// Devuelve un Response estándar con el cuerpo ya leído (como mucho maxBytes).
import { net } from "electron";
import { t } from "./i18n.js";

const NO_BODY = new Set([101, 204, 205, 304]);

// getProxyAuth(authInfo) → { username, password } para ese proxy, o null para no dar credenciales.
export function createNetFetch(getProxyAuth, { maxBytes = 64 * 1024 * 1024 } = {}) {
  return (url, opts = {}) =>
    new Promise((resolve, reject) => {
      const signal = opts.signal;
      if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      const req = net.request({ url: String(url), method: opts.method || "GET", redirect: opts.redirect === "manual" ? "manual" : "follow" });
      for (const [k, v] of Object.entries(opts.headers || {})) req.setHeader(k, v);
      let done = false;
      const fail = (err) => {
        if (done) return;
        done = true;
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      };
      const onAbort = () => {
        req.abort();
        fail(signal.reason ?? new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      // Solo se dan credenciales a un proxy que las pida y que sea el nuestro; a un servidor web, nunca.
      req.on("login", (info, callback) => {
        const auth = info.isProxy ? getProxyAuth(info) : null;
        if (auth) callback(auth.username, auth.password);
        else callback();
      });
      req.on("response", (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (d) => {
          size += d.length;
          if (size > maxBytes) {
            req.abort();
            return fail(new Error(t("La respuesta es demasiado grande.")));
          }
          chunks.push(d);
        });
        res.on("end", () => {
          if (done) return;
          done = true;
          signal?.removeEventListener("abort", onAbort);
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers)) for (const x of [].concat(v)) headers.append(k, x);
          const status = res.statusCode;
          resolve(new Response(NO_BODY.has(status) ? null : Buffer.concat(chunks), { status, statusText: res.statusMessage || "", headers }));
        });
        res.on("error", fail);
      });
      req.on("error", fail);
      req.end();
    });
}
