// Diferencias entre sistemas operativos en la interfaz: textos, opciones que solo existen en Windows y el llavero
// de Linux, donde se guardan cifradas las contraseñas. Los datos llegan del proceso principal en init.system.
import { S } from "./state.js";
import { confirmDialog, toast } from "./dom.js";

import { t } from "./i18n.js";
export const isWindows = () => S.system.platform === "win32";
export const isLinux = () => S.system.platform === "linux";
// Sin llavero, Electron solo podría guardar las contraseñas casi en claro: entonces no se guardan.
export const noKeyring = () => isLinux() && S.system.secretStorage === "basic_text";
export const trayAvailable = () => S.system.trayAvailable !== false;

// Texto para Windows o para el resto (cada variante con su propio t() para que la comprobación de traducciones lo vea).
export const onWindows = (win, other) => (isWindows() ? win : other);

// Dónde se cifra la contraseña, para las casillas de «Recordar contraseña».
export function passwordStoreHint() {
  if (isWindows()) return t("cifrada con Windows");
  if (noKeyring()) return t("no disponible: no hay ningún llavero en este sistema");
  return t("cifrada con el llavero del sistema");
}

const KEYRING_SEEN = "evex.keyringNoticeSeen";

// Explica por qué no se ha guardado la contraseña en un Linux sin llavero.
export function noKeyringNotice() {
  toast(t("La contraseña no se ha guardado: este sistema no tiene llavero y EvEX-MPP nunca la guarda sin cifrar. Tendrás que escribirla al conectar. Para guardarla, instala un llavero (por ejemplo, sudo apt install gnome-keyring) y vuelve a abrir EvEX-MPP."), { kind: "warn", timeout: 15000, icon: "key-round" });
}

// Antes de guardar una contraseña. En Linux avisa (una vez) de que el sistema pedirá crear o desbloquear el llavero;
// sin llavero no deja guardarla. Devuelve true si se puede guardar.
export async function mayRememberPassword() {
  if (!isLinux()) return true;
  if (noKeyring()) {
    noKeyringNotice();
    return false;
  }
  try {
    if (localStorage.getItem(KEYRING_SEEN)) return true;
  } catch {}
  const ok = await confirmDialog({
    title: t("Guardar la contraseña en el llavero"),
    message: t("Linux te pedirá ahora crear o desbloquear tu llavero (GNOME Keyring, KWallet…) para guardar la contraseña cifrada. Si cancelas, no se guarda y tendrás que escribirla al conectar."),
    okLabel: t("Continuar"),
  });
  if (ok) {
    try {
      localStorage.setItem(KEYRING_SEEN, "1");
    } catch {}
  }
  return ok;
}

// Tras account:save: si el proceso principal no pudo guardar la contraseña (sin llavero), se explica.
export function afterAccountSave(saved) {
  if (saved?.passwordNotSaved === "no-keyring") noKeyringNotice();
  if (saved?.proxyPasswordInMemory) toast(t("La contraseña del proxy se recordará solo hasta cerrar la app: este sistema no tiene llavero."), { kind: "info", timeout: 8000, icon: "key-round" });
  return saved;
}
