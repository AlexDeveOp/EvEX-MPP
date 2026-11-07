// Historial local: un fichero JSONL por conversación en userData/logs/<cuenta>/.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const NEAR_MS = 120000;
// Los historiales se leen desde el final en bloques de este tamaño: cargar mensajes recientes o antiguos no lee el fichero entero.
const CHUNK = 64 * 1024;
const TS_PREFIX = /^\{"ts":(\d+)[,}]/;

// Líneas del fichero de la última a la primera. Se corta por el byte \n, que en UTF-8 nunca va dentro de otro carácter.
function* linesBackward(fd, size) {
  let pos = size;
  let rest = null;
  while (pos > 0) {
    const len = Math.min(CHUNK, pos);
    pos -= len;
    const chunk = Buffer.alloc(len);
    fs.readSync(fd, chunk, 0, len, pos);
    const data = rest ? Buffer.concat([chunk, rest]) : chunk;
    let end = data.length;
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i] !== 10) continue;
      if (end > i + 1) yield data.toString("utf8", i + 1, end);
      end = i;
    }
    rest = data.subarray(0, end);
  }
  if (rest?.length) yield rest.toString("utf8");
}

function remember(idx, e, src) {
  idx.keys.add(e.key || Logs.key(e));
  const k = `${e.nick}\u0000${e.body}`;
  if (!idx.bodies.has(k)) idx.bodies.set(k, []);
  idx.bodies.get(k).push({ ts: e.ts, src });
}

function nearDuplicate(idx, e, src) {
  const list = idx.bodies.get(`${e.nick}\u0000${e.body}`);
  return !!list?.some((x) => Math.abs(x.ts - e.ts) <= NEAR_MS && (src === undefined || x.src !== src));
}

export class Logs {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.recent = new Map(); // ruta -> Set de claves recientes (deduplicación del historial MUC)
    // Caducidad (retention.js): (accountId, conv) → fecha de corte o null. Lo más antiguo no se vuelve a guardar.
    this.cutoffOf = () => null;
  }

  setRetention(cutoffOf) {
    this.cutoffOf = typeof cutoffOf === "function" ? cutoffOf : () => null;
  }

  expired(accountId, conv, ts) {
    const cut = this.cutoffOf(accountId, conv);
    return cut != null && ts < cut;
  }

  file(accountId, conv) {
    const safe = encodeURIComponent(conv.toLowerCase()).replace(/[*'()!~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return path.join(this.baseDir, accountId, `${safe}.jsonl`);
  }

  static key(e) {
    return crypto.createHash("sha1").update(`${e.nick}\u0000${e.body}\u0000${Math.floor((e.ts || 0) / 1000)}`).digest("hex").slice(0, 16);
  }

  // Claves exactas y marcas de tiempo por autor+texto de las últimas entradas de una conversación.
  recentIndex(file) {
    let idx = this.recent.get(file);
    if (!idx) {
      idx = { keys: new Set(), bodies: new Map() };
      for (const e of this.tailFile(file, 300)) remember(idx, e);
      this.recent.set(file, idx);
    }
    return idx;
  }

  // Devuelve la entrada guardada, o null si era un duplicado.
  // El historial reenviado por una sala puede traer una hora unos segundos distinta de la del mensaje original.
  append(accountId, conv, entry) {
    const file = this.file(accountId, conv);
    const e = {
      ts: entry.ts || Date.now(),
      nick: entry.nick || "",
      body: entry.body ?? "",
      ...(entry.outgoing ? { out: 1 } : {}),
      ...(entry.system ? { sys: 1 } : {}),
      ...(entry.id ? { id: entry.id } : {}),
      ...(entry.fromJid ? { jid: entry.fromJid } : {}),
      ...(entry.replaces ? { rep: entry.replaces } : {}),
      ...(entry.kind ? { kind: entry.kind } : {}),
      // Respuesta de un bot de pings a un envío del Modo FC: está en el chat del bot, pero no es un ping.
      ...(entry.fcReply ? { fc: 1 } : {}),
    };
    e.key = Logs.key(e);
    // Más antiguo que el plazo de caducidad (p. ej. historial de una sala al volver a entrar): no se guarda.
    if (this.expired(accountId, conv, e.ts)) return null;
    const idx = this.recentIndex(file);
    if (idx.keys.has(e.key)) return null;
    if (entry.delayed && nearDuplicate(idx, e)) return null;
    remember(idx, e);
    if (idx.keys.size > 600) this.recent.delete(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(e) + "\n");
    return e;
  }

  // Fusiona entradas antiguas (importación) manteniendo el fichero ordenado por fecha.
  mergeImport(accountId, conv, entries) {
    const file = this.file(accountId, conv);
    const existing = this.tailFile(file, Infinity);
    const idx = { keys: new Set(), bodies: new Map() };
    for (const e of existing) remember(idx, e, "local");
    let added = 0;
    // Mismo autor y texto con menos de 2 min de diferencia en otro fichero = copia del historial de la sala.
    for (const entry of [...entries].sort((a, b) => a.ts - b.ts)) {
      // Lo caducado no se importa (Pidgin, archivo del servidor): volvería a aparecer tras borrarlo.
      if (this.expired(accountId, conv, entry.ts)) continue;
      const { src, ...e } = entry;
      e.key = Logs.key(e);
      if (idx.keys.has(e.key) || nearDuplicate(idx, e, src)) continue;
      remember(idx, e, src);
      existing.push(e);
      added++;
    }
    if (!added) return 0;
    existing.sort((a, b) => a.ts - b.ts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, existing.map((e) => JSON.stringify(e)).join("\n") + "\n");
    this.recent.delete(file);
    return added;
  }

  // Reescribe todas las entradas de una conversación (reparaciones). fn devuelve la entrada, otra en su lugar o null para
  // quitarla. Quedan ordenadas por fecha y sin duplicados; se escribe en un temporal y se renombra (atómico).
  rewrite(accountId, conv, fn) {
    const file = this.file(accountId, conv);
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      return false;
    }
    let changed = false;
    const out = [];
    const seen = new Set();
    for (const line of text.split("\n")) {
      if (!line) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      let r = fn(e);
      if (r !== e) changed = true;
      if (!r) continue;
      if (r !== e) r = { ...r, key: Logs.key(r) };
      const k = r.key || Logs.key(r);
      if (seen.has(k)) {
        changed = true;
        continue;
      }
      seen.add(k);
      out.push(r);
    }
    if (!changed) return false;
    out.sort((a, b) => a.ts - b.ts);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, out.map((e) => JSON.stringify(e)).join("\n") + (out.length ? "\n" : ""));
    fs.renameSync(tmp, file);
    this.recent.delete(file);
    return true;
  }

  // Las últimas `limit` entradas (anteriores a `beforeTs`, si se indica), ordenadas por fecha.
  tailFile(file, limit, beforeTs) {
    const out = [];
    let fd;
    try {
      // Se abre una sola vez y todo se lee del mismo descriptor, sin volver a buscar el fichero por su ruta.
      fd = fs.openSync(file, "r");
      const { size } = fs.fstatSync(fd);
      for (const line of linesBackward(fd, size)) {
        if (out.length >= limit) break;
        // Las entradas empiezan por {"ts":…: las posteriores a beforeTs se saltan sin analizar la línea entera.
        if (beforeTs && Number(TS_PREFIX.exec(line)?.[1]) >= beforeTs) continue;
        try {
          const e = JSON.parse(line);
          if (beforeTs && e.ts >= beforeTs) continue;
          out.push(e);
        } catch {}
      }
    } catch {
      return [];
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    return out.reverse().sort((a, b) => a.ts - b.ts);
  }

  tail(accountId, conv, limit = 200, beforeTs) {
    return this.tailFile(this.file(accountId, conv), limit, beforeTs);
  }

  lastTimestamp(accountId, conv) {
    const t = this.tail(accountId, conv, 1);
    return t.length ? t[t.length - 1].ts : null;
  }

  listConversations(accountId) {
    const dir = path.join(this.baseDir, accountId);
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => {
          const st = fs.statSync(path.join(dir, f));
          return { conv: decodeURIComponent(f.slice(0, -6)), size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
    } catch {
      return [];
    }
  }

  // Asíncrona: lee cada fichero sin bloquear el proceso principal y le cede el turno entre uno y otro.
  async search(accountId, { query, conv, nick, limit = 300 }) {
    const q = String(query || "").toLowerCase();
    const n = String(nick || "").toLowerCase();
    const files = conv ? [{ conv }] : this.listConversations(accountId);
    const results = [];
    for (const f of files) {
      let text;
      try {
        text = await fs.promises.readFile(this.file(accountId, f.conv), "utf8");
      } catch {
        continue;
      }
      await new Promise((r) => setImmediate(r));
      for (const line of text.split("\n")) {
        if (!line) continue;
        const low = line.toLowerCase();
        if (q && !low.includes(q)) continue;
        try {
          const e = JSON.parse(line);
          if (q && !String(e.body).toLowerCase().includes(q)) continue;
          if (n && !String(e.nick).toLowerCase().includes(n)) continue;
          results.push({ conv: f.conv, ...e });
        } catch {}
      }
    }
    results.sort((a, b) => b.ts - a.ts);
    return results.slice(0, limit);
  }
}
