// Posición y tamaño de la mini ventana, por monitor. Sin Electron: se prueba con pantallas de mentira.
// saved = { last: id del último monitor, byDisplay: { [id]: { x, y, width, height } } }
export const MINI_DEFAULT = { width: 300, height: 150 };
export const MINI_MIN = { width: 220, height: 96 };
export const MINI_MAX = { width: 640, height: 420 };
const MARGIN = 16;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Ajusta un rectángulo al área útil del monitor (sin salirse ni quedar más grande que ella).
export function fitBounds(b, wa) {
  const width = clamp(Math.round(b.width), MINI_MIN.width, Math.min(MINI_MAX.width, wa.width));
  const height = clamp(Math.round(b.height), MINI_MIN.height, Math.min(MINI_MAX.height, wa.height));
  return {
    x: clamp(Math.round(b.x), wa.x, wa.x + wa.width - width),
    y: clamp(Math.round(b.y), wa.y, wa.y + wa.height - height),
    width,
    height,
  };
}

// Dónde abrirla: en el último monitor en que estuvo, si sigue conectado; si no, en el principal. Sin posición
// guardada para ese monitor, abajo a la derecha de su área útil.
export function placeBounds(saved, displays, primaryId) {
  const byId = new Map(displays.map((d) => [String(d.id), d]));
  const d = byId.get(String(saved?.last)) || byId.get(String(primaryId)) || displays[0];
  const wa = d.workArea;
  const b = saved?.byDisplay?.[String(d.id)];
  if (b) return fitBounds(b, wa);
  return fitBounds({ x: wa.x + wa.width - MINI_DEFAULT.width - MARGIN, y: wa.y + wa.height - MINI_DEFAULT.height - MARGIN, ...MINI_DEFAULT }, wa);
}

// Guarda la posición en el monitor en que ha quedado la ventana (el que más la contiene).
export function rememberBounds(saved, displayId, bounds) {
  const id = String(displayId);
  return { last: id, byDisplay: { ...(saved?.byDisplay || {}), [id]: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } } };
}

export const clampOpacity = (o) => clamp(Number.isFinite(Number(o)) ? Number(o) : 0.85, 0.3, 1);
