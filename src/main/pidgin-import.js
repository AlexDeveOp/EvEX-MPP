// Importa cuentas XMPP, salas guardadas y registros de conversación desde Pidgin (%APPDATA%\.purple).
import fs from "node:fs";
import path from "node:path";
import { parse } from "ltx";

export function purpleDir() {
  return path.join(process.env.APPDATA || "", ".purple");
}

function readXml(file) {
  try {
    return parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const settingsOf = (el) => Object.fromEntries((el?.getChildren("setting") || []).map((s) => [s.attrs.name, s.text()]));

// Lee la configuración sin tocar nada. La contraseña solo se incluye si se pide explícitamente.
export function scanPidgin({ includePasswords = false } = {}) {
  const dir = purpleDir();
  const accountsXml = readXml(path.join(dir, "accounts.xml"));
  const blistXml = readXml(path.join(dir, "blist.xml"));
  if (!accountsXml) return { found: false, dir, accounts: [] };

  const accounts = [];
  for (const a of accountsXml.getChildren("account")) {
    if (a.getChildText("protocol") !== "prpl-jabber") continue;
    const name = a.getChildText("name") || "";
    const jid = name.split("/")[0].toLowerCase();
    const resource = name.split("/")[1] || "";
    const s = settingsOf(a.getChild("settings"));
    const security = s.connection_security === "old_ssl" ? "direct" : s.connection_security === "opportunistic_tls" ? "opportunistic" : "starttls";
    accounts.push({
      jid,
      resource,
      alias: a.getChildText("alias") || jid.split("@")[0],
      host: s.connect_server || "",
      port: Number(s.port) || 5222,
      security,
      autoLogin: s["auto-login"] !== "0",
      password: includePasswords ? a.getChildText("password") || "" : undefined,
      hasPassword: !!a.getChildText("password"),
      rooms: [],
      logsDir: path.join(dir, "logs", "jabber", jid),
    });
  }

  // Salas guardadas en la lista de contactos
  for (const chat of blistXml?.getChild("blist")?.getChildren("group").flatMap((g) => g.getChildren("chat")) || []) {
    if (chat.attrs.proto !== "prpl-jabber") continue;
    const accJid = String(chat.attrs.account || "").split("/")[0].toLowerCase();
    const acc = accounts.find((x) => x.jid === accJid);
    if (!acc) continue;
    const comp = Object.fromEntries(chat.getChildren("component").map((c) => [c.attrs.name, c.text()]));
    if (!comp.room || !comp.server) continue;
    const roomJid = `${comp.room}@${comp.server}`.toLowerCase();
    if (acc.rooms.some((r) => r.jid === roomJid)) continue;
    const s = settingsOf(chat);
    acc.rooms.push({
      jid: roomJid,
      name: chat.getChildText("alias") || comp.room,
      nick: comp.handle || "",
      password: comp.password || "",
      autojoin: s["gtk-autojoin"] === "1",
      favorite: true,
    });
  }

  for (const acc of accounts) {
    try {
      acc.logConversations = fs.readdirSync(acc.logsDir).length;
    } catch {
      acc.logConversations = 0;
    }
  }
  return { found: true, dir, accounts };
}

// ---------- sonidos ----------

// Sonidos de Pidgin y a qué aviso de EvEX-MPP corresponden (nombre del evento en prefs.xml → fichero por defecto).
const PIDGIN_SOUNDS = {
  private: ["im_recv", "receive.wav"],
  mention: ["nick_said", "alert.wav"],
  room: ["chat_msg_recv", "receive.wav"],
  sent: ["send_im", "send.wav"],
  contactOnline: ["login", "login.wav"],
  contactOffline: ["logout", "logout.wav"],
};

// Carpetas donde el instalador de Pidgin deja sus sonidos.
export function pidginSoundDirs() {
  return [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.ProgramW6432]
    .filter(Boolean)
    .map((p) => path.join(p, "Pidgin", "sounds", "purple"));
}

// Busca los sonidos de Pidgin sin copiar nada: los personalizados de prefs.xml y, si no, los que trae Pidgin.
// Pidgin es GPL: sus ficheros no se incluyen en EvEX-MPP, solo se copian del Pidgin que el usuario ya tiene.
export function scanPidginSounds({ prefsFile = path.join(purpleDir(), "prefs.xml"), soundDirs = pidginSoundDirs() } = {}) {
  const custom = {};
  const prefs = readXml(prefsFile);
  const find = (el, name) => el?.getChildren("pref").find((c) => c.attrs.name === name);
  const files = find(find(find(prefs, "pidgin"), "sound"), "file");
  for (const f of files?.getChildren("pref") || []) if (f.attrs.value) custom[f.attrs.name] = f.attrs.value;
  const dir = soundDirs.find((d) => fs.existsSync(d)) || null;
  const out = {};
  for (const [kind, [event, def]] of Object.entries(PIDGIN_SOUNDS)) {
    const candidates = [custom[event], dir && path.join(dir, def)].filter(Boolean);
    const file = candidates.find((c) => /\.(wav|mp3|ogg|flac|m4a)$/i.test(c) && fs.existsSync(c));
    if (file) out[kind] = { file, custom: file === custom[event] };
  }
  return { found: Object.keys(out).length > 0, dir, sounds: out };
}

// ---------- registros ----------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function stripTags(s) {
  // Se repite hasta que no queden etiquetas: quitar una puede dejar otra formada ("<<b>b>").
  let prev;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, "");
  } while (s !== prev);
  return s;
}

// Devuelve texto plano; quien lo muestre debe escaparlo (formatBody lo hace).
function decodeHtml(s) {
  return stripTags(s.replace(/<br\s*\/?>/gi, "\n"))
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

const TIME_RE = /\((?:(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4}) )?(\d{1,2}):(\d{2}):(\d{2})(?: ?([AaPp])\.? ?[Mm]\.?)?\)/;

function fileBaseDate(name) {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})\.(\d{2})(\d{2})(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

function resolveDate(a, b, c, base) {
  // El formato depende de la configuración regional de Pidgin: AAAA/MM/DD, DD/MM/AAAA o MM/DD/AAAA.
  a = +a;
  b = +b;
  c = +c;
  if (a > 999) return [a, b, c];
  const candidates = [];
  if (b <= 12) candidates.push([c, b, a]);
  if (a <= 12) candidates.push([c, a, b]);
  if (!candidates.length) return [c, b, a];
  if (!base) return candidates[0];
  // Elegir la interpretación más cercana (y no posterior) a la fecha del fichero.
  candidates.sort((x, y) => Math.abs(new Date(x[0], x[1] - 1, x[2]) - base) - Math.abs(new Date(y[0], y[1] - 1, y[2]) - base));
  return candidates[0];
}

export function parseLogFile(file, { selfNames = [], isRoom = false } = {}) {
  const name = path.basename(file);
  const base = fileBaseDate(name);
  const html = name.endsWith(".html") || name.endsWith(".htm");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const lines = text.split(/\r?\n/);
  const out = [];
  let lastTs = base ? base.getTime() : 0;
  let day = base ? new Date(base.getFullYear(), base.getMonth(), base.getDate()) : null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (i === 0 && /<title>|^Conversation with/i.test(line)) {
      // La primera línea es la cabecera; en HTML puede contener ya el primer mensaje tras </h3>.
      const after = line.split(/<\/h3>/i)[1];
      if (!after) continue;
      line = after;
    }
    // Pidgin cierra el fichero con "</body></html>" en una sola línea.
    if (/^\s*(<\/?(body|html)>\s*)+$/i.test(line) || !line.trim()) continue;
    const m = line.match(TIME_RE);
    if (!m) {
      const extra = html ? decodeHtml(line) : line;
      if (out.length && extra.trim()) out[out.length - 1].body += "\n" + extra;
      continue;
    }
    const [, d1, d2, d3, hh, mm, ss, ampm] = m;
    let h = +hh;
    if (ampm) {
      const pm = ampm.toLowerCase() === "p";
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    let ts;
    if (d1) {
      const [y, mo, d] = resolveDate(d1, d2, d3, base);
      ts = new Date(y, mo - 1, d, h, +mm, +ss).getTime();
    } else if (day) {
      ts = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, +mm, +ss).getTime();
      if (ts < lastTs - 6 * 3600e3) {
        day = new Date(day.getTime() + 86400e3);
        ts += 86400e3;
      }
      lastTs = ts;
    } else continue;

    const rest = line.slice(line.indexOf(m[0]) + m[0].length);
    let nick = "";
    let body;
    if (html) {
      const nm = rest.match(/^\s*(?:<\/[^>]+>\s*)*<b>(.*?):<\/b>(?:\s*<\/[^>]+>)*\s?([\s\S]*)$/i);
      if (nm) {
        nick = decodeHtml(nm[1]).trim();
        body = decodeHtml(nm[2]);
      } else {
        body = decodeHtml(rest).trim();
      }
    } else {
      const nm = rest.match(/^\s*([^:]{1,64}): ([\s\S]*)$/);
      if (nm) {
        nick = nm[1].trim();
        body = nm[2];
      } else body = rest.trim();
    }
    body = body.replace(/\n+$/, "");
    if (!body && !nick) continue;
    const isSelf = nick && selfNames.includes(nick.toLowerCase());
    const entry = { ts, nick, body };
    if (isSelf) entry.out = 1;
    if (!nick) entry.sys = 1;
    out.push(entry);
  }
  return out;
}

export async function importLogs({ logsDir, selfNames, logs, accountId, alreadyImported, onProgress }) {
  let convs;
  try {
    convs = fs.readdirSync(logsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return { conversations: 0, messages: 0, files: [] };
  }
  const doneFiles = [];
  let messages = 0;
  let idx = 0;
  for (const d of convs) {
    idx++;
    const isRoom = d.name.endsWith(".chat");
    const conv = (isRoom ? d.name.slice(0, -5) : d.name).toLowerCase();
    const dir = path.join(logsDir, d.name);
    const entries = [];
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (alreadyImported[full] || !/\.(html?|txt)$/i.test(f)) continue;
      for (const e of parseLogFile(full, { selfNames, isRoom })) entries.push({ ...e, src: full });
      doneFiles.push(full);
    }
    if (entries.length) messages += logs.mergeImport(accountId, conv, entries);
    onProgress?.({ done: idx, total: convs.length, conv });
    await new Promise((r) => setImmediate(r));
  }
  return { conversations: convs.length, messages, files: doneFiles };
}
