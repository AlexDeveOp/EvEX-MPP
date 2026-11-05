// Reglas de aviso sin DOM (las usan la ventana, el proceso principal para la bandeja y los tests):
// - nivel de aviso de cada sala o chat: "all" (todo), "mentions" (solo menciones y palabras clave) o "none" (nada);
// - «No molestar»: manual o por horario (de–a, días de la semana; puede cruzar la medianoche);
// - qué se cuenta en los contadores y si un mensaje avisa.
// Los pings de flota y los avisos de conexión no pasan por aquí: no se silencian nunca.

export const LEVELS = ["default", "all", "mentions", "none"];
export const DEFAULT_SCHEDULE = { enabled: false, from: "01:00", to: "08:00", days: [1, 2, 3, 4, 5, 6, 0] };

// Nivel efectivo. override: el elegido para esa conversación ("default" o ausente = el general).
// Para las salas, el general es «todo» o «solo menciones» (Preferencias → Notificaciones); los chats privados avisan de todo.
export function effectiveLevel(type, override, { allRoomMessages = false } = {}) {
  if (override && override !== "default" && LEVELS.includes(override)) return override;
  if (type !== "groupchat") return "all";
  return allRoomMessages ? "all" : "mentions";
}

// "01:30" → 90 minutos. Valores raros → null.
export function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

// ¿El horario está activo en este momento? Si cruza la medianoche (p. ej. 23:00–07:00), la parte de después de las
// 00:00 cuenta como del día en que empezó: el lunes 23:00–07:00 cubre la madrugada del martes.
export function scheduleActive(sched, now = new Date()) {
  if (!sched?.enabled) return false;
  const from = parseHM(sched.from);
  const to = parseHM(sched.to);
  if (from == null || to == null || from === to) return false;
  const days = new Set(sched.days?.length ? sched.days : DEFAULT_SCHEDULE.days);
  const m = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();
  const yesterday = (today + 6) % 7;
  if (from < to) return days.has(today) && m >= from && m < to;
  return (days.has(today) && m >= from) || (days.has(yesterday) && m < to);
}

// Cuándo termina el tramo de horario en curso (Date), o null si no está activo.
export function scheduleEnd(sched, now = new Date()) {
  if (!scheduleActive(sched, now)) return null;
  const to = parseHM(sched.to);
  const end = new Date(now);
  end.setHours(Math.floor(to / 60), to % 60, 0, 0);
  if (end <= now) end.setDate(end.getDate() + 1);
  return end;
}

// Estado de «No molestar»: { active, manual, scheduled, until }.
// - manual: el interruptor (Preferencias, menú de estado, bandeja o barra de título);
// - scheduled: el horario, salvo que se haya apagado a mano hasta el final del tramo (skipUntil).
export function dndState(n, now = new Date()) {
  const manual = !!n?.dnd;
  const inSchedule = scheduleActive(n?.dndSchedule, now) && now.getTime() >= (n?.dndSkipUntil || 0);
  const scheduled = !manual && inSchedule;
  return { active: manual || inSchedule, manual, scheduled, until: scheduled ? scheduleEnd(n.dndSchedule, now) : null };
}

// Qué hacer al pulsar el interruptor: devuelve los cambios para notifications.
// Activo → se apaga (y, si es por horario, se salta hasta el final del tramo). Inactivo → se enciende a mano.
export function toggleDnd(n, now = new Date()) {
  const st = dndState(n, now);
  if (!st.active) return { dnd: true };
  const end = scheduleEnd(n?.dndSchedule, now);
  return { dnd: false, dndSkipUntil: end ? end.getTime() : n?.dndSkipUntil || 0 };
}

// ¿Avisa este mensaje (sonido, burbuja y parpadeo)?
// level: el nivel efectivo; mention: menciona tu nombre o una palabra clave; rule: regla por palabra clave (keywords.js).
export function shouldAlert({ type, level, mention = false, rule = null, n = {}, dnd = { active: false }, presenceDnd = false }) {
  if (!n.enabled) return false;
  const forced = !!rule && rule.notify !== "never";
  // Una regla «avisar siempre» manda sobre el nivel de la sala; con «aunque esté en No molestar», también sobre eso.
  const quiet = dnd.active || presenceDnd;
  if (quiet && !(forced && rule.dnd) && !(n.dndAllowMentions && (mention || forced) && level !== "none")) return false;
  if (forced && rule.notify === "always") return true;
  if (level === "none") return false;
  if (level === "mentions") return mention || forced ? (type === "chat" ? true : !!(n.mentions || forced)) : false;
  return type === "chat" ? !!(n.privateMessages || forced) : true;
}

// Número que se muestra (pestaña, barra lateral, barra de tareas) según el nivel.
// unread: mensajes sin leer; mentions: los que te mencionan. «Nada» no cuenta; «solo menciones» cuenta las menciones.
export function badgeCount(level, { unread = 0, mentions = 0 } = {}) {
  if (level === "none") return 0;
  if (level === "mentions") return mentions;
  return unread;
}
