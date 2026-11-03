// Comprueba, al final de `npm run dist`, que empaquetar no ha modificado ficheros versionados de build/
// (p. ej. las páginas de licencia, a las que electron-builder añade el BOM si les falta).
// Fuera de un repositorio git (código descargado sin .git) no comprueba nada.
import { execFileSync } from "node:child_process";

let out;
try {
  out = execFileSync("git", ["status", "--porcelain", "--", "build/"], { encoding: "utf8" });
} catch {
  console.log("check-build-clean: sin git, no se comprueba");
  process.exit(0);
}
if (out.trim()) {
  console.error("El empaquetado ha modificado ficheros de build/ (no les hagas commit; restáuralos con git checkout):\n" + out);
  process.exit(1);
}
console.log("check-build-clean: build/ sin cambios");
