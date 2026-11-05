// En qué pantalla salen las burbujas (Preferencias → Notificaciones → «Pantalla de las burbujas»). Funciones puras: reciben
// las pantallas tal y como las da screen de Electron ({ id, bounds, workArea, size, scaleFactor }) y no tocan nada.
//
// Valores posibles de la opción:
//   "primary"      la pantalla principal del sistema (por defecto)
//   "cursor"       la pantalla donde esté el ratón (lo que hacía la app hasta la 0.8)
//   "window"       la pantalla donde está la ventana de EvEX-MPP
//   "display:<id>" un monitor concreto. El id puede cambiar (al reconectar o reiniciar), así que también se guarda una
//                  pista con su posición y tamaño (displayHint) para reencontrarlo.

export const FIXED_CHOICES = ["primary", "cursor", "window"];

const area = (r) => Math.max(0, r.width) * Math.max(0, r.height);
function overlap(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
const contains = (r, p) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
function distance(r, p) {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width - 1));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height - 1));
  return dx * dx + dy * dy;
}
const sameRect = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export const displayChoice = (display) => `display:${display.id}`;

// Pantallas en el orden en que las numera el usuario: de izquierda a derecha y de arriba abajo, como en la
// configuración de pantallas del sistema (el orden de getAllDisplays() no está garantizado).
export function orderedDisplays(displays = []) {
  return [...displays].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
}

// Lista para el desplegable: número, resolución y si es la principal. labels: textos ya traducidos.
export function describeDisplays(displays = [], primaryId, labels = {}) {
  const screenLabel = labels.screen || ((n) => `Pantalla ${n}`);
  const primaryLabel = labels.primary || "principal";
  return orderedDisplays(displays).map((d, i) => {
    // size y bounds van en píxeles lógicos: la resolución que conoce el usuario es la física (× escala).
    const scale = d.scaleFactor || 1;
    const w = Math.round((d.size?.width ?? d.bounds.width) * scale);
    const h = Math.round((d.size?.height ?? d.bounds.height) * scale);
    const primary = d.id === primaryId;
    return {
      id: d.id,
      value: displayChoice(d),
      label: `${screenLabel(i + 1)} · ${w}×${h}${primary ? ` (${primaryLabel})` : ""}`,
      bounds: { ...d.bounds },
      primary,
    };
  });
}

// La pista que se guarda junto a "display:<id>" para reencontrar el monitor si cambia su id.
export function displayHint(display) {
  return display ? { bounds: { ...display.bounds }, size: display.size ? { ...display.size } : null } : null;
}

// Un monitor concreto: por su id; si no, el que esté en la misma posición y tamaño; si no, uno del mismo tamaño
// (si solo hay uno así). null si no está conectado.
export function findDisplay(displays, id, hint) {
  const byId = displays.find((d) => String(d.id) === String(id));
  if (byId) return byId;
  if (!hint?.bounds) return null;
  const same = displays.find((d) => sameRect(d.bounds, hint.bounds));
  if (same) return same;
  const size = hint.size || hint.bounds;
  const sized = displays.filter((d) => (d.size || d.bounds).width === size.width && (d.size || d.bounds).height === size.height);
  return sized.length === 1 ? sized[0] : null;
}

// La pantalla más cercana a un punto (la que lo contiene, o la de borde más próximo).
export function displayNearestPoint(displays, point) {
  if (!point) return null;
  return displays.find((d) => contains(d.bounds, point)) || [...displays].sort((a, b) => distance(a.bounds, point) - distance(b.bounds, point))[0] || null;
}

// La pantalla que más superficie tiene de un rectángulo (la ventana). null si no toca ninguna.
export function displayMatching(displays, rect) {
  if (!rect || !area(rect)) return null;
  let best = null;
  let bestArea = 0;
  for (const d of displays) {
    const a = overlap(d.bounds, rect);
    if (a > bestArea) {
      best = d;
      bestArea = a;
    }
  }
  return best;
}

// Elige la pantalla de una pila de burbujas. Devuelve { display, fallback }: fallback es true si se quería otra
// (un monitor que no está, una ventana oculta…) y se ha usado la principal, para volver a la elegida cuando aparezca.
// ctx: { displays, primary, cursor (punto), windowBounds (null si la ventana está oculta o minimizada), hint }.
export function pickDisplay(choice, ctx) {
  const displays = ctx.displays?.length ? ctx.displays : ctx.primary ? [ctx.primary] : [];
  const primary = displays.find((d) => d.id === ctx.primary?.id) || ctx.primary || displays[0] || null;
  const value = String(choice || "primary");
  let display = null;
  if (value === "primary") return { display: primary, fallback: false };
  if (value === "cursor") display = displayNearestPoint(displays, ctx.cursor);
  else if (value === "window") display = displayMatching(displays, ctx.windowBounds);
  else if (value.startsWith("display:")) display = findDisplay(displays, value.slice(8), ctx.hint);
  return display ? { display, fallback: false } : { display: primary, fallback: true };
}

// ¿Es un valor que se puede usar? Para lo que llega de la interfaz: una de las fijas o un monitor conectado.
export function isValidChoice(value, displays = []) {
  if (typeof value !== "string") return false;
  if (FIXED_CHOICES.includes(value)) return true;
  const m = /^display:(-?\d{1,20})$/.exec(value);
  return !!m && displays.some((d) => String(d.id) === m[1]);
}
