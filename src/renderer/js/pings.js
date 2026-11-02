// Vista de pings de flota: convierte los broadcasts (p. ej. de un bot como pingbot) en tarjetas.
import { h, icon, esc } from "./dom.js";
import { formatBody, fmtDateTime, fmtEve, fmtTimes, timeAgo } from "./format.js";
import { S } from "./state.js";

import { t } from "./i18n.js";
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
const FIELD_RE = /^([A-Za-z][\w ./()'&-]{1,32}?)\s*:[\s\u200B-\u200D\u2060\uFEFF]*(.+)$/;
// p. ej. "~~~ This was a coord broadcast from bob to all at 2026-11-02 12:00:00 EVE ~~~"
const FOOTER_RE = /~~~\s*This was an?\s+(?:[\w-]+\s+)?(?:broadcast|ping)\s+from\s+(\S+)\s+to\s+(\S+)\s+at\s+(.+?)\s*~~~/i;

export function parsePing(body) {
  const lines = body.split("\n");
  const fields = [];
  const title = [];
  const extra = [];
  let footer = null;
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    // El pie "~~~ This was a … broadcast ~~~" puede venir en su propia línea o al final de otra.
    const inline = line.match(FOOTER_RE);
    const f = inline || line.replace(INVISIBLE, "").match(FOOTER_RE);
    if (f) {
      footer = { from: f[1], to: f[2], at: f[3] };
      line = inline ? line.replace(inline[0], "").trim() : "";
      if (!line) continue;
    }
    const m = line.match(FIELD_RE);
    if (m && !/^https?$/i.test(m[1].trim())) fields.push({ key: m[1].trim(), value: m[2].trim() });
    else if (!fields.length) title.push(line);
    else extra.push(line);
  }
  return { title: title.join(" ") || t("Ping"), fields, extra, footer };
}

const FIELD_ICONS = { "fc name": "crown", fc: "crown", "formup location": "map-pin", formup: "map-pin", location: "map-pin", "pap type": "flag", comms: "radio", doctrine: "swords", ships: "rocket", target: "crosshair", time: "clock" };

function fieldValue(key, value) {
  const k = key.toLowerCase();
  if (/formup|location|system/.test(k)) {
    const sys = value.replace(INVISIBLE, "").trim().split(/[\s,(]/)[0];
    if (/^[A-Za-z0-9-]{3,12}$/.test(sys)) {
      return h("span", { html: formatBody(value).html + ` <a class="link dotlan" href="https://evemaps.dotlan.net/system/${encodeURIComponent(sys)}" title="${esc(t("Ver {system} en Dotlan", { system: sys }))}">🗺 Dotlan</a>` });
    }
  }
  return h("span", { html: formatBody(value).html });
}

export function pingCard(m) {
  const p = parsePing(m.body);
  const age = Date.now() - m.ts;
  const card = h(
    "article",
    { class: `ping-card ${age < 3600e3 ? "fresh" : ""}`, dataset: { key: m.key } },
    h(
      "header",
      { class: "ping-head" },
      icon("siren", "ping-icon"),
      h("div", { class: "ping-title", html: formatBody(p.title).html }),
      p.footer ? h("span", { class: "ping-group", title: t("Destinatarios") }, p.footer.to) : null,
      h("time", { class: "ping-time", title: fmtTimes(m.ts) }, timeAgo(m.ts)),
    ),
    p.fields.length
      ? h(
          "dl",
          { class: "ping-fields" },
          p.fields.map((f) => [h("dt", {}, icon(FIELD_ICONS[f.key.toLowerCase()] || "chevron-right"), f.key), h("dd", {}, fieldValue(f.key, f.value))]),
        )
      : null,
    p.extra.length ? h("div", { class: "ping-extra", html: formatBody(p.extra.join("\n")).html }) : null,
    h(
      "footer",
      { class: "ping-foot" },
      p.footer ? h("span", {}, icon("megaphone"), ` ${p.footer.from}`) : h("span", {}, m.nick),
      h(
        "span",
        { class: "ping-times", title: fmtTimes(m.ts) },
        S.settings.showLocalTime !== false ? h("span", { class: "muted" }, `${fmtDateTime(m.ts)} local`) : null,
        S.settings.showEveTime !== false ? h("span", { class: "eve" }, t("{eve} EVE", { eve: fmtEve(m.ts, true) })) : null,
      ),
      h(
        "button",
        {
          class: "btn small ghost",
          onclick: () => navigator.clipboard.writeText(m.body),
          title: t("Copiar el ping completo"),
        },
        icon("copy"),
        t("Copiar"),
      ),
    ),
  );
  return card;
}

export function pingMatches(m, query, group) {
  if (group) {
    const p = parsePing(m.body);
    if ((p.footer?.to || "") !== group) return false;
  }
  if (!query) return true;
  return m.body.replace(INVISIBLE, "").toLowerCase().includes(query.toLowerCase());
}

export function pingGroups(messages) {
  const set = new Set();
  for (const m of messages) {
    const to = parsePing(m.body).footer?.to;
    if (to) set.add(to);
  }
  return [...set].sort();
}
