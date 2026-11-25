// La mini ventana se «cura» sola recreándose. En Windows, tras apagarse los monitores o volver de suspensión, Chromium
// puede quedarse sin entregar a la página el «pulsar» del ratón (pointerdown) aunque sí entrega el «soltar»
// (pointerup): no se puede mover ni pulsar hasta cerrarla y abrirla. Medido con la mini congelada: la página visible
// y viva, la ventana la de arriba en ese punto, WM_NCHITTEST = HTCLIENT, ningún botón atascado. Recrearla lo arregla.
// - after(reason): tras un cambio de pantallas o de sesión, recrearla pasados DELAY_MS (agrupa los eventos seguidos).
// - stuck(): la página vio un «soltar» sin su «pulsar»: recrearla ya, como mucho una vez cada MIN_GAP_MS.

export const HEAL_DELAY_MS = 3000;
export const HEAL_MIN_GAP_MS = 5000;

export function createMiniHeal({ rebuild, setTimeout: later = setTimeout, clearTimeout: cancel = clearTimeout, now = Date.now, log = () => {} }) {
  let timer = null;
  let lastAt = -Infinity;

  function run(reason) {
    timer = null;
    if (now() - lastAt < HEAL_MIN_GAP_MS) return false;
    lastAt = now();
    log(reason);
    rebuild();
    return true;
  }

  function after(reason) {
    if (timer) cancel(timer);
    timer = later(() => run(reason), HEAL_DELAY_MS);
    timer?.unref?.();
  }

  function stuck() {
    if (timer) {
      cancel(timer);
      timer = null;
    }
    return run("clic perdido");
  }

  function stop() {
    if (timer) cancel(timer);
    timer = null;
  }

  return { after, stuck, stop };
}

