// Exportar flotas a .ics (RFC 5545): escapado, plegado, fechas, alarma, UID y lo que se incluye según la opción.
import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeText, foldLine, unfold, formatUtc, alarmTrigger, eventLines, buildCalendar, suggestedFileName, fleetEvent, fleetUid, exportableFleets, fleetsCalendar, PRODID } from "../../src/renderer/js/ics.js";

const octets = (s) => new TextEncoder().encode(s).length;
const ZWSP = String.fromCharCode(0x200b);
const AT = Date.UTC(2026, 10, 5, 21, 30); // 2026-11-05 21:30 UTC
const STAMP = Date.UTC(2026, 10, 5, 12, 0, 7);

test("escapeText: barra, punto y coma, coma y saltos de línea (§3.3.11)", () => {
  assert.equal(escapeText("a\\b; c, d\ne\r\nf"), "a\\\\b\\; c\\, d\\ne\\nf");
  assert.equal(escapeText(null), "");
  assert.equal(escapeText(42), "42");
});

test("foldLine: 75 octetos por línea, continuación con espacio, sin partir caracteres de varios octetos", () => {
  const ascii = `DESCRIPTION:${"x".repeat(200)}`;
  const folded = foldLine(ascii);
  for (const l of folded.split("\r\n")) assert.ok(octets(l) <= 75, `línea de ${octets(l)} octetos`);
  assert.ok(folded.split("\r\n").slice(1).every((l) => l.startsWith(" ")));
  assert.equal(unfold(folded), ascii);
  // ñ (2 octetos), € (3) y un emoji (4, par sustituto): nada se parte y al desplegar vuelve igual.
  const multi = `SUMMARY:${"ñ€🚀".repeat(40)}`;
  const f2 = foldLine(multi);
  for (const l of f2.split("\r\n")) {
    assert.ok(octets(l) <= 75);
    assert.ok(!l.includes("�"), "sin caracteres rotos");
  }
  assert.equal(unfold(f2), multi);
  assert.equal(foldLine("UID:corto"), "UID:corto", "las cortas no cambian");
});

test("formatUtc y alarmTrigger", () => {
  assert.equal(formatUtc(AT), "20261105T213000Z");
  assert.equal(formatUtc(new Date(STAMP)), "20261105T120007Z");
  assert.throws(() => formatUtc("no es fecha"));
  assert.equal(alarmTrigger(15), "-PT15M");
  assert.equal(alarmTrigger(90), "-PT1H30M");
  assert.equal(alarmTrigger(60), "-PT1H");
  assert.equal(alarmTrigger(0), "PT0M");
});

test("eventLines: UID, DTSTAMP, inicio y fin en UTC, alarma opcional", () => {
  const lines = eventLines({ uid: "f1@evex-mpp", start: AT, summary: "Fleet", dtstamp: STAMP });
  assert.deepEqual(lines, ["BEGIN:VEVENT", "UID:f1@evex-mpp", "DTSTAMP:20261105T120007Z", "DTSTART:20261105T213000Z", "DTEND:20261105T223000Z", "SUMMARY:Fleet", "END:VEVENT"]);
  const withAlarm = eventLines({ uid: "f1@evex-mpp", start: AT, durationMinutes: 90, summary: "Fleet", alarmMinutes: 15, dtstamp: STAMP });
  assert.ok(withAlarm.includes("DTEND:20261105T230000Z"));
  assert.deepEqual(withAlarm.slice(withAlarm.indexOf("BEGIN:VALARM"), withAlarm.indexOf("END:VALARM") + 1), ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Fleet", "TRIGGER:-PT15M", "END:VALARM"]);
  assert.throws(() => eventLines({ start: AT }), /UID/);
  assert.ok(eventLines({ uid: "u", start: AT, url: "https://ejemplo.com/a,b;c" }).includes("URL:https://ejemplo.com/a,b;c"), "URL sin escapar como texto");
});

test("buildCalendar: cabecera, CRLF en todas las líneas (también al final) y ninguna línea de más de 75 octetos", () => {
  const ics = buildCalendar([{ uid: "a@evex-mpp", start: AT, summary: "Fleet (caps)", description: "x".repeat(300), dtstamp: STAMP }], { name: "Flotas, prueba" });
  assert.ok(ics.startsWith(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:${PRODID}\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Flotas\\, prueba\r\n`));
  assert.ok(ics.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "todo salto de línea es CRLF");
  for (const l of ics.split("\r\n")) assert.ok(octets(l) <= 75);
  assert.ok(unfold(ics).includes(`DESCRIPTION:${"x".repeat(300)}\r\n`));
});

const fleet = (over = {}) => ({ id: "f7", at: AT, title: "Capital fleet up now", group: "caps", source: "ping", pingKeys: ["k1"], link: "https://calendario.ejemplo.com/op/7", note: `Traed ${ZWSP}cyno`, status: "active", ...over });

test("fleetEvent por defecto (opsec): solo «Fleet» + grupo y la hora; ni título, ni ping, ni nota, ni enlace", () => {
  const ev = fleetEvent(fleet(), { info: { fc: "Ejemplo FC", formup: "1DQ1-A", doctrine: "Typhoons" }, dtstamp: STAMP });
  assert.deepEqual(ev, { uid: "f7@evex-mpp", start: AT, durationMinutes: 60, summary: "Fleet (caps)", alarmMinutes: null, dtstamp: STAMP });
  assert.equal(fleetEvent(fleet({ group: "" })).summary, "Fleet");
  assert.equal(fleetUid("abc"), "abc@evex-mpp");
  const ics = fleetsCalendar([fleet()], { dtstamp: STAMP, infoOf: () => ({ fc: "Ejemplo FC" }) });
  for (const leak of ["Capital", "Ejemplo FC", "cyno", "calendario.ejemplo.com"]) assert.ok(!unfold(ics).includes(leak), `no debe salir «${leak}»`);
  assert.ok(!/^(DESCRIPTION|LOCATION|URL):/m.test(unfold(ics)), "sin descripción, lugar ni enlace");
});

test("fleetEvent con detalles: título, FC/formup/doctrina del ping y nota; formup como lugar; enlace solo si se pide", () => {
  const info = { fc: "Ejemplo FC", formup: "1DQ1-A", doctrine: "Typhoons" };
  const ev = fleetEvent(fleet(), { details: true, info, alarmMinutes: 15, dtstamp: STAMP });
  assert.equal(ev.summary, "Fleet (caps): Capital fleet up now");
  assert.equal(ev.description, `FC: Ejemplo FC\nFormup: 1DQ1-A\nDoctrine: Typhoons\nTraed ${ZWSP}cyno`, "con el carácter invisible (marca de agua)");
  assert.equal(ev.location, "1DQ1-A");
  assert.equal(ev.url, undefined, "el enlace no va salvo que se pida");
  assert.equal(fleetEvent(fleet(), { details: true, includeLink: true, info }).url, "https://calendario.ejemplo.com/op/7");
  assert.equal(fleetEvent(fleet({ link: "javascript:alert(1)" }), { includeLink: true }).url, undefined, "solo http(s)");
  const ics = unfold(fleetsCalendar([fleet()], { details: true, infoOf: () => info, dtstamp: STAMP }));
  assert.ok(ics.includes(`DESCRIPTION:FC: Ejemplo FC\\nFormup: 1DQ1-A\\nDoctrine: Typhoons\\nTraed ${ZWSP}cyno\r\n`), "el invisible llega al fichero");
  assert.ok(ics.includes("LOCATION:1DQ1-A\r\n"));
});

test("exportableFleets: solo las activas con hora, en orden; fleetsCalendar con varias", () => {
  const list = [fleet({ id: "b", at: AT + 3600e3 }), fleet({ id: "a" }), fleet({ id: "p", status: "pending" }), fleet({ id: "d", status: "dismissed" }), fleet({ id: "x", at: NaN }), null];
  assert.deepEqual(exportableFleets(list).map((f) => f.id), ["a", "b"]);
  const ics = fleetsCalendar(list, { dtstamp: STAMP });
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 2);
  assert.ok(ics.indexOf("UID:a@evex-mpp") < ics.indexOf("UID:b@evex-mpp"));
  assert.equal(fleetsCalendar([], { dtstamp: STAMP }).match(/BEGIN:VEVENT/g), null, "sin flotas: calendario vacío válido");
});

test("suggestedFileName", () => {
  assert.equal(suggestedFileName(AT), "fleet-2026-11-05-2130.ics");
  assert.equal(suggestedFileName(AT, { many: true }), "fleets-2026-11-05.ics");
});
