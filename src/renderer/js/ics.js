// Calendario iCalendar (RFC 5545) para exportar flotas a Outlook, Google Calendar o el calendario de Windows.
// Sin DOM ni red: solo construye el texto del fichero .ics (lo guarda el proceso principal con el diálogo Guardar).
// - Texto escapado según RFC 5545 §3.3.11 (\ ; , y saltos de línea).
// - Líneas plegadas a 75 octetos de UTF-8 (§3.1), sin partir caracteres; la continuación empieza con un espacio.
// - Fin de línea CRLF, horas en UTC (…Z), UID estable por flota (reexportar actualiza el evento en vez de duplicarlo).

export const PRODID = "-//EvEX-MPP//Fleet calendar//EN";
const CRLF = "\r\n";
const MAX_OCTETS = 75;

// Texto de una propiedad (SUMMARY, DESCRIPTION, LOCATION…).
export function escapeText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// Pliega una línea de contenido a 75 octetos: las siguientes empiezan con un espacio (que cuenta en sus 75).
// No parte un carácter de varios octetos ni un par sustituto (emoji).
export function foldLine(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = "";
  let octets = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length ? MAX_OCTETS - 1 : MAX_OCTETS;
    if (octets + n > limit) {
      out.push(cur);
      cur = "";
      octets = 0;
    }
    cur += ch;
    octets += n;
  }
  out.push(cur);
  return out.map((l, i) => (i ? ` ${l}` : l)).join(CRLF);
}

// Despliega un .ics (para los tests y para leerlo): quita CRLF + espacio o tabulador.
export const unfold = (text) => String(text).replace(/\r\n[ \t]/g, "");

// 2026-11-05T21:30:00Z → 20261105T213000Z
export function formatUtc(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error("fecha no válida");
  return d.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

// Duración para TRIGGER: 15 → "-PT15M", 90 → "-PT1H30M", 0 → "PT0M" (a la hora).
export function alarmTrigger(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (!m) return "PT0M";
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `-PT${h ? `${h}H` : ""}${rest ? `${rest}M` : ""}`;
}

// Un evento. start/end: Date o milisegundos; si no hay end, dura durationMinutes (60 por defecto).
// alarmMinutes: aviso antes de empezar (null = sin aviso). description y location son opcionales.
export function eventLines({ uid, start, end, durationMinutes = 60, summary, description, location, alarmMinutes = null, dtstamp = Date.now(), categories, url }) {
  if (!uid) throw new Error("falta el UID");
  const startMs = new Date(start).getTime();
  const endMs = end != null ? new Date(end).getTime() : startMs + durationMinutes * 60e3;
  const lines = ["BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${formatUtc(dtstamp)}`, `DTSTART:${formatUtc(startMs)}`, `DTEND:${formatUtc(endMs)}`, `SUMMARY:${escapeText(summary || "Fleet")}`];
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  // URL es de tipo URI (§3.8.4.6): no se escapa como texto; solo se quitan los saltos de línea.
  if (url) lines.push(`URL:${String(url).replace(/[\r\n]/g, "")}`);
  if (categories?.length) lines.push(`CATEGORIES:${categories.map(escapeText).join(",")}`);
  if (alarmMinutes != null) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(summary || "Fleet")}`, `TRIGGER:${alarmTrigger(alarmMinutes)}`, "END:VALARM");
  lines.push("END:VEVENT");
  return lines;
}

// Fichero completo: VCALENDAR con los eventos, líneas plegadas y CRLF (también al final, como pide el RFC).
export function buildCalendar(events, { name } = {}) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${PRODID}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  if (name) lines.push(`X-WR-CALNAME:${escapeText(name)}`);
  for (const ev of events) lines.push(...eventLines(ev));
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// Nombre propuesto para el diálogo Guardar: «fleet-2026-11-05-2130.ics» o «fleets-2026-11-05.ics» (fecha en UTC).
export function suggestedFileName(start, { many = false } = {}) {
  const iso = new Date(start).toISOString();
  return many ? `fleets-${iso.slice(0, 10)}.ics` : `fleet-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}.ics`;
}

// ---------- flotas → eventos ----------
// Flotas de fleets.js: { id, at (ms UTC), title, group, source, pingKeys, msgKey, link, note, status }.
// - Solo se exportan las activas (status "active").
// - Por defecto, «mínimo» (opsec, decidido por el mantenedor): SUMMARY «Fleet» + grupo y la hora en UTC, sin
//   descripción. El calendario puede acabar sincronizado en la nube de Outlook o Google.
// - details: además el título, FC, formup y doctrina (info, sacados del ping) y la nota; el formup como lugar.
// - includeLink: el enlace de la flota (p. ej. el del calendario de la alianza) solo si se pide expresamente.
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
const clean = (v) => String(v ?? "").replace(INVISIBLE, "").replace(/[ \t]+/g, " ").trim();

export const fleetUid = (id) => `${id}@evex-mpp`;

export function fleetEvent(fleet, { details = false, includeLink = false, info = {}, alarmMinutes = null, durationMinutes = 60, dtstamp = Date.now() } = {}) {
  const group = clean(fleet.group);
  const base = group ? `Fleet (${group})` : "Fleet";
  const ev = { uid: fleetUid(fleet.id), start: fleet.at, durationMinutes, summary: base, alarmMinutes, dtstamp };
  if (details) {
    const title = clean(fleet.title);
    if (title) ev.summary = `${base}: ${title}`;
    const fields = [
      ["FC", clean(info.fc)],
      ["Formup", clean(info.formup)],
      ["Doctrine", clean(info.doctrine)],
    ].filter(([, v]) => v);
    const note = String(fleet.note ?? "").replace(INVISIBLE, "").trim();
    const text = [...fields.map(([k, v]) => `${k}: ${v}`), note].filter(Boolean).join("\n");
    if (text) ev.description = text;
    if (clean(info.formup)) ev.location = clean(info.formup);
  }
  if (includeLink && /^https?:\/\//i.test(String(fleet.link || ""))) ev.url = String(fleet.link);
  return ev;
}

// Flotas que se exportan: activas, con hora válida, en orden.
export const exportableFleets = (fleets) => [...fleets].filter((f) => f && f.status === "active" && f.id != null && Number.isFinite(f.at)).sort((a, b) => a.at - b.at);

// Un .ics con una flota o con varias (las próximas). infoOf(fleet) da { fc, formup, doctrine } del ping (con details).
export function fleetsCalendar(fleets, { infoOf = () => ({}), ...opts } = {}) {
  return buildCalendar(exportableFleets(fleets).map((f) => fleetEvent(f, { ...opts, info: opts.details ? infoOf(f) || {} : {} })), { name: opts.name || "EvEX-MPP fleets" });
}
