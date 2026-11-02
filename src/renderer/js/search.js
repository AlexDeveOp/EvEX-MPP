// Búsqueda en el historial local de una conversación o de toda la cuenta.
import { S, api, account, displayName } from "./state.js";
import { h, icon, modal, clear, debounce, esc } from "./dom.js";
import { fmtDateTime } from "./format.js";
import { openConv } from "./convs.js";

import { t } from "./i18n.js";
export function openSearch({ accountId, conv } = {}) {
  accountId ||= S.accounts[0]?.id;
  if (!accountId) return;
  let scope = conv ? "conv" : "all";
  const q = h("input", { class: "input", placeholder: t("Texto a buscar…"), autofocus: true });
  const nick = h("input", { class: "input", placeholder: t("Autor (opcional)") });
  const scopeSel = h(
    "select",
    { class: "input", onchange: (e) => ((scope = e.target.value), run()) },
    conv ? h("option", { value: "conv", selected: true }, t("Solo {displayName}", { displayName: displayName(accountId, conv) })) : null,
    h("option", { value: "all", selected: !conv }, t("Todas las conversaciones de {alias}", { alias: account(accountId).alias })),
  );
  const results = h("div", { class: "search-results" }, h("div", { class: "empty-state small" }, icon("search"), h("p", {}, t("Escribe para buscar en el historial guardado."))));

  const highlight = (text, term) => {
    const safe = esc(text);
    if (!term) return safe;
    const re = new RegExp(esc(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    return safe.replace(re, (m) => `<mark>${m}</mark>`);
  };

  const run = debounce(async () => {
    const term = q.value.trim();
    if (term.length < 2 && !nick.value.trim()) return;
    clear(results).append(h("div", { class: "loading" }, h("span", { class: "spinner" }), t("Buscando…")));
    const rows = await api("logs:search", accountId, { query: term, nick: nick.value.trim(), conv: scope === "conv" ? conv : undefined, limit: 400 }).catch(() => []);
    clear(results);
    if (!rows.length) return results.append(h("div", { class: "empty-state small" }, h("p", {}, t("Sin resultados."))));
    results.append(h("div", { class: "muted pad" }, `${rows.length}${rows.length >= 400 ? "+" : ""} resultados`));
    for (const r of rows) {
      const isRoom = r.conv.includes("@conference.") && !r.conv.includes("/");
      results.append(
        h(
          "button",
          {
            class: "search-row",
            onclick: () => {
              m.close();
              openConv(accountId, r.conv, isRoom ? "groupchat" : "chat", { join: isRoom });
            },
          },
          h("div", { class: "search-meta" }, icon(isRoom ? "hash" : "message-square"), h("b", {}, displayName(accountId, r.conv)), h("span", { class: "muted" }, `· ${r.nick || "sistema"} · ${fmtDateTime(r.ts)}`)),
          h("div", { class: "search-body", html: highlight(r.body.slice(0, 400), term) }),
        ),
      );
    }
  }, 250);

  q.addEventListener("input", run);
  nick.addEventListener("input", run);
  const m = modal({
    title: t("Buscar en el historial"),
    icon: "search",
    wide: true,
    body: h("div", { class: "search-layout" }, h("div", { class: "rb-toolbar" }, h("div", { class: "input-group grow" }, icon("search"), q), nick, scopeSel), results),
  });
}
