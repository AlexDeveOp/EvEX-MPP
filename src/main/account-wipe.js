// «Borrar la cuenta y todos sus datos locales» (Cuentas → Borrar…): lo que esta app guarda de una cuenta en su carpeta de
// datos (userData), y nada de fuera (ni los registros de Pidgin ni los archivos guardados por el usuario).
// Es un borrado normal de ficheros, no seguro: en un SSD o con copias de seguridad los datos pueden seguir recuperables.
// Cada paso se intenta aunque falle otro, y el resultado dice cuáles no se pudieron hacer.
import fs from "node:fs";
import path from "node:path";
import { Logs } from "./logs.js";

// Rechazos seguidos al entrar: ev es el evento «status» o «auth-rejected» de la cuenta. Devuelve la cuenta nueva y si
// hay que avisar: desde el segundo rechazo de la contraseña, o desde el primero si la cuenta está desactivada o sus
// credenciales han caducado. Conectar bien lo pone a 0; los demás estados (también los errores de red) no lo tocan.
export function nextAuthFailures(count, ev) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (ev?.type === "status") return { count: ev.state === "online" ? 0 : n, notify: false };
  if (ev?.type !== "auth-rejected") return { count: n, notify: false };
  return { count: n + 1, notify: ev.condition !== "not-authorized" || n + 1 >= 2 };
}

// `child` dentro de `parent` (sin salir con .. ni ser la propia carpeta).
export function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

// Claves de los mensajes guardados de una cuenta (las de las marcas SRP y los pings del calendario).
export function messageKeys(logsDir, accountId) {
  const keys = new Set();
  const dir = path.join(logsDir, accountId);
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return keys;
  }
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, f), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const e = JSON.parse(line);
        keys.add(e.key || Logs.key(e));
      } catch {}
    }
  }
  return keys;
}

// Claves que solo tiene esta cuenta: la clave sale del autor, el texto y la hora, así que el mismo ping recibido por dos
// cuentas tiene la misma, y su marca o su flota no se quitan mientras otra cuenta lo conserve.
export function ownMessageKeys(logsDir, accountId, otherIds) {
  const keys = messageKeys(logsDir, accountId);
  for (const other of otherIds) {
    if (!keys.size) break;
    for (const k of messageKeys(logsDir, other)) keys.delete(k);
  }
  return keys;
}

// Quita de los ajustes lo que es de la cuenta. Devuelve cuántas entradas se han quitado.
export function wipeAccountSettings(settings, accountId, keys = new Set()) {
  let n = 0;
  const prefix = `${accountId}|`;
  const dropPrefixed = (obj) => {
    for (const k of Object.keys(obj || {})) if (k.startsWith(prefix)) (delete obj[k], n++);
  };
  dropPrefixed(settings.notifications?.roomModes);
  dropPrefixed(settings.conversationBackgrounds);
  if (Array.isArray(settings.openTabs)) {
    const before = settings.openTabs.length;
    settings.openTabs = settings.openTabs.filter((tab) => tab?.accountId !== accountId);
    n += before - settings.openTabs.length;
  }
  const marks = settings.srp?.marks || {};
  for (const k of Object.keys(marks)) if (keys.has(k)) (delete marks[k], n++);
  const fleets = settings.fleets || {};
  for (const [id, f] of Object.entries(fleets.items || {})) {
    const fromKeys = [f?.msgKey, ...(f?.pingKeys || [])].filter(Boolean);
    if (f?.origin?.accountId === accountId || (fromKeys.length && fromKeys.every((k) => keys.has(k)))) (delete fleets.items[id], n++);
  }
  for (const id of Object.keys(fleets.overrides || {})) if (id.startsWith("p-") && keys.has(id.slice(2))) (delete fleets.overrides[id], n++);
  for (const k of Object.keys(fleets.dismissed || {})) if (keys.has(k)) (delete fleets.dismissed[k], n++);
  return n;
}

// Marcas de «ya importado» de los registros de Pidgin de esta cuenta (rutas con una carpeta usuario@servidor): sin
// quitarlas, al volver a añadir la cuenta no se podrían importar otra vez. Los registros de Pidgin no se tocan.
export function wipeImportMarks(imported, jid) {
  let n = 0;
  const bare = String(jid || "").toLowerCase();
  if (!bare) return 0;
  for (const f of Object.keys(imported || {})) {
    if (f.startsWith("__")) continue;
    const parts = f.split(/[\\/]/).map((p) => {
      try {
        return decodeURIComponent(p).toLowerCase();
      } catch {
        return p.toLowerCase();
      }
    });
    if (parts.some((p) => p === bare || p.startsWith(`${bare}/`))) (delete imported[f], n++);
  }
  return n;
}

// Quita del registro de conexión (y de su copia anterior) las líneas de la cuenta: «<fecha> [<id>] …».
export function wipeConnLogLines(files, accountId) {
  const tag = ` [${accountId}] `;
  let n = 0;
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") continue;
      throw err;
    }
    const lines = text.split("\n");
    const kept = lines.filter((l) => !l.includes(tag));
    if (kept.length === lines.length) continue;
    n += lines.length - kept.length;
    fs.writeFileSync(file, kept.join("\n"));
  }
  return n;
}

// Carpetas de la cuenta: logs/<id> y la de cada copia logs-copia-* (la que hace «Reparar historial importado»).
export function accountDirs(userData, accountId) {
  const dirs = [path.join(userData, "logs", accountId)];
  try {
    for (const d of fs.readdirSync(userData)) if (/^logs-copia-/.test(d)) dirs.push(path.join(userData, d, accountId));
  } catch {}
  // Solo carpetas de dentro de la de datos y con el nombre exacto de la cuenta.
  return dirs.filter((d) => isInside(userData, d) && path.basename(d) === accountId);
}

// Avatar propio de la cuenta (media/avatars/<hash>.<ext>), salvo que otra cuenta use el mismo. Los avatares de los
// contactos se quedan: van por hash, sin decir de qué cuenta vinieron, y otra cuenta puede tener los mismos contactos.
export function wipeOwnAvatar(avatarDir, hash, keepHashes = []) {
  if (!/^[0-9a-f]{40}$/.test(String(hash || "")) || keepHashes.includes(hash)) return 0;
  let n = 0;
  let files;
  try {
    files = fs.readdirSync(avatarDir);
  } catch {
    return 0;
  }
  for (const f of files) {
    if (path.parse(f).name !== hash) continue;
    fs.rmSync(path.join(avatarDir, f), { force: true });
    n++;
  }
  return n;
}

// Todo junto. La cuenta ya debe estar desconectada (lo hace main.js antes). deps:
//   userData, logs (Logs), settings (los ajustes guardados), imported, accountId, jid, otherIds, ownAvatarHash,
//   otherAvatarHashes, avatarDir, connLogFiles, removeSecrets (async), removeAccount (borra la entrada de config.json).
// Devuelve { done: {paso: cantidad}, failed: [{ step, message }] }.
export async function wipeAccount(d) {
  const done = {};
  const failed = [];
  const step = async (name, fn) => {
    try {
      done[name] = (await fn()) ?? true;
    } catch (err) {
      failed.push({ step: name, message: err?.message || String(err) });
    }
  };
  const logsDir = path.join(d.userData, "logs");
  let keys = new Set();
  // Las claves se leen antes de borrar el historial (las marcas y las flotas van por ellas).
  await step("keys", () => ((keys = ownMessageKeys(logsDir, d.accountId, d.otherIds || [])), keys.size));
  await step("settings", () => wipeAccountSettings(d.settings, d.accountId, keys));
  await step("imported", () => wipeImportMarks(d.imported, d.jid));
  await step("history", () => {
    let n = 0;
    for (const dir of accountDirs(d.userData, d.accountId)) {
      if (!fs.existsSync(dir)) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      n++;
    }
    // La caché de deduplicación de los mensajes recientes de la cuenta.
    for (const file of [...(d.logs?.recent?.keys() || [])]) if (isInside(path.join(logsDir, d.accountId), file)) d.logs.recent.delete(file);
    return n;
  });
  await step("connectionLog", () => wipeConnLogLines(d.connLogFiles || [], d.accountId));
  await step("avatar", () => wipeOwnAvatar(d.avatarDir, d.ownAvatarHash, d.otherAvatarHashes || []));
  await step("secrets", () => d.removeSecrets());
  // La entrada de la cuenta, lo último: si algo falló antes, la cuenta sigue en la lista y se puede volver a intentar.
  if (!failed.length) await step("account", () => d.removeAccount());
  return { done, failed };
}
