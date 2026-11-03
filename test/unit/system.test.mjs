import { test } from "node:test";
import assert from "node:assert/strict";
import { S } from "../../src/renderer/js/state.js";
import { isWindows, isLinux, noKeyring, trayAvailable, onWindows, passwordStoreHint, mayRememberPassword, afterAccountSave } from "../../src/renderer/js/system.js";

const as = (system) => (S.system = { platform: "win32", secretStorage: "os", trayAvailable: true, ...system });

test("sin init.system se comporta como Windows (valores por defecto)", () => {
  assert.deepEqual(S.system, { platform: "win32", secretStorage: "os", trayAvailable: true });
  assert.equal(isWindows(), true);
  assert.equal(onWindows("w", "o"), "w");
  assert.equal(passwordStoreHint(), "cifrada con Windows");
});

test("Linux con llavero, sin llavero y sin bandeja", () => {
  as({ platform: "linux", secretStorage: "gnome_libsecret" });
  assert.equal(isLinux(), true);
  assert.equal(noKeyring(), false);
  assert.equal(onWindows("w", "o"), "o");
  assert.equal(passwordStoreHint(), "cifrada con el llavero del sistema");
  as({ platform: "linux", secretStorage: "basic_text", trayAvailable: false });
  assert.equal(noKeyring(), true);
  assert.equal(trayAvailable(), false);
  assert.match(passwordStoreHint(), /no hay ningún llavero/);
  as({ platform: "win32", secretStorage: "basic_text" });
  assert.equal(noKeyring(), false, "basic_text solo cuenta en Linux");
});

test("mayRememberPassword: en Windows siempre; en Linux, tras aceptar el aviso una vez", async () => {
  as({});
  assert.equal(await mayRememberPassword(), true);
  as({ platform: "linux", secretStorage: "kwallet6" });
  localStorage.setItem("evex.keyringNoticeSeen", "1");
  assert.equal(await mayRememberPassword(), true);
  localStorage.removeItem("evex.keyringNoticeSeen");
});

test("afterAccountSave devuelve la cuenta tal cual", () => {
  as({});
  const acc = { id: "a", hasPassword: true };
  assert.equal(afterAccountSave(acc), acc);
});
