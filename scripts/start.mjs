// Lanza Electron sin ELECTRON_RUN_AS_NODE (VS Code y otras apps Electron la definen y rompen el arranque).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [root, ...process.argv.slice(2)], { stdio: "inherit", env, windowsHide: false });
child.on("exit", (code) => process.exit(code ?? 0));
