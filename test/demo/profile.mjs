// Perfil de demostración (npm run demo): config.json e historial con datos de ejemplo GENÉRICOS para ver toda la
// interfaz llena (pings, calendario, sugeridas, menciones, niveles de aviso, No molestar, mini ventana).
// Las horas son relativas al momento de crearlo. Nada de cuentas, alianzas ni nombres reales: ejemplo.com, pingbot…
import fs from "node:fs";
import path from "node:path";
import { Logs } from "../../src/main/logs.js";

export const DEMO_DOMAIN = "ejemplo.com";
export const DEMO_ACCOUNT = "demo";
export const DEMO_JID = `piloto@${DEMO_DOMAIN}`;
export const DEMO_NICK = "piloto";
export const DEMO_PASSWORD = "test"; // la que acepta el mock
const CONF = `conference.${DEMO_DOMAIN}`;
export const DEMO_ROOMS = {
  general: { jid: `general@${CONF}`, name: "general" },
  capitales: { jid: `capitales@${CONF}`, name: "capitales" },
  logistica: { jid: `logistica@${CONF}`, name: "logistica" },
};
const PINGBOT = `pingbot@${DEMO_DOMAIN}`;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const pad = (n) => String(n).padStart(2, "0");
// Fecha y hora EVE (UTC) en los formatos de los pings.
const eveDate = (ts) => {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const eveHM = (ts) => {
  const d = new Date(ts);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const footer = (from, to, ts) => `~~~ This was a coord broadcast from ${from} to ${to} at ${eveDate(ts)} ${eveHM(ts)}:00.000000 EVE ~~~`;
// Día EVE de hoy a las HH:MM, + days días.
const at = (now, days, hh, mm = 0) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days, hh, mm);
};
// El próximo sábado (o el de la semana que viene si hoy ya es sábado).
const nextSaturday = (now) => {
  const dow = new Date(now).getUTCDay();
  return (6 - dow + 7) % 7 || 7;
};

// Los pings del historial: ~10, con campos, de texto libre, a «caps», uno ya pasado y formups hoy, mañana y el sábado.
export function demoPings(now = Date.now()) {
  const today = Math.max(at(now, 0, new Date(now).getUTCHours() + 2), now + 90 * 60e3);
  const tomorrow = at(now, 1, 19, 0);
  const saturday = at(now, nextSaturday(now), 18, 0);
  const sent = (minsAgo) => now - minsAgo * 60e3;
  const p = (minsAgo, body) => ({ ts: sent(minsAgo), body });
  return [
    p(60 * 30, ["Strategic op this weekend, keep your clones ready", "", footer("ana", "all", sent(60 * 30))].join("\n")),
    p(60 * 26, ["Mining fleet in the home system, all welcome", "FC Name: Carol", "Formup Location: Home station", "Doctrine: Procurers", "", footer("carol", "all", sent(60 * 26))].join("\n")),
    // Ya pasado: el formup fue hace dos horas.
    p(60 * 5, ["Home defense fleet", "FC Name: Dave", `Formup Time: ${eveDate(now - 2 * 3600e3)} ${eveHM(now - 2 * 3600e3)}`, "Formup Location: Home station", "Doctrine: Ferox", "", footer("dave", "all", sent(60 * 5))].join("\n")),
    p(60 * 4, ["Logistics run to the trade hub tonight, haulers needed", "", footer("erin", "logistics", sent(60 * 4))].join("\n")),
    p(60 * 3, ["Capital fleet up later today!!", "FC Name: Bob FC", `Formup Time: ${eveDate(today)} ${eveHM(today)}`, "Formup Location: Jita", "PAP Type: Strategic", "Comms: Op 1 https://voz.ejemplo.com/op1", "Doctrine: Typhoons", "", footer("bob", "all", sent(60 * 3))].join("\n")),
    // Texto libre con la hora en la frase y un enlace genérico al calendario de un foro.
    p(60 * 2, ["Tomorrow at 17:15 we are forming for the final timer, be there early", "Details: https://foro.ejemplo.com/calendar/event/123-final-timer", "", footer("bob", "allcaps", sent(60 * 2))].join("\n")),
    p(110, ["Dreads and carriers, timer tomorrow", "FC Name: Bob FC", `Formup Time: ${eveDate(tomorrow)} ${eveHM(tomorrow)}`, "Formup Location: Staging", "Doctrine: Capitals", "", footer("bob", "caps", sent(110))].join("\n")),
    p(80, ["Saturday roam, small gang", "FC Name: Frank", `Formup Time: ${eveDate(saturday)} ${eveHM(saturday)}`, "Formup Location: Home station", "Doctrine: Interceptors", "", footer("frank", "all", sent(80))].join("\n")),
    p(45, ["SRP requests close at the end of the month, remember to file yours", "", footer("ana", "all", sent(45))].join("\n")),
    p(20, ["Capital fleet up later today!! (reminder)", "FC Name: Bob FC", `Formup Time: ${eveDate(today)} ${eveHM(today)}`, "Formup Location: Jita", "Doctrine: Typhoons", "", footer("bob", "all", sent(20))].join("\n")),
  ];
}

// Charla de las salas. En capitales, una hora de flota en un mensaje (sale como sugerida en el calendario).
export function demoRoomHistory(now = Date.now()) {
  const day = WEEKDAYS[new Date(now + 2 * 86400e3).getUTCDay()];
  const m = (minsAgo, nick, body) => ({ ts: now - minsAgo * 60e3, nick, body });
  return {
    general: [m(300, "alice", "morning all o7"), m(240, "bob", "anyone up for a roam later?"), m(200, "carol", "the market in the trade hub is crazy today"), m(120, "dave", "who has spare ammo?"), m(30, "alice", "back in 10")],
    capitales: [m(400, "bob", "dreads, check your fuel"), m(180, "fc_bob", `big op on ${day} at 21:00, be there`), m(90, "erin", "carriers ready"), m(60, "frank", "dinner at 21:00 tomorrow, so I'll be late"), m(50, "fc_bob", "caps timer tomorrow at 19:00, same as the ping"), m(40, "erin", "subcaps fleet tomorrow at 19:00 too, separate op")],
    logistica: [m(500, "erin", "freighter leaving at downtime"), m(150, "carol", "need 20k units of fuel"), m(70, "erin", "contract is up")],
  };
}

// Escribe el perfil en dir (config.json y logs/). Devuelve lo necesario para conectar.
export function writeDemoProfile(dir, { port, now = Date.now() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const rooms = Object.values(DEMO_ROOMS).map((r) => ({ jid: r.jid, name: r.name, nick: DEMO_NICK, favorite: true, autojoin: true }));
  const manualAt = at(now, nextSaturday(now), 18, 30);
  const config = {
    accounts: [{ id: DEMO_ACCOUNT, alias: "Demo", jid: DEMO_JID, host: "127.0.0.1", port, security: "opportunistic", autoLogin: true, nick: DEMO_NICK, conferenceServer: CONF, rooms }],
    settings: {
      behavior: { checkUpdates: false, restoreOpenTabs: true },
      pingSenders: ["pingbot"],
      notifications: {
        keywords: ["caps"],
        // Una sala en «Solo menciones» y otra en «Nada» (clave: cuenta|sala).
        roomModes: { [`${DEMO_ACCOUNT}|${DEMO_ROOMS.logistica.jid}`]: "mentions", [`${DEMO_ACCOUNT}|${DEMO_ROOMS.general.jid}`]: "none" },
        // Horario de No molestar configurado pero apagado.
        dndSchedule: { enabled: false, from: "01:00", to: "08:00", days: [1, 2, 3, 4, 5] },
      },
      mini: { enabled: true, opacity: 0.9, clickThrough: false },
      fleets: {
        items: {
          "m-demo-roam": { id: "m-demo-roam", at: manualAt, title: "Roam con la corp", group: "", note: "llevar 2 interceptores", link: "", source: "manual", pingKeys: [], msgKey: "", status: "active" },
        },
        overrides: {},
        dismissed: {},
      },
      openTabs: [{ accountId: null, conv: "*", type: "pings" }, ...rooms.map((r) => ({ accountId: DEMO_ACCOUNT, conv: r.jid, type: "groupchat" }))],
    },
  };
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config, null, 2));

  const logs = new Logs(path.join(dir, "logs"));
  for (const p of demoPings(now)) logs.append(DEMO_ACCOUNT, PINGBOT, { ts: p.ts, nick: "pingbot", body: p.body, fromJid: PINGBOT });
  for (const [id, list] of Object.entries(demoRoomHistory(now))) for (const e of list) logs.append(DEMO_ACCOUNT, DEMO_ROOMS[id].jid, e);
  return { accountId: DEMO_ACCOUNT, jid: DEMO_JID, password: DEMO_PASSWORD };
}
