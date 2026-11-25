// Huella del fallo de la mini ventana tras apagarse los monitores (ver src/main/mini-heal.js): llega el «soltar» del
// botón izquierdo (pointerup) sin su «pulsar» (pointerdown). Un «soltar» huérfano suelto puede ser normal (pulsar
// fuera de la mini y soltar encima), así que se avisa con onLost() al segundo en menos de WINDOW_MS, que es lo que
// pasa cuando se insiste en una mini congelada.
export const LOST_PRESS_WINDOW_MS = 15e3;

export function createLostPressDetector(onLost, { now = () => performance.now() } = {}) {
  let down = false;
  let lastLost = -Infinity;
  return {
    down(e) {
      if (e.button === 0) down = true;
    },
    up(e) {
      if (e.button !== 0) return;
      if (down) {
        down = false;
        return;
      }
      const t = now();
      if (t - lastLost <= LOST_PRESS_WINDOW_MS) {
        lastLost = -Infinity;
        onLost();
      } else lastLost = t;
    },
  };
}
