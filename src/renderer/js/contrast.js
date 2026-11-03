// Contraste de colores (WCAG), sin DOM: lo usa la burbuja de aviso y se puede probar aparte.

// Luminancia relativa de un color #rrggbb.
export function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// El mismo tono, oscurecido lo justo para que el blanco encima se lea (4,5:1). Si no es #rrggbb, el ámbar de siempre.
export function shadeForWhite(bg, fallback = "#f59e0b") {
  if (!/^#[0-9a-f]{6}$/i.test(bg || "")) bg = fallback;
  const rgb = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
  let k = 0;
  const shade = () => "#" + rgb.map((v) => Math.round(v * (1 - k)).toString(16).padStart(2, "0")).join("");
  while (k < 0.9 && contrast(shade(), "#ffffff") < 4.5) k += 0.02;
  return shade();
}
