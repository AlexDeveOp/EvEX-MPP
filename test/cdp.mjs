// Driver mínimo por Chrome DevTools Protocol para automatizar la interfaz.
// Arranca la app con --remote-debugging-port=9333 y luego: node test/cdp.mjs 9333 pasos.json
// Cada paso: {eval: "js"} | {shot: "ruta.png"} | {wait: ms} | {move: "selector"} | {click: "selector"} | {wheel: "selector", dy}
// move/click/wheel usan el ratón real de Chromium (Input.dispatchMouseEvent): así se prueban :hover y los clics de verdad.
import fs from "node:fs";

const [port, stepsFile] = process.argv.slice(2);
const steps = JSON.parse(fs.readFileSync(stepsFile, "utf8").trimStart());
let targets = [];
for (let i = 0; i < 40; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    if (targets.some((t) => t.type === "page")) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
// La ventana principal; las burbujas de aviso también son páginas de la app.
const page = targets.find((t) => t.type === "page" && t.url.includes("index.html")) || targets.find((t) => t.type === "page" && t.url.startsWith("app://"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
  if (m.method === "Runtime.exceptionThrown") console.log("EXCEPTION", JSON.stringify(m.params.exceptionDetails).slice(0, 800));
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) console.log("CONSOLE", m.params.type, m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 600));
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
await send("Runtime.enable");
for (const s of steps) {
  if (s.wait) await new Promise((r) => setTimeout(r, s.wait));
  if (s.eval) {
    const r = await send("Runtime.evaluate", { expression: s.eval, awaitPromise: true, returnByValue: true });
    const v = r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r.result?.result?.description;
    console.log("EVAL:", s.label || s.eval.slice(0, 60), "=>", typeof v === "string" ? v.slice(0, 1500) : JSON.stringify(v)?.slice(0, 1500));
  }
  if (s.move || s.click || s.wheel) {
    const sel = s.move || s.click || s.wheel;
    const r = await send("Runtime.evaluate", { expression: `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`, returnByValue: true });
    const pos = r.result?.result?.value;
    if (!pos) console.log("RATÓN: no existe", sel);
    else {
      const [x, y] = pos;
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      if (s.click) {
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      }
      if (s.wheel) await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: s.dy || 100 });
      console.log("RATÓN:", s.click ? "clic" : s.wheel ? "rueda" : "encima", sel);
    }
  }
  if (s.shot) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(s.shot, Buffer.from(r.result.data, "base64"));
    console.log("SHOT", s.shot);
  }
}
ws.close();
process.exit(0);
