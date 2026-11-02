// Aviso de versión nueva (opcional y desactivado por defecto). Solo consulta la última release publicada en GitHub;
// no descarga ni instala nada: el usuario decide si abre la página de la versión.
import { t } from "./i18n.js";

const API = (repo) => `https://api.github.com/repos/${repo}/releases/latest`;

// "v1.2.3" o "1.2.3-beta.1" → [1, 2, 3, "beta.1"]; null si no es una versión.
export function parseVersion(v) {
  const m = String(v || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
  return m ? [+m[1], +m[2], +m[3], m[4] || ""] : null;
}

// > 0 si a es más nueva que b, < 0 si es más antigua, 0 si son iguales (SemVer; una prerelease es anterior a la final).
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(t("Versión no válida: {version}", { version: !x ? a : b }));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  if (x[3] === y[3]) return 0;
  if (!x[3]) return 1;
  if (!y[3]) return -1;
  return x[3].localeCompare(y[3], "en", { numeric: true });
}

const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

// "https://github.com/owner/repo.git" o "git+https://…" → "owner/repo".
export function repoFromUrl(url) {
  const m = String(url || "").match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

// Devuelve { latest, url, newer } o lanza un error con un mensaje legible.
export async function checkForUpdates({ currentVersion, repo, fetchImpl = fetch, timeoutMs = 15000 }) {
  if (!REPO_RE.test(String(repo))) throw new Error(t("No se conoce el repositorio de la app."));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(API(repo), { headers: { Accept: "application/vnd.github+json", "User-Agent": "EvEX-MPP" }, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(t("GitHub respondió con el código {status}", { status: res.status }));
  const rel = await res.json();
  if (rel.draft || rel.prerelease) return { latest: currentVersion, url: "", newer: false };
  const latest = String(rel.tag_name || "").replace(/^v/, "");
  if (!parseVersion(latest)) throw new Error(t("Versión no válida en GitHub: {version}", { version: rel.tag_name }));
  // Solo se abren enlaces a la propia página de releases del repositorio.
  const url = String(rel.html_url || "").startsWith(`https://github.com/${repo}/releases/`) ? rel.html_url : `https://github.com/${repo}/releases/latest`;
  return { latest, url, newer: compareVersions(latest, currentVersion) > 0 };
}
