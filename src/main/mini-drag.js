// Arrastre de la mini ventana hecho por la app, sin la zona de arrastre de Chromium (-webkit-app-region: drag).
// En Windows esa zona se quedaba a veces «congelada» (no dejaba mover la ventana hasta cerrarla y abrirla), sobre todo
// tras cambios de pantalla: monitores que se apagan, volver de suspensión, cambiar el foco entre monitores. La
// página avisa al pulsar la barra («start») y al soltar («end»); mientras tanto, aquí se lee la posición del ratón
// cada fotograma y se coloca la ventana conservando su tamaño. Todo en coordenadas de pantalla en DIP, las mismas
// que usan getCursorScreenPoint y setBounds, también con monitores de distinta escala.
// Si el «end» no llega nunca (la página se cuelga, se pierde el mensaje), el arrastre se para solo a los MAX_MS.

export const DRAG_FRAME_MS = 16;
export const DRAG_MAX_MS = 30e3;

// deps: getCursor() → {x, y}; getBounds() → {x, y, width, height}; setBounds(b); onEnd(); y, para los tests,
// setInterval/clearInterval/now.
export function createMiniDrag(deps) {
  const { getCursor, getBounds, setBounds, onEnd = () => {}, setInterval: every = setInterval, clearInterval: stopEvery = clearInterval, now = Date.now } = deps;
  let drag = null;

  function step() {
    if (!drag) return;
    if (now() - drag.startedAt > DRAG_MAX_MS) return end();
    let c;
    try {
      c = getCursor();
    } catch {
      c = null;
    }
    if (!Number.isFinite(c?.x) || !Number.isFinite(c?.y)) return end();
    const x = Math.round(c.x - drag.offset.x);
    const y = Math.round(c.y - drag.offset.y);
    if (x === drag.last.x && y === drag.last.y) return;
    drag.last = { x, y };
    // El tamaño de cuando empezó: al pasar a un monitor de otra escala, setPosition puede cambiarlo.
    setBounds({ x, y, width: drag.size.width, height: drag.size.height });
  }

  function start() {
    end();
    const b = getBounds();
    const c = getCursor();
    drag = {
      offset: { x: c.x - b.x, y: c.y - b.y },
      size: { width: b.width, height: b.height },
      last: { x: b.x, y: b.y },
      startedAt: now(),
      timer: null,
    };
    drag.timer = every(step, DRAG_FRAME_MS);
    drag.timer?.unref?.();
  }

  function end() {
    if (!drag) return false;
    stopEvery(drag.timer);
    const moved = drag.last;
    drag = null;
    onEnd(moved);
    return true;
  }

  return { start, end, step, active: () => !!drag };
}
