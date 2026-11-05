// Avisos por sala y por chat, y «No molestar» con horario (notify-rules.js).
import test from "node:test";
import assert from "node:assert/strict";
import { effectiveLevel, parseHM, scheduleActive, scheduleEnd, dndState, toggleDnd, shouldAlert, badgeCount } from "../../src/renderer/js/notify-rules.js";

// 2026-11-02 es lunes (getDay() = 1).
const at = (day, hm) => {
  const [h, m] = hm.split(":").map(Number);
  return new Date(2026, 10, 2 + ((day + 6) % 7), h, m);
};

test("effectiveLevel: el elegido manda; si no, salas según el ajuste general y chats «todo»", () => {
  assert.equal(effectiveLevel("groupchat", "none"), "none");
  assert.equal(effectiveLevel("chat", "mentions"), "mentions");
  assert.equal(effectiveLevel("groupchat", "default"), "mentions");
  assert.equal(effectiveLevel("groupchat", undefined, { allRoomMessages: true }), "all");
  assert.equal(effectiveLevel("chat", "default"), "all");
  assert.equal(effectiveLevel("chat", "rarísimo"), "all", "valor desconocido = general");
});

test("parseHM", () => {
  assert.equal(parseHM("01:30"), 90);
  assert.equal(parseHM("8:05"), 485);
  assert.equal(parseHM("24:00"), null);
  assert.equal(parseHM("aa"), null);
});

test("scheduleActive: tramo normal y tramo que cruza la medianoche, con días", () => {
  const night = { enabled: true, from: "23:00", to: "07:00", days: [1] }; // lunes por la noche
  assert.equal(scheduleActive(night, at(1, "23:30")), true, "lunes 23:30");
  assert.equal(scheduleActive(night, at(2, "06:59")), true, "madrugada del martes cuenta como del lunes");
  assert.equal(scheduleActive(night, at(2, "07:00")), false, "a las 07:00 termina");
  assert.equal(scheduleActive(night, at(2, "23:30")), false, "el martes no está en los días");
  assert.equal(scheduleActive(night, at(1, "06:00")), false, "madrugada del lunes = domingo por la noche, no elegido");
  const day = { enabled: true, from: "01:00", to: "08:00", days: [0, 1, 2, 3, 4, 5, 6] };
  assert.equal(scheduleActive(day, at(3, "01:00")), true);
  assert.equal(scheduleActive(day, at(3, "08:00")), false);
  assert.equal(scheduleActive({ ...day, enabled: false }, at(3, "02:00")), false, "apagado");
  assert.equal(scheduleActive({ ...day, from: "05:00", to: "05:00" }, at(3, "05:00")), false, "de y a iguales: nada");
});

test("scheduleEnd: el final del tramo en curso", () => {
  const night = { enabled: true, from: "23:00", to: "07:00", days: [1] };
  assert.deepEqual(scheduleEnd(night, at(1, "23:30")), at(2, "07:00"));
  assert.deepEqual(scheduleEnd(night, at(2, "03:00")), at(2, "07:00"));
  assert.equal(scheduleEnd(night, at(2, "12:00")), null);
});

test("dndState y toggleDnd: manual, por horario y apagado hasta el final del tramo", () => {
  const sched = { enabled: true, from: "01:00", to: "08:00", days: [0, 1, 2, 3, 4, 5, 6] };
  assert.deepEqual(dndState({ dnd: true }, at(3, "12:00")), { active: true, manual: true, scheduled: false, until: null });
  const st = dndState({ dndSchedule: sched }, at(3, "02:00"));
  assert.equal(st.active, true);
  assert.equal(st.scheduled, true);
  assert.deepEqual(st.until, at(3, "08:00"));
  assert.equal(dndState({ dndSchedule: sched }, at(3, "09:00")).active, false);

  // Pulsar el interruptor durante el horario lo apaga hasta las 08:00 de hoy; la noche siguiente vuelve.
  const off = toggleDnd({ dndSchedule: sched }, at(3, "02:00"));
  assert.deepEqual(off, { dnd: false, dndSkipUntil: at(3, "08:00").getTime() });
  const n = { dndSchedule: sched, ...off };
  assert.equal(dndState(n, at(3, "03:00")).active, false, "saltado");
  assert.equal(dndState(n, at(4, "02:00")).active, true, "la noche siguiente vuelve");
  // Fuera del horario, el interruptor lo enciende a mano; y pulsado otra vez, lo apaga.
  assert.deepEqual(toggleDnd({ dndSchedule: sched }, at(3, "12:00")), { dnd: true });
  assert.deepEqual(toggleDnd({ dnd: true }, at(3, "12:00")), { dnd: false, dndSkipUntil: 0 });
});

const N = { enabled: true, privateMessages: true, mentions: true };

test("shouldAlert: niveles", () => {
  assert.equal(shouldAlert({ type: "groupchat", level: "all", n: N }), true);
  assert.equal(shouldAlert({ type: "groupchat", level: "mentions", n: N }), false);
  assert.equal(shouldAlert({ type: "groupchat", level: "mentions", mention: true, n: N }), true);
  assert.equal(shouldAlert({ type: "groupchat", level: "none", mention: true, n: N }), false, "«Nada»: ni las menciones");
  assert.equal(shouldAlert({ type: "chat", level: "all", n: N }), true);
  assert.equal(shouldAlert({ type: "chat", level: "all", n: { ...N, privateMessages: false } }), false);
  assert.equal(shouldAlert({ type: "chat", level: "mentions", n: N }), false, "chat en «solo menciones»");
  assert.equal(shouldAlert({ type: "chat", level: "mentions", mention: true, n: N }), true);
  assert.equal(shouldAlert({ type: "chat", level: "none", n: N }), false);
  assert.equal(shouldAlert({ type: "groupchat", level: "all", n: { ...N, enabled: false } }), false, "notificaciones apagadas");
});

test("shouldAlert: reglas por palabra clave y «No molestar»", () => {
  const always = { notify: "always", dnd: false };
  assert.equal(shouldAlert({ type: "groupchat", level: "none", rule: always, n: N }), true, "la regla «avisar siempre» manda sobre el nivel");
  const dnd = { active: true };
  assert.equal(shouldAlert({ type: "groupchat", level: "all", n: N, dnd }), false, "No molestar calla la sala");
  assert.equal(shouldAlert({ type: "chat", level: "all", n: N, presenceDnd: true }), false, "también el estado XMPP «No molestar»");
  assert.equal(shouldAlert({ type: "groupchat", level: "all", rule: always, n: N, dnd }), false, "regla sin «aunque esté en No molestar»");
  assert.equal(shouldAlert({ type: "groupchat", level: "all", rule: { notify: "always", dnd: true }, n: N, dnd }), true);
  // «Dejar pasar las menciones» durante No molestar, salvo en salas en «Nada».
  const allow = { ...N, dndAllowMentions: true };
  assert.equal(shouldAlert({ type: "groupchat", level: "mentions", mention: true, n: allow, dnd }), true);
  assert.equal(shouldAlert({ type: "groupchat", level: "all", mention: false, n: allow, dnd }), false, "lo que no es mención sigue callado");
  assert.equal(shouldAlert({ type: "groupchat", level: "none", mention: true, n: allow, dnd }), false);
});

test("badgeCount", () => {
  assert.equal(badgeCount("all", { unread: 5, mentions: 1 }), 5);
  assert.equal(badgeCount("mentions", { unread: 5, mentions: 1 }), 1);
  assert.equal(badgeCount("none", { unread: 5, mentions: 1 }), 0);
});
