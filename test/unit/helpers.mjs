// Utilidades comunes de los tests.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Ajustes de la interfaz con los valores por defecto relevantes para formatear mensajes.
export const TEST_SETTINGS = {
  emojiStyle: "native",
  emoticonToEmoji: true,
  jumboEmoji: true,
  customEmoji: [],
  showSeconds: false,
  timeFormat: "24",
  behavior: { linkPreviewMode: "auto" },
};

export function tempDir(t, prefix = "evex-test-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
