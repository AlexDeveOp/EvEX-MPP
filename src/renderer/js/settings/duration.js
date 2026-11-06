// Selector «Cuánto se queda el aviso» de Preferencias (pings y aviso del formup): hasta cerrarlo, como los mensajes o
// unos segundos. Los valores son los de popup-duration.js.
import { S } from "../state.js";
import { select } from "../dom.js";
import { t } from "../i18n.js";
import { DURATION_CHOICES, normDuration } from "../popup-duration.js";

export function durationLabel(v, messageSeconds = S.settings?.notifications?.popupDuration ?? 8) {
  if (v === "sticky") return t("Hasta cerrarlo");
  if (v === "message") return t("Como los mensajes ({n} s)", { n: messageSeconds });
  return v >= 60 ? t("{n} min", { n: v / 60 }) : `${v} s`;
}

// onChange(valor normalizado: "sticky", "message" o un número de segundos).
export function durationSelect(value, onChange) {
  return select(
    DURATION_CHOICES.map((v) => [String(v), durationLabel(v)]),
    String(value),
    (v) => onChange(normDuration(v)),
  );
}
