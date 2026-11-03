// Diferencias entre sistemas: rutas de Pidgin, fuentes de fontconfig, inicio automático en Linux y llavero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { purpleDirFor, pidginSoundDirsFor, parseFcList, autostartFile, autostartExec, desktopEntry, linuxStorageKind, hasSecureStorage } from "../../src/main/platform.js";

test("la carpeta de Pidgin es %APPDATA%\\.purple en Windows y ~/.purple en Linux", () => {
  assert.equal(purpleDirFor({ platform: "win32", env: { APPDATA: "C:\\Users\\x\\AppData\\Roaming" } }), "C:\\Users\\x\\AppData\\Roaming\\.purple");
  assert.equal(purpleDirFor({ platform: "linux", env: {}, home: "/home/x" }), "/home/x/.purple");
  assert.equal(purpleDirFor({ platform: "linux", env: { HOME: "/home/y" } }), "/home/y/.purple");
  assert.equal(purpleDirFor({ platform: "linux", env: { EVEX_PURPLE_DIR: "/tmp/falso" }, home: "/home/x" }), "/tmp/falso", "EVEX_PURPLE_DIR manda en las pruebas");
});

test("los sonidos de Pidgin se buscan en Archivos de programa o en /usr/share/sounds/purple", () => {
  assert.deepEqual(pidginSoundDirsFor({ platform: "win32", env: { ProgramFiles: "C:\\Program Files" } }), ["C:\\Program Files\\Pidgin\\sounds\\purple"]);
  assert.ok(pidginSoundDirsFor({ platform: "linux", env: {} }).includes("/usr/share/sounds/purple"));
});

test("fc-list: una familia por fuente, sin repetir, sin las ocultas y en orden", () => {
  const out = ["DejaVu Sans,DejaVu Sans Condensed", "Noto Sans", "DejaVu Sans", ".LastResort", "Liberation Mono", "Noto\\-Emoji", ""].join("\n");
  assert.deepEqual(parseFcList(out), ["DejaVu Sans", "Liberation Mono", "Noto Sans", "Noto-Emoji"]);
  assert.deepEqual(parseFcList(""), []);
});

test("el inicio automático en Linux es un .desktop en ~/.config/autostart que arranca oculta", () => {
  assert.equal(autostartFile("/home/x"), "/home/x/.config/autostart/evex-mpp.desktop");
  const entry = desktopEntry({ exe: "/home/x/Apps/EvEX-MPP-0.7.0.AppImage", args: ["--hidden"] });
  assert.match(entry, /^\[Desktop Entry\]\n/);
  assert.match(entry, /^Exec=\/home\/x\/Apps\/EvEX-MPP-0\.7\.0\.AppImage --hidden$/m);
  assert.match(entry, /^Type=Application$/m);
  assert.match(entry, /^Icon=evex-mpp$/m, "mismo icono que el .desktop del paquete");
});

test("el inicio automático apunta al .AppImage original o al ejecutable instalado, nunca a una carpeta temporal", () => {
  assert.equal(autostartExec({ appImage: "/home/x/Apps/EvEX-MPP.AppImage", execPath: "/tmp/.mount_EvEXabc/evex-mpp" }), "/home/x/Apps/EvEX-MPP.AppImage");
  assert.equal(autostartExec({ appImage: "", execPath: "/opt/EvEX-MPP/evex-mpp" }), "/opt/EvEX-MPP/evex-mpp", ".deb");
  assert.equal(autostartExec({ appImage: "", execPath: "/tmp/.mount_EvEXabc/evex-mpp" }), null, "AppImage montado sin APPIMAGE");
  assert.equal(autostartExec({ appImage: "", execPath: "/tmp/appimage_extracted_123/evex-mpp" }), null, "--appimage-extract-and-run");
});

test("una ruta con espacios o comillas va entre comillas y escapada en Exec", () => {
  const entry = desktopEntry({ exe: '/home/x/Mis Apps/Ev"X.AppImage', args: ["--hidden"] });
  assert.match(entry, /^Exec="\/home\/x\/Mis Apps\/Ev\\"X\.AppImage" --hidden$/m);
});

// Comprobado en Linux con Electron 45: con GNOME Keyring el cifrado empieza por "v11"; con --password-store=basic, "v10".
test("en Linux solo hay almacenamiento seguro si el cifrado usa la clave del llavero (v11)", () => {
  assert.equal(linuxStorageKind("v11"), "keyring");
  assert.equal(linuxStorageKind("v10"), "basic_text");
  assert.equal(linuxStorageKind(""), "basic_text");
  assert.equal(hasSecureStorage("os"), true);
  assert.equal(hasSecureStorage("keyring"), true);
  assert.equal(hasSecureStorage("basic_text"), false);
  assert.equal(hasSecureStorage(undefined), false);
});
