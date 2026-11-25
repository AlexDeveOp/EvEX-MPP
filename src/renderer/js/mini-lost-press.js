// Huella del fallo de la mini ventana tras apagarse los monitores (ver src/main/mini-heal.js): llega el «soltar» del
// botón izquierdo (pointerup) sin su «pulsar» (pointerdown). Se avisa con onLost() al primero: el apagado de los
// monitores no deja ningún evento en la app, así que este clic es la única señal y cada uno perdido es un clic más
// que no responde. Un «soltar» huérfano sin fallo (pulsar fuera de la mini y soltar encima) es raro y solo cuesta
// recrear la ventana una vez; el proceso principal limita las recreaciones seguidas.
export function createLostPressDetector(onLost) {
  let down = false;
  return {
    down(e) {
      if (e.button === 0) down = true;
    },
    up(e) {
      if (e.button !== 0) return;
      if (!down) onLost();
      down = false;
    },
  };
}
