// Icono de la aplicación dibujado por código (PNG), con variante de insignia para mensajes sin leer.
import zlib from "node:zlib";

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const clamp = (v) => Math.max(0, Math.min(1, v));
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(x, y, ax, ay, bx, by, r) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

// Insignia de «No molestar» (abajo a la derecha): círculo rojo con borde blanco y una campana blanca tachada.
// Coordenadas sobre una rejilla de 64 (s = tamaño / 64). Devuelve la cobertura del borde, del círculo y del dibujo.
// Va grande (casi media esquina) para que a 16 px en la bandeja se lea como «círculo rojo con una raya».
function mutedBadge(px, py, s) {
  const cx = 44 * s;
  const cy = 44 * s;
  const aRing = clamp(0.5 - (Math.hypot(px - cx, py - cy) - 20 * s));
  const aDisc = clamp(0.5 - (Math.hypot(px - cx, py - cy) - 17 * s));
  // Campana: cúpula + falda + badajo, lo más grande que cabe en el círculo.
  const dDome = Math.min(Math.hypot(px - cx, py - (cy - 2 * s)) - 7.5 * s, sdRoundRect(px, py, cx, cy + 1.5 * s, 7.5 * s, 3.5 * s, 0.5 * s));
  const dSkirt = sdRoundRect(px, py, cx, cy + 5.5 * s, 11 * s, 2 * s, 1.6 * s);
  const dClapper = Math.hypot(px - cx, py - (cy + 9.5 * s)) - 2.6 * s;
  const dBell = Math.min(dDome, dSkirt, dClapper);
  const aBell = clamp(0.5 - dBell);
  // Tachado como el icono «bell-off»: el corte rojo atraviesa la campana y la raya blanca solo se ve fuera de ella.
  const dLine = sdSegment(px, py, cx - 12 * s, cy - 12 * s, cx + 12 * s, cy + 12 * s, 0);
  const aCut = clamp(0.5 - (dLine - 2.6 * s));
  const aSlash = clamp(0.5 - (dLine - 1.6 * s)) * clamp(0.5 + (dBell - 1.4 * s));
  const aGlyph = Math.max(aBell * (1 - aCut), aSlash) * aDisc;
  return { aRing, aDisc, aGlyph };
}

const RED = [239, 68, 68];
// Mezcla la insignia sobre un píxel [r, g, b, alpha 0–1].
function paintMuted(px, py, s, rgba) {
  const { aRing, aDisc, aGlyph } = mutedBadge(px, py, s);
  let [r, g, b, a] = rgba;
  r += (255 - r) * aRing;
  g += (255 - g) * aRing;
  b += (255 - b) * aRing;
  r += (RED[0] - r) * aDisc;
  g += (RED[1] - g) * aDisc;
  b += (RED[2] - b) * aDisc;
  r += (255 - r) * aGlyph;
  g += (255 - g) * aGlyph;
  b += (255 - b) * aGlyph;
  return [r, g, b, Math.max(a, aRing)];
}

// Icono de aviso de ping: la sirena de los pings, rellena y blanca sobre un círculo ámbar.
// Va rellena y con solo tres rayos porque la sirena de trazo fino de la app no se distingue a 16 px en la bandeja.
// muted: con la insignia de «No molestar» abajo a la derecha (la sirena sigue a la vista: los pings suenan igual).
export function renderAlertIcon(size = 64, color = "#f59e0b", glyph = "#ffffff", { muted = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const c = hex(color);
  const g = hex(glyph);
  const s = size / 64;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const aCircle = clamp(0.5 - (Math.hypot(px - 32 * s, py - 32 * s) - 31 * s));
      const dDome = Math.min(Math.hypot(px - 32 * s, py - 31 * s) - 12 * s, sdRoundRect(px, py, 32 * s, 37.5 * s, 12 * s, 6.5 * s, 0.5 * s));
      const dBase = sdRoundRect(px, py, 32 * s, 49 * s, 17 * s, 4 * s, 2 * s);
      const dRays = Math.min(
        sdSegment(px, py, 32 * s, 6 * s, 32 * s, 11 * s, 3.2 * s),
        sdSegment(px, py, 13 * s, 15 * s, 17 * s, 19 * s, 3.2 * s),
        sdSegment(px, py, 51 * s, 15 * s, 47 * s, 19 * s, 3.2 * s),
      );
      const a = clamp(0.5 - Math.min(dDome, dBase, dRays));
      let px4 = [c[0] + (g[0] - c[0]) * a, c[1] + (g[1] - c[1]) * a, c[2] + (g[2] - c[2]) * a, aCircle];
      if (muted) px4 = paintMuted(px, py, s, px4);
      const i = (y * size + x) * 4;
      buf[i] = px4[0];
      buf[i + 1] = px4[1];
      buf[i + 2] = px4[2];
      buf[i + 3] = px4[3] * 255;
    }
  }
  return encodePng(size, size, buf);
}

// ---------- icono de la app: un cyno (columna de luz con su anillo) y la flota llegando ----------

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WHITE = [255, 255, 255];
const BEAM = hex("#bfe6ff");

// Distancia aproximada a una elipse centrada en el origen (negativa dentro).
function sdEllipse(dx, dy, rx, ry) {
  const k = Math.hypot(dx / rx, dy / ry);
  const grad = Math.hypot(dx / (rx * rx), dy / (ry * ry));
  return k === 0 ? -Math.min(rx, ry) : (k * (k - 1)) / Math.max(grad, 1e-9);
}

// Distancia con signo a un polígono (Inigo Quilez); negativa dentro.
function sdPolygon(x, y, pts) {
  let d = (x - pts[0][0]) ** 2 + (y - pts[0][1]) ** 2;
  let sign = 1;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j];
    const [bx, by] = pts[i];
    const ex = bx - ax;
    const ey = by - ay;
    const wx = x - ax;
    const wy = y - ay;
    const h = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey));
    d = Math.min(d, (wx - ex * h) ** 2 + (wy - ey * h) ** 2);
    const c = [y >= ay, y < by, ex * wy > ey * wx];
    if (c.every(Boolean) || c.every((v) => !v)) sign = -sign;
  }
  return sign * Math.sqrt(d);
}

// Nave en punta de flecha (chevron) centrada en (x, y), de tamaño k.
const chevron = (x, y, k) => [
  [x, y - k],
  [x + k * 0.9, y + k * 0.7],
  [x, y + k * 0.25],
  [x - k * 0.9, y + k * 0.7],
];

// Medidas sobre una rejilla de 256. En grande, el cyno con cuatro naves; en pequeño (≤ 48 px: bandeja, barra de
// tareas, menú Inicio) solo el cyno, más grueso y con el anillo más marcado: las naves se quedaban en dos o tres
// píxeles y ensuciaban el dibujo.
const SMALL = 48;
const FULL_LAYOUT = {
  top: 26 + 11,
  base: 190,
  half: 11,
  glow: 16,
  ringX: 72.6,
  ringY: 20.9,
  ringW: 10,
  coreX: 35,
  coreY: 10,
  coreBlur: 6,
  ships: [
    [52, 150, 22],
    [204, 150, 22],
    [74, 96, 17],
    [182, 96, 17],
  ],
};
const TRAY_LAYOUT = {
  top: 28 + 22,
  base: 190,
  half: 22,
  glow: 14,
  ringX: 96,
  ringY: 30,
  ringW: 22,
  coreX: 46,
  coreY: 14,
  coreBlur: 6,
  ships: [],
};

// badge: punto rojo de mensajes sin leer (arriba a la derecha); muted: insignia de «No molestar» (abajo a la derecha).
// accent y accent2: el centro y el borde del fondo (azul espacio por defecto).
// small: fuerza el dibujo simplificado (solo el cyno) aunque el tamaño sea mayor, p. ej. para el icono de la ventana
// a 200 % en la barra de tareas.
export function renderIcon(size = 256, { accent = "#1b3a66", accent2 = "#070b12", badge = false, muted = false, small = size <= SMALL } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const a1 = hex(accent);
  const a2 = hex(accent2);
  const s = size / 256;
  const L = small ? TRAY_LAYOUT : FULL_LAYOUT;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      // Fondo: cuadrado redondeado con un degradado radial (espacio), más claro abajo, donde está el cyno.
      const dBg = sdRoundRect(px, py, size / 2, size / 2, 120 * s, 120 * s, 56 * s);
      const aBg = clamp(0.5 - dBg);
      const t = clamp(Math.hypot(px - 128 * s, py - 205 * s) / (218 * s));
      let rgb = mix(a1, a2, t);
      const paint = (c, a) => (rgb = mix(rgb, c, clamp(a)));
      // Resplandor del haz: cae con la distancia (más suave en grande, más marcado en pequeño).
      const dBeam = sdSegment(px, py, 128 * s, L.top * s, 128 * s, L.base * s, 0) - L.half * s;
      paint(BEAM, 0.55 * Math.exp(-Math.max(dBeam, 0) / (L.glow * s)));
      // Haz: blanco abajo y azulado arriba, y se desvanece en el último tramo.
      const along = clamp((L.base * s - py) / ((L.base - L.top) * s));
      const fade = clamp((1 - along) / 0.25);
      paint(mix(WHITE, BEAM, clamp(along / 0.75)), clamp(0.5 - dBeam) * fade);
      // Anillo en perspectiva y el núcleo brillante de la base.
      paint(BEAM, clamp(0.5 - (Math.abs(sdEllipse(px - 128 * s, py - L.base * s, L.ringX * s, L.ringY * s)) - (L.ringW / 2) * s)) * 0.95);
      paint(WHITE, clamp(0.6 - sdEllipse(px - 128 * s, py - L.base * s, L.coreX * s, L.coreY * s) / (L.coreBlur * s)));
      // Naves de la flota en punta de flecha, a los lados del haz.
      for (const [cx, cy, k] of L.ships) paint(WHITE, clamp(0.5 - sdPolygon(px, py, chevron(cx * s, cy * s, k * s))));
      let [r, g, b] = rgb;
      let alpha = aBg;
      if (badge) {
        const dRing = Math.hypot(px - 206 * s, py - 50 * s) - 50 * s;
        const dDot = Math.hypot(px - 206 * s, py - 50 * s) - 38 * s;
        const aRing = clamp(0.5 - dRing);
        const aDot = clamp(0.5 - dDot);
        alpha = Math.max(alpha, aRing);
        r = r * (1 - aRing) + 255 * aRing;
        g = g * (1 - aRing) + 255 * aRing;
        b = b * (1 - aRing) + 255 * aRing;
        r += (239 - r) * aDot;
        g += (68 - g) * aDot;
        b += (68 - b) * aDot;
      }
      if (muted) [r, g, b, alpha] = paintMuted(px, py, size / 64, [r, g, b, alpha]);
      const i = (y * size + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = alpha * 255;
    }
  }
  return encodePng(size, size, buf);
}
