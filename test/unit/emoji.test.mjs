import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { S } from "../../src/renderer/js/state.js";
import { emojiImageUrl, emojifyHtml } from "../../src/renderer/js/emoji.js";
import { BUNDLED_ANIMATED } from "../../src/renderer/js/data/emoji-anim.js";
import { TEST_SETTINGS } from "./helpers.mjs";

const assetsDir = fileURLToPath(new URL("../../src/renderer/assets/emoji-anim/", import.meta.url));
// Un emoji sin animación incluida (🦩 flamenco) para comprobar la reserva.
const RARE = "\u{1F9A9}";

beforeEach(() => {
  S.settings = { ...structuredClone(TEST_SETTINGS), emojiStyle: "noto-animated", downloadEmoji: false };
});

test("cada emoji animado incluido tiene su fichero y viceversa", () => {
  const files = fs.readdirSync(assetsDir).filter((f) => f.endsWith(".webp")).map((f) => f.slice(0, -5));
  assert.ok(BUNDLED_ANIMATED.size >= 100, `solo ${BUNDLED_ANIMATED.size}`);
  assert.deepEqual(files.sort(), [...BUNDLED_ANIMATED].sort());
});

test("los emojis incluidos se cargan de la app, sin conexión", () => {
  assert.ok(BUNDLED_ANIMATED.has("1f44d"));
  assert.equal(emojiImageUrl("👍"), "assets/emoji-anim/1f44d.webp");
  // ❤️ lleva FE0F: el fichero se llama sin él.
  assert.ok(BUNDLED_ANIMATED.has("2764"));
  assert.equal(emojiImageUrl("❤️"), "assets/emoji-anim/2764.webp");
});

test("sin permiso de descarga, los que no vienen con la app se muestran con el emoji de Windows", () => {
  assert.ok(!BUNDLED_ANIMATED.has(RARE.codePointAt(0).toString(16)));
  assert.equal(emojiImageUrl(RARE), null);
  const html = emojifyHtml(`hola ${RARE} 👍`);
  assert.ok(html.includes(`<span class="emoji-native">${RARE}</span>`), html);
  assert.ok(html.includes('src="assets/emoji-anim/1f44d.webp"'), html);
  assert.ok(!html.includes("https://"), "no debe pedir nada a Internet");
});

test("con permiso de descarga, los que faltan se piden a Google", () => {
  S.settings.downloadEmoji = true;
  assert.equal(emojiImageUrl(RARE), `https://fonts.gstatic.com/s/e/notoemoji/latest/${RARE.codePointAt(0).toString(16)}/512.webp`);
  assert.equal(emojiImageUrl("👍"), "assets/emoji-anim/1f44d.webp");
});

test("los estilos Noto estático y Twemoji siguen viniendo de Internet, y el nativo no usa imágenes", () => {
  assert.match(emojiImageUrl("👍", "noto"), /^https:\/\/fonts\.gstatic\.com\/.+\/1f44d\/emoji\.svg$/);
  assert.match(emojiImageUrl("👍", "twemoji"), /^https:\/\/cdn\.jsdelivr\.net\/.+\/1f44d\.svg$/);
  assert.equal(emojifyHtml("👍", "native"), '<span class="emoji-native">👍</span>');
});
