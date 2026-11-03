// Importa cuentas XMPP, salas guardadas y registros de conversación desde Pidgin (%APPDATA%\.purple).
import fs from "node:fs";
import path from "node:path";
import { parse } from "ltx";

// EVEX_PURPLE_DIR permite probar con un perfil de Pidgin de mentira sin tocar el real.
export function purpleDir() {
  return process.env.EVEX_PURPLE_DIR || path.join(process.env.APPDATA || "", ".purple");
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

// El formato depende de la configuración regional de Pidgin: AAAA/MM/DD, DD/MM/AAAA o MM/DD/AAAA.
// order: "dmy" | "mdy" | null (detectado con detectDateOrder en todos los registros de la cuenta).
// Sin orden conocido se descartan las interpretaciones posteriores a la fecha del fichero (+2 días, por sesiones largas):
// un registro no puede tener mensajes del futuro. Antes no se descartaban y 12/08 (12 de agosto) salía como 8 de diciembre.
// legacy: la regla antigua, solo para reparar lo que se importó con ella.
function resolveDate(a, b, c, base, order = null, legacy = false) {
  a = +a;
  b = +b;
  c = +c;
  if (a > 999) return [a, b, c];
  if (!legacy && order === "dmy") return [c, b, a];
  if (!legacy && order === "mdy") return [c, a, b];
  let candidates = [];
  if (b <= 12) candidates.push([c, b, a]);
  if (a <= 12) candidates.push([c, a, b]);
  if (!candidates.length) return [c, b, a];
  if (!base) return candidates[0];
  if (!legacy) {
    const limit = base.getTime() + 2 * 86400e3;
    const notFuture = candidates.filter((x) => new Date(x[0], x[1] - 1, x[2]).getTime() <= limit);
    if (notFuture.length) candidates = notFuture;
  }
  // La interpretación más cercana a la fecha del fichero.
  candidates.sort((x, y) => Math.abs(new Date(x[0], x[1] - 1, x[2]) - base) - Math.abs(new Date(y[0], y[1] - 1, y[2]) - base));
  return candidates[0];
}

const DATE_IN_LOG = /\((\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4} \d{1,2}:\d{2}:\d{2}/g;
// Mira las fechas de los registros hasta encontrar una que delate el formato (un 25/10 solo puede ser día/mes).
export function detectDateOrder(files) {
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(DATE_IN_LOG)) {
      if (+m[1] > 12) return "dmy";
      if (+m[2] > 12) return "mdy";
    }
  }
  return null;
}

// Avisos que Pidgin escribe en sus registros (entradas, salidas, desconexiones, cambios de apodo…): no son mensajes y
// no se importan. Se conservan los cambios de tema, que Pidgin también muestra.
const TOPIC_RE = /ha cambiado el tema|cambi[oó] el tema|changed the topic/i;

// dateOrder: formato de fecha detectado para la cuenta. legacy: leer como las versiones anteriores (solo para reparar).
export function parseLogFile(file, { selfNames = [], isRoom = false, dateOrder = null, legacy = false } = {}) {
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
  let skipping = false;

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
      // Las líneas de continuación de un aviso descartado se descartan con él (antes se pegaban al mensaje anterior).
      if (skipping) continue;
      const extra = html ? decodeHtml(line) : line;
      if (out.length && extra.trim()) out[out.length - 1].body += "\n" + extra;
      continue;
    }
    skipping = false;
    const [, d1, d2, d3, hh, mm, ss, ampm] = m;
    let h = +hh;
    if (ampm) {
      const pm = ampm.toLowerCase() === "p";
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    let ts;
    if (d1) {
      const [y, mo, d] = resolveDate(d1, d2, d3, base, dateOrder, legacy);
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
      // Acción /me: Pidgin la escribe como «***nick acción».
      const act = !legacy && !nm && rest.match(/^\s*(?:<\/[^>]+>\s*)*<b>\*\*\*(.*?)<\/b>(?:\s*<\/[^>]+>)*\s?([\s\S]*)$/i);
      if (nm) {
        nick = decodeHtml(nm[1]).trim();
        body = decodeHtml(nm[2]);
      } else if (act) {
        nick = decodeHtml(act[1]).trim();
        body = `/me ${decodeHtml(act[2]).trim()}`;
      } else {
        body = decodeHtml(rest).trim();
      }
    } else {
      const nm = rest.match(/^\s*([^:]{1,64}): ([\s\S]*)$/);
      const act = !legacy && !nm && rest.match(/^\s*\*\*\*(\S+) ([\s\S]*)$/);
      if (nm) {
        nick = nm[1].trim();
        body = nm[2];
      } else if (act) {
        nick = act[1];
        body = `/me ${act[2]}`;
      } else body = rest.trim();
    }
    body = body.replace(/\n+$/, "");
    if (!body && !nick) continue;
    if (!legacy && !nick && !TOPIC_RE.test(body)) {
      skipping = true;
      continue;
    }
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
  // El formato de fecha se decide una vez con todos los registros de la cuenta: un fichero suelto puede no tener
  // ninguna fecha que lo delate.
  const dateOrder = detectDateOrder(logFiles(logsDir, convs));
  for (const d of convs) {
    idx++;
    const isRoom = d.name.endsWith(".chat");
    const conv = (isRoom ? d.name.slice(0, -5) : d.name).toLowerCase();
    const dir = path.join(logsDir, d.name);
    const entries = [];
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (alreadyImported[full] || !/\.(html?|txt)$/i.test(f)) continue;
      for (const e of parseLogFile(full, { selfNames, isRoom, dateOrder })) entries.push({ ...e, src: full });
      doneFiles.push(full);
    }
    if (entries.length) messages += logs.mergeImport(accountId, conv, entries);
    onProgress?.({ done: idx, total: convs.length, conv });
    await new Promise((r) => setImmediate(r));
  }
  return { conversations: convs.length, messages, files: doneFiles };
}

function logFiles(logsDir, convs) {
  const out = [];
  for (const d of convs) {
    const dir = path.join(logsDir, d.name);
    try {
      for (const f of fs.readdirSync(dir)) if (/\.(html?|txt)$/i.test(f)) out.push(path.join(dir, f));
    } catch {}
  }
  return out;
}

// ---------- reparar lo importado con versiones anteriores ----------

// ¿Ofrecer la reparación al arrancar? Solo una vez, si hay ficheros importados con una versión anterior (valor 1;
// los actuales valen 2) y no se ha reparado ya: ni la marca __logsRepaired ni una carpeta logs-copia-* (de una
// reparación anterior a la marca). hasTargets (¿tiene Pidgin registros de alguna cuenta?) se mira lo último.
export function shouldOfferRepair({ imported = {}, dataEntries = [], hasTargets = () => true }) {
  if (imported.__logsRepaired || imported.__repairOffered) return false;
  if (!Object.entries(imported).some(([k, v]) => !k.startsWith("__") && v === 1)) return false;
  if (dataEntries.some((n) => n.startsWith("logs-copia-"))) return false;
  return !!hasTargets();
}

const SEP = String.fromCharCode(0);
// Reconoce una entrada importada: autor, segundo exacto y texto (sin espacios sobrantes).
const entryKey = (e) => `${e.nick || ""}${SEP}${Math.floor((e.ts || 0) / 1000)}${SEP}${String(e.body ?? "").trim()}`;
const sameClock = (a, b) => {
  const x = new Date(a);
  const y = new Date(b);
  return x.getHours() === y.getHours() && x.getMinutes() === y.getMinutes() && x.getSeconds() === y.getSeconds();
};

// Sin volver a importar: lee otra vez los registros de Pidgin con la regla antigua y con la nueva y, en el historial
// guardado, corrige la fecha de los mensajes mal fechados, convierte las acciones /me y quita los avisos de Pidgin.
export async function repairImportedLogs({ logsDir, selfNames, logs, accountId, onProgress }) {
  let convs;
  try {
    convs = fs.readdirSync(logsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return { conversations: 0, fixed: 0, removed: 0, dateOrder: null };
  }
  const dateOrder = detectDateOrder(logFiles(logsDir, convs));
  let fixed = 0;
  let removed = 0;
  let conversations = 0;
  let idx = 0;
  for (const d of convs) {
    idx++;
    const isRoom = d.name.endsWith(".chat");
    const conv = (isRoom ? d.name.slice(0, -5) : d.name).toLowerCase();
    const dir = path.join(logsDir, d.name);
    // Para cada entrada tal y como la importó la versión anterior: null = quitarla; objeto = sus datos correctos.
    const plan = new Map();
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(html?|txt)$/i.test(f)) continue;
      const full = path.join(dir, f);
      const before = parseLogFile(full, { selfNames, isRoom, legacy: true });
      const after = parseLogFile(full, { selfNames, isRoom, dateOrder });
      // Las entradas que se conservan salen en el mismo orden en las dos lecturas. Se busca unas cuantas por delante
      // para que una diferencia (p. ej. una línea de continuación) no desempareje el resto del fichero.
      const same = (old, next) => {
        if (!next || next.nick !== old.nick && !(next.body.startsWith("/me ") && !old.nick)) return false;
        const a = old.body.trim();
        const b = next.body.trim();
        const text = b === a || (b.startsWith("/me ") && a === `***${next.nick} ${b.slice(4).trim()}`) || (a.length > 20 && b.startsWith(a.split("\n")[0]));
        return text && sameClock(next.ts, old.ts);
      };
      let k = 0;
      for (const old of before) {
        let j = k;
        while (j < after.length && j < k + 8 && !same(old, after[j])) j++;
        if (j < after.length && j < k + 8) {
          const next = after[j];
          k = j + 1;
          if (next.ts !== old.ts || next.nick !== old.nick || next.body !== old.body) plan.set(entryKey(old), next);
        } else if (!old.nick && !TOPIC_RE.test(old.body)) plan.set(entryKey(old), null);
      }
    }
    if (plan.size) {
      const changed = logs.rewrite(accountId, conv, (e) => {
        const key = entryKey(e);
        if (!plan.has(key)) return e;
        const next = plan.get(key);
        if (!next) {
          removed++;
          return null;
        }
        fixed++;
        const { sys, ...rest } = e;
        return { ...(next.nick ? rest : e), ts: next.ts, nick: next.nick, body: next.body };
      });
      if (changed) conversations++;
    }
    onProgress?.({ done: idx, total: convs.length, conv });
    await new Promise((r) => setImmediate(r));
  }
  return { conversations, fixed, removed, dateOrder };
}
