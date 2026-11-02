// Redimensionado de la barra lateral y del panel de participantes arrastrando el separador.
import { S, saveSettings } from "./state.js";

for (const handle of document.querySelectorAll(".resizer")) {
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const which = handle.dataset.for;
    const startX = e.clientX;
    const zoom = Number(document.body.style.zoom) || 1;
    const start = which === "sidebar" ? S.settings.layout.sidebarWidth : S.settings.layout.occupantsWidth;
    document.body.classList.add("resizing");
    const move = (ev) => {
      const dx = (ev.clientX - startX) / zoom;
      const w = Math.round(Math.max(180, Math.min(520, which === "sidebar" ? start + dx : start - dx)));
      if (which === "sidebar") S.settings.layout.sidebarWidth = w;
      else S.settings.layout.occupantsWidth = w;
      document.documentElement.style.setProperty(which === "sidebar" ? "--sidebar-w" : "--occupants-w", `${w}px`);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
      saveSettings();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
}
