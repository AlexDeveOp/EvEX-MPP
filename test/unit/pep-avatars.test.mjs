// Avatares XEP-0084 de los contactos: capacidades (XEP-0115), elección de la imagen y prueba contra el servidor simulado.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { xml } from "@xmpp/client";
import { XmppAccount, capsVer, pickAvatarInfo, imageType } from "../../src/main/xmpp-account.js";
import { tempDir } from "./helpers.mjs";

test("capsVer: el ejemplo de XEP-0115 §5.2", () => {
  const ver = capsVer([{ category: "client", type: "pc", name: "Exodus 0.9.1" }], ["http://jabber.org/protocol/caps", "http://jabber.org/protocol/disco#info", "http://jabber.org/protocol/disco#items", "http://jabber.org/protocol/muc"]);
  assert.equal(ver, "QgayPKawpkPSDYmwT/WM94uAlu0=");
  assert.equal(capsVer([{ category: "client", type: "pc", name: "x" }], ["b", "a"]), capsVer([{ category: "client", type: "pc", name: "x" }], ["a", "b"]), "el orden no importa");
});

test("pickAvatarInfo: PNG sin url; metadatos vacíos = sin avatar", () => {
  const id = (c) => c.repeat(40);
  const meta = (...infos) => xml("metadata", { xmlns: "urn:xmpp:avatar:metadata" }, ...infos.map((a) => xml("info", a)));
  assert.equal(pickAvatarInfo(meta()), null);
  assert.equal(pickAvatarInfo(null), null);
  assert.deepEqual(pickAvatarInfo(meta({ id: id("a"), type: "image/jpeg", bytes: "100" }, { id: id("b"), type: "image/png", bytes: "100" })), { id: id("b"), type: "image/png" }, "prefiere PNG");
  assert.deepEqual(pickAvatarInfo(meta({ id: id("c"), type: "image/png", bytes: "100", url: "https://ejemplo.com/a.png" }, { id: id("d"), type: "image/gif", bytes: "100" })), { id: id("d"), type: "image/gif" }, "las de url externa no se descargan");
  assert.equal(pickAvatarInfo(meta({ id: "corto", type: "image/png" })), null, "id inválido");
  assert.equal(pickAvatarInfo(meta({ id: id("e"), type: "image/png", bytes: String(3 * 1024 * 1024) })), null, "demasiado grande");
  assert.deepEqual(pickAvatarInfo(meta({ id: id("F"), type: "image/png" })), { id: id("f"), type: "image/png" }, "hash en minúsculas");
});

test("imageType por la cabecera", () => {
  assert.equal(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47])), "image/png");
  assert.equal(imageType(Buffer.from("GIF89a")), "image/gif");
  assert.equal(imageType(Buffer.from("RIFF0000WEBP")), "image/webp");
  assert.equal(imageType(Buffer.from([0xff, 0xd8, 0xff])), "image/jpeg");
});

// ---------- contra el servidor simulado ----------

const PORT = 16600 + Math.floor(Math.random() * 400);
let mock;
before(async () => {
  mock = spawn(process.execPath, [fileURLToPath(new URL("../mock-xmpp.mjs", import.meta.url))], { env: { ...process.env, MOCK_PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    mock.once("exit", (code) => reject(new Error(`el servidor simulado terminó (${code})`)));
    mock.stdout.on("data", (d) => String(d).includes("mock XMPP en") && resolve());
  });
});
after(() => mock?.kill());

test("con +notify en las capacidades (el simulado pregunta node#ver como un servidor real) llega el avatar XEP-0084 de Alice; se descarga, cambia y se quita", async (t) => {
  const dir = tempDir(t);
  const acc = new XmppAccount({ id: "pep", jid: "pep@test.local", host: "127.0.0.1", port: PORT, security: "opportunistic" }, { avatarDir: dir, version: "1.0.0" });
  const events = [];
  acc.on("event", (e) => events.push(e));
  t.after(() => acc.disconnect(true).catch(() => {}));
  // Busca el evento entre los ya recibidos y, si no está, espera a que llegue.
  const waitFor = (pred, ms = 8000) =>
    new Promise((resolve, reject) => {
      const found = events.find(pred);
      if (found) return resolve(found);
      const timer = setTimeout(() => reject(new Error(`sin evento esperado; recibidos: ${events.map((e) => e.type).join(", ")}`)), ms);
      const onEvent = (e) => {
        if (!pred(e)) return;
        clearTimeout(timer);
        acc.off("event", onEvent);
        resolve(e);
      };
      acc.on("event", onEvent);
    });
  await acc.connect("test");

  const first = await waitFor((e) => e.type === "contact-avatar" && e.jid === "alice@test.local");
  assert.match(first.hash, /^[0-9a-f]{40}$/);
  const file = await waitFor((e) => e.type === "avatar" && e.hash === first.hash);
  assert.equal(file.file, `${first.hash}.png`);
  assert.ok(fs.existsSync(path.join(dir, file.file)), "imagen guardada");

  // Nuestra presencia lleva las capacidades con +notify.
  const caps = acc.presenceStanza().getChild("c", "http://jabber.org/protocol/caps");
  assert.equal(caps.attrs.hash, "sha-1");
  assert.equal(caps.attrs.ver, capsVer());

  // Cambia el avatar.
  await acc.send(xml("message", { to: "alice@test.local", type: "chat" }, xml("body", {}, "!avatar")));
  const second = await waitFor((e) => e.type === "contact-avatar" && e.jid === "alice@test.local" && e.hash !== first.hash);
  assert.match(second.hash, /^[0-9a-f]{40}$/);
  await waitFor((e) => e.type === "avatar" && e.hash === second.hash);
  assert.equal(acc.pepAvatars.get("alice@test.local"), second.hash);

  // Lo quita: vuelve a sus iniciales (no tiene avatar en la vCard).
  await acc.send(xml("message", { to: "alice@test.local", type: "chat" }, xml("body", {}, "!sinavatar")));
  const removed = await waitFor((e) => e.type === "contact-avatar" && e.jid === "alice@test.local" && e.hash === "");
  assert.equal(removed.hash, "");
  assert.equal(acc.pepAvatars.has("alice@test.local"), false);
});
