// Avatar propio contra el servidor simulado: vCard (XEP-0153), PEP (XEP-0084), presencia y quitarlo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { xml } from "@xmpp/client";
import { XmppAccount } from "../../src/main/xmpp-account.js";
import { encodeGif } from "../../src/renderer/js/avatar-image.js";
import { tempDir } from "./helpers.mjs";

const PORT = 16200 + Math.floor(Math.random() * 400);
let mock;
const mockLog = [];
before(async () => {
  mock = spawn(process.execPath, [fileURLToPath(new URL("../mock-xmpp.mjs", import.meta.url))], { env: { ...process.env, MOCK_PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
  mock.stdout.on("data", (d) => mockLog.push(...String(d).split("\n")));
  await new Promise((resolve, reject) => {
    mock.once("exit", (code) => reject(new Error(`el servidor simulado terminó (${code})`)));
    mock.stdout.on("data", (d) => String(d).includes("mock XMPP en") && resolve());
  });
});
after(() => mock?.kill());

async function online(t, user = "avatar") {
  const dir = tempDir(t);
  const acc = new XmppAccount({ id: user, jid: `${user}@test.local`, host: "127.0.0.1", port: PORT, security: "opportunistic" }, { avatarDir: dir, version: "1.0.0" });
  const events = [];
  acc.on("event", (e) => events.push(e));
  // Presencias que enviamos, para ver el hash de <photo/>.
  const sent = [];
  t.after(() => acc.disconnect(true).catch(() => {}));
  await acc.connect("test");
  for (let i = 0; i < 80 && !acc.online; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(acc.online, "conectado");
  acc.xmpp.on("send", (el) => el.is?.("presence") && sent.push(el));
  return { acc, events, sent, dir };
}

const vcardPhoto = async (acc) => {
  const vc = await acc.xmpp.iqCaller.get(xml("vCard", "vcard-temp"));
  const p = vc.getChild("PHOTO");
  return p ? { type: p.getChildText("TYPE"), data: Buffer.from(p.getChildText("BINVAL"), "base64") } : null;
};
const photoHash = (pres) => pres.getChild("x", "vcard-temp:x:update")?.getChildText("photo");

const gif = Buffer.from(
  encodeGif(
    [
      { rgba: new Uint8ClampedArray(8 * 8 * 4).fill(200), delay: 10 },
      { rgba: new Uint8ClampedArray(8 * 8 * 4).fill(60), delay: 10 },
    ],
    8,
    8,
  ),
);
// PNG mínimo de 1×1 (cabecera real) para la versión fija de XEP-0084.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("publicar un GIF animado: vCard con el GIF, PEP con la versión fija, presencia con el hash y archivo local", async (t) => {
  const { acc, events, sent, dir } = await online(t, "animado");
  // Datos que ya hubiera en la vCard (p. ej. el nombre) se conservan.
  await acc.xmpp.iqCaller.set(xml("vCard", "vcard-temp", xml("FN", {}, "Piloto Uno")));
  const r = await acc.setOwnAvatar(gif, "image/gif", { pep: { data: png, type: "image/png", width: 1, height: 1 } });
  const hash = crypto.createHash("sha1").update(gif).digest("hex");
  assert.deepEqual(r, { hash, pep: true });
  const photo = await vcardPhoto(acc);
  assert.equal(photo.type, "image/gif");
  assert.ok(photo.data.equals(gif));
  const vc = await acc.xmpp.iqCaller.get(xml("vCard", "vcard-temp"));
  assert.equal(vc.getChildText("FN"), "Piloto Uno", "el resto de la vCard sigue");
  assert.ok(events.some((e) => e.type === "own-avatar" && e.hash === hash));
  assert.ok(events.some((e) => e.type === "avatar" && e.file === `${hash}.gif`));
  assert.ok(fs.existsSync(path.join(dir, `${hash}.gif`)));
  assert.equal(photoHash(sent.at(-1)), hash, "la presencia anuncia el hash nuevo");
  await new Promise((res) => setTimeout(res, 100));
  assert.ok(mockLog.some((l) => /PEP urn:xmpp:avatar:data datos \d+ bytes/.test(l)));
  assert.ok(mockLog.some((l) => /PEP urn:xmpp:avatar:metadata info image\/png 1×1/.test(l)));
});

test("quitar el avatar: vCard sin foto, <photo/> vacío y metadatos PEP vacíos", async (t) => {
  const { acc, events, sent } = await online(t, "quitar");
  await acc.setOwnAvatar(png, "image/png");
  assert.ok(await vcardPhoto(acc));
  await acc.removeOwnAvatar();
  assert.equal(await vcardPhoto(acc), null);
  assert.ok(events.some((e) => e.type === "own-avatar" && e.hash === ""));
  const last = sent.at(-1);
  assert.ok(last.getChild("x", "vcard-temp:x:update")?.getChild("photo"), "lleva <photo/>");
  assert.equal(photoHash(last), "", "vacío: sin avatar");
  await new Promise((res) => setTimeout(res, 100));
  assert.ok(mockLog.some((l) => /PEP urn:xmpp:avatar:metadata vacío/.test(l)));
});

test("sin pep no se publica XEP-0084", async (t) => {
  const { acc } = await online(t, "solovcard");
  // Solo cuentan las publicaciones: al conectar, la cuenta también pide el avatar de Alice («PEP datos de alice pedidos»).
  const published = () => mockLog.filter((l) => /PEP urn:xmpp:avatar:/.test(l)).length;
  const before = published();
  const r = await acc.setOwnAvatar(png, "image/png");
  assert.equal(r.pep, false);
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(published(), before);
});
