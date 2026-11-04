// Preferencias → Perfil: tu avatar. Se elige una imagen, se encuadra en un círculo (arrastrar y zoom) y se publica ya
// reducida y comprimida (avatar-image.js). Las imágenes animadas se pueden mantener como GIF animado.
import { S, api, conn, on } from "../state.js";
import { h, icon, modal, toast, toggle, confirmDialog } from "../dom.js";
import { avatarEl } from "../chat.js";
import { currentLang, t } from "../i18n.js";
import { group } from "./common.js";
import { loadImage, cropFor, encodeStatic, encodeAnimated, formatBytes, STATIC_BUDGET, ANIMATED_BUDGET } from "../avatar-image.js";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp";
const MAX_SOURCE = 25 * 1024 * 1024;

// Cuenta que se quiere ver al abrir la pestaña (desde su círculo o desde Gestionar cuentas).
let focusId = null;
export const setProfileFocus = (id) => (focusId = id);

export const profileTabs = {
  profile() {
    const wrap = h("div", {});
    const render = () => {
      wrap.replaceChildren(...S.accounts.map(accountBlock), aboutGroup());
    };
    render();
    if (focusId && S.accounts.length > 1) {
      const id = focusId;
      requestAnimationFrame(() => {
        const block = [...wrap.querySelectorAll(".settings-group")].find((g) => g.dataset.account === id);
        block?.scrollIntoView({ block: "start" });
        block?.classList.add("flash");
      });
    }
    focusId = null;
    // Se repinta cuando llega el avatar nuevo; se deja de escuchar al cerrar Preferencias.
    const off = on("avatar", () => (wrap.isConnected ? render() : off()));
    return wrap;
  },
};

function accountBlock(acc) {
  const st = conn(acc.id);
  const online = st.state === "online";
  const has = !!st.avatarHash;
  const block = group(
    S.accounts.length > 1 ? `${t("Avatar")} · ${acc.alias || acc.jid}` : t("Avatar"),
    h(
      "div",
      { class: "avatar-settings" },
      h("div", { class: "avatar-previews" }, avatarEl(acc.jid, acc.alias, "avatar-preview-lg"), avatarEl(acc.jid, acc.alias, "account-avatar")),
      h(
        "div",
        { class: "avatar-actions" },
        h("p", { class: "muted small" }, has ? t("Lo ven tus contactos y las salas, también desde Pidgin y otros clientes XMPP.") : t("Ahora se muestran tus iniciales. Elige una imagen para personalizarlo.")),
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn primary", disabled: !online, onclick: () => pickImage(acc) }, icon("image-plus"), has ? t("Cambiar imagen…") : t("Elegir imagen…")),
          has ? h("button", { class: "btn", disabled: !online, onclick: () => removeAvatar(acc) }, icon("trash-2"), t("Quitar avatar")) : null,
        ),
        online ? null : h("p", { class: "muted small" }, t("Conéctate para cambiarlo: se guarda en tu perfil del servidor.")),
      ),
    ),
  );
  block.dataset.account = acc.id;
  return block;
}

function aboutGroup() {
  return group(
    t("Cómo se guarda"),
    h(
      "p",
      { class: "muted small" },
      t("Como en Pidgin, la imagen se recorta en cuadrado y se reduce a 96×96 píxeles antes de enviarla: en XMPP viaja dentro de tu perfil y la descarga cada persona que te ve. Las imágenes fijas se dejan en menos de {kb} KB; las animadas, en un GIF de hasta {gif} KB (si hace falta, con menos colores o fotogramas).", { kb: STATIC_BUDGET / 1024, gif: ANIMATED_BUDGET / 1024 }),
    ),
  );
}

// Abre el selector de archivos del sistema y, con la imagen elegida, el editor.
export function pickImage(acc) {
  const input = h("input", { type: "file", accept: ACCEPT, style: { display: "none" } });
  input.onchange = async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    if (file.size > MAX_SOURCE) return toast(t("La imagen es demasiado grande (máximo {mb} MB).", { mb: 25 }), { kind: "error" });
    try {
      const img = await loadImage(new Uint8Array(await file.arrayBuffer()), file.type || "image/png");
      openAvatarEditor(acc, img);
    } catch {
      toast(t("No se pudo leer la imagen"), { kind: "error" });
    }
  };
  document.body.append(input);
  input.click();
}

// Editor: la imagen dentro de un cuadrado con la máscara del círculo; arrastrar mueve, la rueda o la barra hacen zoom.
export function openAvatarEditor(acc, img) {
  const VIEW = 280;
  const state = { zoom: 1, cx: img.width / 2, cy: img.height / 2, animate: img.animated };
  const canvas = h("canvas", { class: "avatar-crop-canvas", width: VIEW, height: VIEW });
  const ctx = canvas.getContext("2d");
  const crop = () => cropFor(img.width, img.height, state.zoom, state.cx, state.cy);
  const draw = () => {
    const c = crop();
    // Se guarda el centro ya ajustado para que arrastrar contra el borde no acumule desplazamiento.
    state.cx = c.x + c.side / 2;
    state.cy = c.y + c.side / 2;
    ctx.clearRect(0, 0, VIEW, VIEW);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.first, c.x, c.y, c.side, c.side, 0, 0, VIEW, VIEW);
  };
  const zoomInput = h("input", {
    type: "range",
    min: 1,
    max: 6,
    step: 0.01,
    value: 1,
    "aria-label": t("Zoom"),
    oninput: (e) => {
      state.zoom = Number(e.target.value);
      draw();
    },
  });
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, cx: state.cx, cy: state.cy };
    const perPx = crop().side / VIEW;
    const move = (ev) => {
      state.cx = start.cx - (ev.clientX - start.x) * perPx;
      state.cy = start.cy - (ev.clientY - start.y) * perPx;
      draw();
    };
    const up = () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      state.zoom = Math.min(6, Math.max(1, state.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      zoomInput.value = state.zoom;
      draw();
    },
    { passive: false },
  );
  // Flechas para mover y +/− para el zoom, sin ratón.
  canvas.tabIndex = 0;
  canvas.addEventListener("keydown", (e) => {
    const stepPx = crop().side / 20;
    const moves = { ArrowLeft: [-stepPx, 0], ArrowRight: [stepPx, 0], ArrowUp: [0, -stepPx], ArrowDown: [0, stepPx] };
    if (moves[e.key]) {
      state.cx += moves[e.key][0];
      state.cy += moves[e.key][1];
    } else if (e.key === "+" || e.key === "-") {
      state.zoom = Math.min(6, Math.max(1, state.zoom * (e.key === "+" ? 1.1 : 1 / 1.1)));
      zoomInput.value = state.zoom;
    } else return;
    e.preventDefault();
    draw();
  });
  draw();

  const status = h("p", { class: "muted small avatar-status" }, t("Arrastra para encuadrar y usa la rueda o la barra para acercar."));
  const body = h(
    "div",
    { class: "avatar-editor" },
    h("div", { class: "avatar-crop" }, canvas, h("div", { class: "avatar-crop-mask" })),
    h("div", { class: "avatar-zoom" }, icon("zoom-out"), zoomInput, icon("zoom-in")),
    img.animated
      ? toggle(state.animate, (v) => (state.animate = v), t("Mantener la animación"), t("Se guarda como GIF animado de hasta {kb} KB. Algunos clientes solo muestran el primer fotograma.", { kb: ANIMATED_BUDGET / 1024 }))
      : null,
    status,
  );
  let busy = false;
  const m = modal({
    title: t("Tu avatar"),
    icon: "image",
    className: "avatar-editor-modal",
    body,
    onClose: () => img.close?.(),
    actions: [
      "spacer",
      { label: t("Cancelar"), action: (close) => !busy && close() },
      {
        label: t("Guardar"),
        primary: true,
        icon: "check",
        action: async (close) => {
          if (busy) return;
          busy = true;
          status.textContent = state.animate ? t("Preparando el GIF animado…") : t("Preparando la imagen…");
          try {
            const c = crop();
            const still = await encodeStatic(img.first, c);
            const out = state.animate ? await encodeAnimated(img, c) : still;
            status.textContent = t("Publicando…");
            const r = await api("avatar:publish", acc.id, { data: out.data, type: out.type }, { data: still.data, type: still.type, width: still.width, height: still.height });
            const kind = out.type === "image/gif" ? t("GIF animado") : out.type === "image/png" ? "PNG" : "JPEG";
            toast(t("Avatar actualizado: {size} px, {kind}, {bytes}.", { size: `${out.width}×${out.height}`, kind, bytes: formatBytes(out.data.length, currentLang()) }), { kind: "ok" });
            if (r && !r.pep) console.info("avatar: el servidor no aceptó XEP-0084; queda en la vCard");
            close();
          } catch (e) {
            status.textContent = "";
            toast(e.message === "too-big" ? t("No se ha podido dejar la imagen en un tamaño aceptable. Prueba con un GIF más corto o una imagen fija.") : e.message, { kind: "error" });
          } finally {
            busy = false;
          }
        },
      },
    ],
  });
  setTimeout(() => canvas.focus());
  return m;
}

async function removeAvatar(acc) {
  const ok = await confirmDialog({ title: t("Quitar avatar"), message: t("Se borrará la imagen de tu perfil y se volverán a mostrar tus iniciales."), okLabel: t("Quitar"), danger: true });
  if (!ok) return;
  try {
    await api("avatar:remove", acc.id);
    toast(t("Avatar quitado"), { kind: "ok" });
  } catch (e) {
    toast(e.message, { kind: "error" });
  }
}
