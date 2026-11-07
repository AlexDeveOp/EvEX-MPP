// Modo FC: exportar e importar la configuración para pasarla entre FCs (un fichero JSON).
// - Se exporta SOLO lo que sirve a otro FC: cómo se eligen los grupos, los grupos, la plantilla, las pestañas, las
//   confirmaciones y el avanzado.
// - NUNCA sale lo personal: ni la cuenta (channel.accountId), ni signAs (cómo firma cada uno), ni si el modo está activo,
//   ni pings guardados, contraseñas o historial. Se construye campo a campo (lista blanca), así que un ajuste nuevo de
//   fcMode no sale hasta que alguien lo añada aquí a propósito.
// - El canal del bot SÍ sale (su JID y si es sala o chat), sin la cuenta: es un bot o una sala de la alianza, igual para
//   todos sus FCs, y sin él el modo «línea al principio» no funciona tras importar. Cada uno lo usa con su propia cuenta.
// - Importar nunca aplica nada: devuelve la vista previa y la configuración ya mezclada con la actual; la aplica la
//   interfaz si el usuario dice que sí. Lo personal del que importa se conserva.
// - El texto de la plantilla va tal cual, con sus invisibles (opsec): ni se recorta ni se limpia.
import { normalizeFcMode, safeWebUrl } from "./store.js";

export const FC_SHARE_APP = "EvEX-MPP";
export const FC_SHARE_KIND = "fc-config";
export const FC_SHARE_VERSION = 1;
// Un fichero de configuración real ocupa unos pocos KB; esto deja margen de sobra y corta lo absurdo antes de leerlo.
export const FC_SHARE_MAX_BYTES = 256 * 1024;
export const FC_SHARE_MAX_GROUPS = 200;
// Códigos de error (error.code); el texto lo pone la interfaz. Por IPC llegan como «…fc-share:<código>».
export const FC_SHARE_ERRORS = ["too-big", "bad-json", "not-fc-config", "newer-version", "bad-version", "bad-config", "too-many-groups"];

function shareError(code, data = {}) {
  return Object.assign(new Error(`fc-share:${code}`), { code, ...data });
}
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// Lo compartible de una configuración ya normalizada (lista blanca).
function shareable(f) {
  return {
    groupMode: f.groupMode,
    lineFormat: f.lineFormat,
    webUrl: f.webUrl,
    channel: { jid: f.channel.jid, kind: f.channel.kind },
    groups: f.groups.map((g) => ({ name: g.name, address: g.address, button: g.button, manual: g.manual })),
    defaultGroup: f.defaultGroup,
    template: { fields: [...f.template.fields], format: f.template.format },
    tabs: [...f.tabs],
    defaultTab: f.defaultTab,
    confirm: f.confirm,
    confirmMulti: f.confirmMulti,
    botNick: f.botNick,
    sentPattern: f.sentPattern,
    rejectedPattern: f.rejectedPattern,
  };
}

// fcMode (los ajustes guardados) → objeto listo para JSON.stringify.
export function exportFcConfig(fcMode) {
  return { app: FC_SHARE_APP, kind: FC_SHARE_KIND, v: FC_SHARE_VERSION, config: shareable(normalizeFcMode(fcMode)) };
}

export const exportFcConfigText = (fcMode) => `${JSON.stringify(exportFcConfig(fcMode), null, 2)}\n`;

// text: el contenido del fichero; current: el fcMode actual del que importa.
// → { preview, merged }. Lanza un error con code si el fichero no vale. No aplica nada.
export function importFcConfig(text, current = {}) {
  if (typeof text !== "string") throw shareError("bad-json");
  if (Buffer.byteLength(text, "utf8") > FC_SHARE_MAX_BYTES) throw shareError("too-big");
  let data;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw shareError("bad-json");
  }
  if (!isObj(data) || data.app !== FC_SHARE_APP || data.kind !== FC_SHARE_KIND) throw shareError("not-fc-config");
  if (!Number.isInteger(data.v) || data.v < 1) throw shareError("bad-version");
  if (data.v > FC_SHARE_VERSION) throw shareError("newer-version", { version: data.v });
  const c = data.config;
  if (!isObj(c)) throw shareError("bad-config");
  if (c.groups !== undefined && !Array.isArray(c.groups)) throw shareError("bad-config");
  if ((c.groups || []).length > FC_SHARE_MAX_GROUPS) throw shareError("too-many-groups");

  const warnings = [];
  const cur = normalizeFcMode(current);
  // Solo se leen los campos compartibles; cualquier otro (accountId, signAs, enabled, lo que sea) se ignora.
  const ch = isObj(c.channel) ? c.channel : {};
  const tp = isObj(c.template) ? c.template : {};
  if (typeof c.webUrl === "string" && c.webUrl.trim() && !safeWebUrl(c.webUrl)) warnings.push("web-url-dropped");
  const incoming = {
    groupMode: c.groupMode,
    lineFormat: c.lineFormat,
    webUrl: c.webUrl,
    groups: c.groups,
    defaultGroup: c.defaultGroup,
    tabs: c.tabs,
    defaultTab: c.defaultTab,
    confirm: c.confirm,
    confirmMulti: c.confirmMulti,
    botNick: c.botNick,
    sentPattern: c.sentPattern,
    rejectedPattern: c.rejectedPattern,
  };
  const merged = normalizeFcMode({
    ...cur,
    ...Object.fromEntries(Object.entries(incoming).filter(([, v]) => v !== undefined)),
    // Lo personal se queda como estaba.
    enabled: cur.enabled,
    channel: {
      accountId: cur.channel.accountId,
      jid: typeof ch.jid === "string" && ch.jid.trim() ? ch.jid : cur.channel.jid,
      kind: typeof ch.jid === "string" && ch.jid.trim() ? ch.kind : cur.channel.kind,
    },
    template: {
      fields: tp.fields !== undefined ? tp.fields : cur.template.fields,
      format: typeof tp.format === "string" ? tp.format : cur.template.format,
      signAs: cur.template.signAs,
    },
  });
  const givenGroups = (c.groups || []).length;
  if (givenGroups > merged.groups.length) warnings.push("groups-dropped");

  const before = shareable(cur);
  const after = shareable(merged);
  const changes = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  const preview = {
    groupMode: merged.groupMode,
    channelJid: merged.channel.jid,
    lineFormat: merged.lineFormat,
    webUrl: merged.webUrl,
    groups: merged.groups.map((g) => ({ name: g.name, address: g.address, button: g.button })),
    fields: [...merged.template.fields],
    format: merged.template.format,
    tabs: [...merged.tabs],
    changes,
    warnings,
  };
  return { preview, merged };
}
