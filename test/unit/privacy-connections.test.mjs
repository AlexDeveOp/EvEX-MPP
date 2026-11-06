// Guarda de la lista pública de conexiones (PRIVACY.md, «Network connections» / «Conexiones de red»):
// toda dirección http(s) fija del código tiene que salir en las dos versiones de la política. Si alguien añade una
// conexión nueva sin documentarla, este test falla. Así se puede responder en una línea a «¿llama a casa?».
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const privacy = fs.readFileSync(path.join(root, "PRIVACY.md"), "utf8");
const [en, es] = privacy.split(/^# Política de privacidad$/m);

// No son conexiones: espacios de nombres de XMPP (identificadores con forma de URL que nunca se descargan).
const NOT_CONNECTIONS = new Set(["jabber.org"]);
// Ficheros que no son código de la app: traducciones y datos generados.
const SKIP = [path.join("src", "renderer", "locales"), path.join("src", "renderer", "js", "data")];

function* sourceFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.some((s) => p.includes(s))) continue;
    if (e.isDirectory()) yield* sourceFiles(p);
    else if (/\.(m?js|cjs|html)$/.test(e.name)) yield p;
  }
}

// Dominios de todas las direcciones http(s) escritas en el código (incluidas las de plantillas `https://x/${…}`).
function codeHosts() {
  const hosts = new Map();
  for (const file of sourceFiles(path.join(root, "src"))) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
      const host = m[1].toLowerCase();
      // Ejemplos y direcciones locales (p. ej. el reenviador del proxy en 127.0.0.1): no salen del PC.
      if (/(^|\.)(example|ejemplo)\.(com|org|net)$/.test(host) || host.endsWith(".local") || host === "localhost" || /^127\.\d+\.\d+\.\d+$/.test(host)) continue;
      if (!hosts.has(host)) hosts.set(host, path.relative(root, file));
    }
  }
  return hosts;
}

test("PRIVACY.md tiene las dos versiones, inglés y español", () => {
  assert.ok(en.includes("## Network connections"));
  assert.ok(es?.includes("## Conexiones de red"));
});

test("cada dominio al que apunta el código sale en la lista de conexiones, en inglés y en español", () => {
  const hosts = codeHosts();
  assert.ok(hosts.size >= 5, "el escaneo encuentra las direcciones del código");
  const missing = [];
  for (const [host, file] of hosts) {
    if (NOT_CONNECTIONS.has(host)) continue;
    if (!en.includes(host)) missing.push(`${host} (en ${file}) falta en la versión inglesa`);
    if (!es.includes(host)) missing.push(`${host} (en ${file}) falta en la versión española`);
  }
  assert.deepEqual(missing, [], "documenta la conexión en PRIVACY.md (tabla «Network connections» y «Conexiones de red»)");
});

test("las dos tablas de conexiones tienen las mismas filas", () => {
  const rows = (part) => {
    const table = part.split(/^## /m).find((s) => /^(Network connections|Conexiones de red)/.test(s));
    return table.split("\n").filter((l) => /^\| \*\*/.test(l)).length;
  };
  assert.equal(rows(en), rows(es));
  assert.ok(rows(en) >= 9);
});

test("las conexiones conocidas siguen documentadas (si se quita una de la app, se quita también de aquí)", () => {
  for (const host of ["api.github.com", "fonts.gstatic.com", "cdn.jsdelivr.net", "i.ytimg.com", "api.giphy.com", "api.klipy.com"]) {
    assert.ok(codeHosts().has(host), `${host} ya no está en el código: revisa la tabla de PRIVACY.md`);
  }
});
