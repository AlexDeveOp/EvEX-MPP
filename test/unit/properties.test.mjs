// Tests de propiedades (fast-check): comprueban reglas generales con miles de entradas aleatorias.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import fc from "fast-check";
import { S } from "../../src/renderer/js/state.js";
import { emojifyHtml } from "../../src/renderer/js/emoji.js";
import { esc } from "../../src/renderer/js/dom.js";
import { parseLogFile, shouldOfferRepair } from "../../src/main/pidgin-import.js";
import { TEST_SETTINGS, tempDir } from "./helpers.mjs";

beforeEach(() => {
  S.settings = { ...structuredClone(TEST_SETTINGS), emojiStyle: "noto-animated", downloadEmoji: false };
});

// Texto con emojis (incluidas banderas, ZWJ y tonos de piel), HTML y caracteres raros mezclados.
const PIECES = ["👍", "❤️", "🇪🇸", "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}", "👩‍🚀", "👋🏽", "1️⃣", "<", ">", "&", '"', "'", "<img src=x onerror=alert(1)>", "©", " ", "​"];
const messyText = fc.array(fc.oneof(fc.string({ maxLength: 8 }), fc.constantFrom(...PIECES)), { maxLength: 20 }).map((a) => a.join(""));

test("emojifyHtml nunca deja HTML del usuario sin escapar y conserva el texto", () => {
  for (const style of ["noto-animated", "noto", "twemoji", "native"]) {
    fc.assert(
      fc.property(messyText, (text) => {
        const html = emojifyHtml(esc(text), style);
        // Las únicas etiquetas son las de los emojis.
        const tags = html.match(/<[^>]*>/g) || [];
        for (const tag of tags) assert.match(tag, /^(<img class="emoji" [^<>]*>|<span class="emoji-native">|<\/span>)$/, tag);
        // Cambiando cada imagen por su alt y quitando los span, queda exactamente el texto escapado.
        const back = html.replace(/<img class="emoji" src="[^"]*" alt="([^"]*)"[^>]*>/g, "$1").replace(/<\/?span[^>]*>/g, "");
        assert.equal(back, esc(text));
      }),
      { numRuns: 300 },
    );
  }
});

test("parseLogFile lee de vuelta los mensajes de un registro de texto de Pidgin", (t) => {
  const dir = tempDir(t);
  const nick = fc.stringMatching(/^[a-z][a-z0-9_]{0,11}$/);
  const body = fc.stringMatching(/^[A-Za-z0-9¿?¡!.,;áéíóúñÑ<>&'"/ -]{1,60}$/).map((s) => s.trim()).filter((s) => s.length > 0 && !s.startsWith("/") && !s.startsWith("*"));
  const msgs = fc.array(fc.record({ nick, body, sec: fc.integer({ min: 0, max: 59 }) }), { minLength: 1, maxLength: 12 });
  let n = 0;
  fc.assert(
    fc.property(msgs, (list) => {
      // Horas crecientes dentro del mismo día, como en un registro real.
      const lines = list.map((m, i) => `(10:${String(i).padStart(2, "0")}:${String(m.sec).padStart(2, "0")}) ${m.nick}: ${m.body}`);
      const file = path.join(dir, `2026-05-04.100000+0200CEST-${n++}.txt`);
      fs.writeFileSync(file, `Conversation with sala at 04/05/2026 10:00:00 on yo@ejemplo.com (jabber)\n${lines.join("\n")}\n`);
      const parsed = parseLogFile(file, { isRoom: true });
      assert.deepEqual(parsed.map((p) => [p.nick, p.body]), list.map((m) => [m.nick, m.body]));
      for (let i = 1; i < parsed.length; i++) assert.ok(parsed[i].ts > parsed[i - 1].ts, "en orden");
      for (const p of parsed) assert.equal(new Date(p.ts).getHours(), 10);
    }),
    { numRuns: 150 },
  );
});

test("shouldOfferRepair: solo ofrece con historial antiguo, sin marcas ni copia previa y con registros de Pidgin", () => {
  const key = fc.oneof(fc.stringMatching(/^[A-Za-z0-9:/._-]{1,20}$/), fc.constantFrom("__logsRepaired", "__repairOffered", "__trayHintShown"));
  const imported = fc.dictionary(key, fc.constantFrom(1, 2));
  const entries = fc.array(fc.constantFrom("config.json", "logs", "media", "logs-copia-2026-11-03-01-21-02", "logs-copia"), { maxLength: 5 });
  fc.assert(
    fc.property(imported, entries, fc.boolean(), (imp, dataEntries, targets) => {
      const expected =
        !imp.__logsRepaired && !imp.__repairOffered && Object.entries(imp).some(([k, v]) => !k.startsWith("__") && v === 1) && !dataEntries.some((e) => e.startsWith("logs-copia-")) && targets;
      assert.equal(shouldOfferRepair({ imported: imp, dataEntries, hasTargets: () => targets }), expected);
    }),
    { numRuns: 1000 },
  );
});
