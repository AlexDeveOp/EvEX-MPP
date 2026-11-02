// Comprueba la sintaxis de todos los ficheros JavaScript del proyecto (sin ejecutarlos).
// Uso: npm run check
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dirs = ["src", "scripts", "test"];
const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(m?js|cjs)$/.test(entry.name)) files.push(full);
  }
};
for (const d of dirs) walk(path.join(root, d));

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    failed++;
    console.error(`✗ ${path.relative(root, file)}\n${err.stderr?.toString() || err.message}`);
  }
}
console.log(`${files.length - failed}/${files.length} ficheros correctos`);
process.exit(failed ? 1 : 0);
