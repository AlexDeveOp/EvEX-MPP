// npm run demo: abre EvEX-MPP con datos de ejemplo para revisar toda la interfaz, sin tocar tu perfil ni conectarse a
// ningún servidor real.
// - Crea un perfil nuevo en la carpeta temporal del sistema (evex-demo-<fecha>) con test/demo/profile.mjs. Con
//   «npm run demo -- --keep» reutiliza el último. Se guardan como mucho los 3 últimos; solo se borran carpetas
//   evex-demo-* de la carpeta temporal.
// - Arranca el servidor simulado (test/mock-xmpp.mjs con MOCK_DEMO=1, solo en 127.0.0.1) en un puerto libre.
// - Lanza la app con EVEX_USERDATA apuntando al perfil (como scripts/start.mjs, sin ELECTRON_RUN_AS_NODE).
// - Al cerrar la app (o con Ctrl+C) cierra el servidor simulado que lanzó, y nada más.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { writeDemoProfile, DEMO_ACCOUNT, DEMO_PASSWORD } from "../test/demo/profile.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PREFIX = "evex-demo-";
const KEEP_PROFILES = 3;

// Perfiles de demo de la carpeta temporal, del más reciente al más antiguo. Solo carpetas de verdad (no enlaces).
export function demoProfiles(base = os.tmpdir()) {
  let names;
  try {
    names = fs.readdirSync(base);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.startsWith(PREFIX))
    .map((n) => path.join(base, n))
    .filter((p) => {
      try {
        return fs.lstatSync(p).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

// Deja los `keep` perfiles de demo más recientes y borra los demás. Nunca toca nada sin el prefijo ni fuera de base.
export function pruneDemoProfiles(base = os.tmpdir(), keep = KEEP_PROFILES, current = "") {
  const removed = [];
  const others = demoProfiles(base).filter((p) => p !== current);
  for (const p of others.slice(Math.max(0, keep - (current ? 1 : 0)))) {
    if (path.dirname(p) !== path.resolve(base) || !path.basename(p).startsWith(PREFIX)) continue;
    fs.rmSync(p, { recursive: true, force: true });
    removed.push(p);
  }
  return removed;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function run(cmd, args, opts) {
  return new Promise((resolve) => spawn(cmd, args, opts).on("exit", (code) => resolve(code)));
}

async function main() {
  const keep = process.argv.includes("--keep");
  const base = os.tmpdir();
  const port = await freePort();
  let profile = keep ? demoProfiles(base)[0] : null;
  if (profile) {
    // El puerto cambia en cada arranque.
    const file = path.join(profile, "config.json");
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const a of cfg.accounts || []) if (a.id === DEMO_ACCOUNT) a.port = port;
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  } else {
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    profile = path.join(base, `${PREFIX}${stamp}`);
    writeDemoProfile(profile, { port });
  }
  pruneDemoProfiles(base, KEEP_PROFILES, profile);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // Contraseña cifrada como la guarda la app, para que la cuenta de demo conecte sola.
  if (!fs.existsSync(path.join(profile, "secrets.json"))) await run(electron, [path.join(root, "scripts", "demo-secret.cjs"), profile, DEMO_ACCOUNT, DEMO_PASSWORD], { stdio: "inherit", env, windowsHide: true });

  const log = fs.openSync(path.join(profile, "mock.log"), "a");
  const mock = spawn(process.execPath, [path.join(root, "test", "mock-xmpp.mjs")], { env: { ...env, MOCK_PORT: String(port), MOCK_DEMO: "1" }, stdio: ["ignore", log, log], windowsHide: true });
  console.log(`demo: perfil ${profile}`);
  console.log(`demo: servidor simulado en 127.0.0.1:${port} (PID ${mock.pid}); un ping nuevo llega al minuto de conectar`);

  // Para revisarla con herramientas (p. ej. test/cdp.mjs): npm run demo -- --remote-debugging-port=9333
  const extra = process.argv.slice(2).filter((x) => /^--remote-debugging-port=[0-9]+$/.test(x));
  const app = spawn(electron, [root, ...extra], { stdio: "inherit", env: { ...env, EVEX_USERDATA: profile }, windowsHide: false });
  const stop = (code) => {
    if (mock.exitCode === null) mock.kill();
    if (app.exitCode === null) app.kill();
    process.exit(code ?? 0);
  };
  app.on("exit", (code) => stop(code));
  mock.on("exit", (code) => {
    if (app.exitCode === null) console.log(`demo: el servidor simulado se ha cerrado (${code}); mira ${path.join(profile, "mock.log")}`);
  });
  process.on("SIGINT", () => stop(130));
  process.on("SIGTERM", () => stop(143));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
