// La mini ventana se «cura» sola recreándose. En Windows, tras apagarse los monitores o volver de suspensión, Chromium
// puede quedarse sin entregar a la página el «pulsar» del ratón (pointerdown) aunque sí entrega el «soltar»
// (pointerup): no se puede mover ni pulsar hasta cerrarla y abrirla. Medido con la mini congelada: la página visible
// y viva, la ventana la de arriba en ese punto, WM_NCHITTEST = HTCLIENT, ningún botón atascado. Recrearla lo arregla.
// - after(reason, delay): tras un cambio de pantallas o de sesión, recrearla pasados delay ms (agrupa los eventos
//   seguidos). Al desbloquear o volver de suspensión basta QUICK_MS: así está curada antes de que se toque.
// - stuck(): la página vio un «soltar» sin su «pulsar»: recrearla ya, como mucho una vez cada MIN_GAP_MS.

export const HEAL_DELAY_MS = 1000; // pantallas que se conectan o desconectan (agrupa los eventos seguidos)
export const HEAL_QUICK_MS = 500;
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

  function after(reason, delay = HEAL_DELAY_MS) {
    if (timer) cancel(timer);
    timer = later(() => run(reason), delay);
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


// Los monitores que se apagan por inactividad no dejan ningún evento en la app, pero sí una huella: un rato sin tocar
// nada y, de golpe, actividad (el movimiento o la tecla que los enciende). feed(segundos de inactividad del sistema)
// devuelve true en ese momento: la mini se recrea antes de que se llegue a tocar.
export const IDLE_WAKE_AFTER_S = 60;
export function createIdleWake({ after = IDLE_WAKE_AFTER_S } = {}) {
  let wasIdle = false;
  return {
    feed(idleSeconds) {
      if (!Number.isFinite(idleSeconds)) return false;
      const woke = wasIdle && idleSeconds < 2;
      if (idleSeconds >= after) wasIdle = true;
      else if (woke || idleSeconds < 2) wasIdle = false;
      return woke;
    },
  };
}
