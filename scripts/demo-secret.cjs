// Para npm run demo: guarda cifrada la contraseña de la cuenta de demostración en secrets.json del perfil de la demo,
// igual que lo hace la app (safeStorage de Electron). Así la demo conecta sola, sin pedir la contraseña.
// Uso (lo lanza scripts/demo.mjs): electron scripts/demo-secret.cjs <carpeta del perfil> <id de la cuenta> <contraseña>
// La clave de cifrado de Chromium se guarda en «Local State» de la carpeta de datos: por eso se usa la misma carpeta
// que usará la app (EVEX_USERDATA = el perfil de la demo) y el mismo nombre de aplicación (en Linux, el llavero).
const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const [profile, accountId, password] = process.argv.slice(-3);
const pkg = require(path.join(__dirname, "..", "package.json"));
app.setName(pkg.productName || pkg.name);
app.setPath("userData", path.resolve(profile));

app.whenReady().then(async () => {
  try {
    const enc = (await safeStorage.encryptStringAsync(password)).toString("base64");
    fs.writeFileSync(path.join(profile, "secrets.json"), JSON.stringify({ [accountId]: { enc } }, null, 2));
  } catch (e) {
    console.log(`demo: no se pudo guardar la contraseña (${e.message}); la app la pedirá: test`);
  } finally {
    app.quit();
  }
});
