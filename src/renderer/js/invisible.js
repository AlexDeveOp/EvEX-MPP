// Caracteres invisibles de los pings (U+200B–U+200D, U+2060, U+FEFF). Algunas alianzas los meten como marca de agua
// en cada copia de un ping: lo que se PINTA o se manda a una burbuja va TAL CUAL, con ellos; solo se ignoran para
// comparar, buscar, leer en voz alta o reconocer horas y campos (sobre una copia).
export const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

// Quita solo espacios normales de los bordes (trim() también quitaría U+FEFF).
export const trimSpaces = (s) => String(s ?? "").replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g, "");

// Copia para comparar: sin invisibles.
export const withoutInvisible = (s) => String(s ?? "").replace(INVISIBLE, "");

// ¿Tiene algo que se vea? (un texto hecho solo de invisibles y espacios, no)
export const hasVisible = (s) => withoutInvisible(s).trim() !== "";

// Recorta a n puntos de código (no parte un emoji ni un par sustituto).
export function cutChars(s, n) {
  const chars = Array.from(String(s ?? ""));
  return chars.length > n ? chars.slice(0, n).join("") : chars.join("");
}

// Quita de raw el trozo que en su copia sin invisibles va de start a start + length (p. ej. el pie de un ping que solo
// se reconoce sin ellos), dejando intacto, con sus invisibles, todo lo demás.
export function removeCleanRange(raw, start, length) {
  const s = String(raw ?? "");
  let clean = 0;
  let from = -1;
  let to = s.length;
  for (let i = 0; i < s.length; i++) {
    const invisible = /[\u200B-\u200D\u2060\uFEFF]/.test(s[i]);
    if (!invisible) {
      if (clean === start && from < 0) from = i;
      clean++;
      if (clean === start + length) {
        to = i + 1;
        break;
      }
    }
  }
  if (from < 0) return s;
  return s.slice(0, from) + s.slice(to);
}
