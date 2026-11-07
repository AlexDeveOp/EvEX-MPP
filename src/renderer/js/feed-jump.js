import { tk } from "./i18n.js";

// Botón flotante para volver al principio en las vistas que van del más nuevo (arriba) al más viejo:
// «Pings de flota» y «Menciones». En ellas no hay flecha abajo, que llevaba al más antiguo con un clic sin querer.

// A partir de cuánto se ha bajado aparece la flecha arriba (px).
export const JUMP_TOP_AFTER = 200;

export const isNewestFirst = (c) => c?.type === "pings" || c?.type === "mentions";

// Qué botón se ve: en las vistas del más nuevo arriba, la flecha arriba al alejarse del principio;
// en los chats, la de siempre (abajo) cuando no se está abajo del todo.
export function jumpButtons(c, { scrollTop, scrollHeight, clientHeight }) {
  if (isNewestFirst(c)) return { up: scrollTop > JUMP_TOP_AFTER, down: false };
  return { up: false, down: scrollHeight - scrollTop - clientHeight >= 80 };
}

// Texto del botón arriba según la vista.
export function jumpTopLabel(c, view = "list") {
  if (c?.type === "mentions") return tk("Ir a la última mención");
  if (view !== "list") return tk("Ir arriba");
  return tk("Ir al último ping");
}

// Solo cuentan como «nuevos» los que llegan en directo: no los recuperados del historial ni las
// respuestas del bot a un ping enviado (fcReply).
export const countsAsNew = (m) => !!m && !m.history && !m.delayed && !m.fcReply && !m.fc && !m.sys;

// Inicio / Fin en esas vistas, salvo si se está escribiendo en un campo.
export function feedKeyAction(e) {
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null;
  if (e.key !== "Home" && e.key !== "End") return null;
  const t = e.target;
  const tag = t?.tagName?.toUpperCase?.();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return null;
  return e.key === "Home" ? "top" : "bottom";
}
