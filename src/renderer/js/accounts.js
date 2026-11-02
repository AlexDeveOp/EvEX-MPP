// Gestión de cuentas: alta/edición, contraseña, conexión e importación desde Pidgin.
import { S, api, emit, account, conn, onMain } from "./state.js";
import { h, icon, iconButton, modal, field, toast, clear, confirmDialog, select } from "./dom.js";
import { closeConv } from "./convs.js";

import { t, locale } from "./i18n.js";
export async function connectWithPrompt(accountId) {
  try {
    await api("account:connect", accountId);
  } catch (e) {
    if (e.message !== "NEED_PASSWORD") return toast(e.message, { kind: "error" });
    const acc = account(accountId);
    const pass = h("input", { class: "input", type: "password", autofocus: true });
    const save = h("input", { type: "checkbox", checked: acc.savePassword });
    return new Promise((resolve) => {
      const go = async (close) => {
        if (!pass.value) return;
        close();
        if (save.checked) await api("account:save", { account: { id: acc.id, savePassword: true }, password: pass.value });
        api("account:connect", accountId, pass.value).then(resolve, (err) => (toast(err.message, { kind: "error" }), resolve()));
      };
      const m = modal({
        title: t("Contraseña"),
        icon: "key-round",
        body: h("div", { class: "form" }, h("p", { class: "muted" }, t("Introduce la contraseña de {jid}", { jid: acc.jid })), field(t("Contraseña"), pass), h("label", { class: "check" }, save, t("Recordar (cifrada con Windows)"))),
        actions: ["spacer", { label: t("Cancelar"), action: (c) => (c(), resolve()) }, { label: t("Conectar"), primary: true, icon: "log-in", action: go }],
      });
      pass.addEventListener("keydown", (ev) => ev.key === "Enter" && go(m.close));
    });
  }
}

const SECURITY = [
  ["starttls", t("STARTTLS obligatorio (recomendado)")],
  ["direct", t("TLS directo (puerto 5223)")],
  ["opportunistic", t("TLS si está disponible (inseguro)")],
];

// ---------- cambiar de cuenta ----------

// Desconecta las demás cuentas y conecta la elegida; las desconectadas dejan de entrar solas al iniciar.
async function switchTo(accountId, { password, exclusive }) {
  if (exclusive) {
    for (const a of S.accounts) {
      if (a.id === accountId) continue;
      if (conn(a.id).state !== "offline") await api("account:disconnect", a.id).catch(() => {});
      if (a.autoLogin) Object.assign(a, await api("account:save", { account: { id: a.id, autoLogin: false } }));
    }
    // Cerrar las pestañas de las cuentas que dejan de usarse.
    for (const key of [...S.tabs]) {
      const conv = S.convs.get(key);
      if (conv?.accountId && conv.accountId !== accountId) closeConv(key, { leave: false });
    }
  }
  const target = account(accountId);
  if (!target.autoLogin) Object.assign(target, await api("account:save", { account: { id: accountId, autoLogin: true } }));
  emit("accounts");
  await api("account:connect", accountId, password || undefined);
}

export function openSwitchAccount() {
  let exclusive = true;
  const status = h("div", { class: "switch-status hidden" });
  const setStatus = (kind, text) => {
    status.className = `switch-status ${kind}`;
    clear(status).append(kind === "busy" ? h("span", { class: "spinner" }) : icon(kind === "error" ? "triangle-alert" : "check"), h("span", {}, text));
  };

  async function run(accountId, password, close, rememberPassword) {
    setStatus("busy", t("Conectando…"));
    try {
      await switchTo(accountId, { password, exclusive });
      // La contraseña solo se guarda cuando se ha comprobado que funciona.
      if (password && rememberPassword) Object.assign(account(accountId), await api("account:save", { account: { id: accountId, savePassword: true }, password }));
      close();
      toast(t("Conectado como {jid}", { jid: account(accountId).jid }), { kind: "ok" });
    } catch (e) {
      if (e.message === "NEED_PASSWORD") setStatus("error", t("Esa cuenta no tiene contraseña guardada: rellénala abajo."));
      else setStatus("error", e.message);
    }
  }

  // Cuentas ya guardadas
  const saved = h(
    "div",
    { class: "switch-saved" },
    S.accounts.map((a) => {
      const st = conn(a.id);
      const online = st.state === "online";
      return h(
        "div",
        { class: `switch-acc ${online ? "online" : ""}` },
        h("span", { class: `presence-dot ${online ? st.show || "online" : "offline"}` }),
        h("div", { class: "switch-acc-name" }, h("b", {}, a.alias), h("small", { class: "muted" }, `${a.jid} · ${a.host || a.jid.split("@")[1]}:${a.port}`)),
        online
          ? h("span", { class: "chip accent" }, t("Conectada"))
          : h("button", { class: "btn small primary", onclick: () => (a.hasPassword ? run(a.id, null, m.close) : fillForm(a)) }, icon("log-in"), t("Usar esta")),
      );
    }),
  );

  // Cuenta nueva o editar datos de conexión
  const v = { jid: "", password: "", host: "", port: 5222, security: "starttls", conferenceServer: "", savePassword: true };
  const jid = h("input", { class: "input", placeholder: "usuario@ejemplo.com", autofocus: true });
  const pass = h("input", { class: "input", type: "password", placeholder: t("Contraseña") });
  const host = h("input", { class: "input", placeholder: t("Vacío = el dominio de la dirección") });
  const port = h("input", { class: "input", type: "number", value: 5222 });
  const conf = h("input", { class: "input", placeholder: "conference.servidor" });
  const sec = select(SECURITY, v.security, (x) => (v.security = x));
  const remember = h("input", { type: "checkbox", checked: true });
  let editingId = null;

  jid.addEventListener("change", () => {
    const [local, domain] = jid.value.trim().toLowerCase().split("@");
    if (!domain) return;
    const existing = S.accounts.find((a) => a.jid === `${local}@${domain}`);
    if (existing) return fillForm(existing);
    editingId = null;
    if (!conf.value) conf.value = `conference.${domain}`;
  });

  function fillForm(a) {
    editingId = a.id;
    jid.value = a.jid;
    host.value = a.host || "";
    port.value = a.port;
    conf.value = a.conferenceServer || "";
    sec.value = a.security;
    v.security = a.security;
    pass.value = "";
    pass.placeholder = a.hasPassword ? t("•••••••• (guardada — escribe para cambiarla)") : t("Contraseña");
    pass.focus();
  }

  async function connectNew(close) {
    const j = jid.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(j)) return setStatus("error", t("La dirección debe ser usuario@servidor"));
    const existing = editingId ? account(editingId) : S.accounts.find((a) => a.jid === j);
    if (!pass.value && !existing?.hasPassword) return setStatus("error", t("Falta la contraseña"));
    const local = j.split("@")[0];
    try {
      setStatus("busy", t("Guardando…"));
      const savedAcc = await api("account:save", {
        account: {
          ...(existing ? { id: existing.id } : { alias: local, nick: local }),
          jid: j,
          host: host.value.trim(),
          port: Number(port.value) || 5222,
          security: v.security,
          conferenceServer: conf.value.trim() || `conference.${j.split("@")[1]}`,
          savePassword: existing ? existing.savePassword : remember.checked,
          autoLogin: true,
        },
      });
      const i = S.accounts.findIndex((x) => x.id === savedAcc.id);
      if (i >= 0) S.accounts[i] = savedAcc;
      else S.accounts.push(savedAcc);
      emit("accounts");
      await run(savedAcc.id, pass.value || null, close, remember.checked);
    } catch (e) {
      setStatus("error", e.message);
    }
  }

  const m = modal({
    title: t("Cambiar de cuenta"),
    icon: "user-cog",
    className: "switch-modal",
    body: h(
      "div",
      { class: "form" },
      S.accounts.length ? [h("h4", { class: "switch-h" }, t("Cuentas guardadas")), saved] : null,
      h("h4", { class: "switch-h" }, S.accounts.length ? t("Otra cuenta") : t("Tu cuenta")),
      field(t("Dirección (JID)"), jid),
      field(t("Contraseña"), h("div", { class: "input-group" }, pass, iconButton("eye", t("Mostrar"), () => (pass.type = pass.type === "password" ? "text" : "password")))),
      h(
        "div",
        { class: "form grid2" },
        field(t("Servidor de conexión"), host, t("Solo si es distinto del dominio de la dirección")),
        field(t("Puerto"), port),
        field(t("Seguridad"), sec),
        field(t("Servidor de salas"), conf),
      ),
      h("label", { class: "check" }, remember, t("Recordar la contraseña (cifrada con Windows)")),
      S.accounts.length
        ? h("label", { class: "check" }, h("input", { type: "checkbox", checked: true, onchange: (e) => (exclusive = e.target.checked) }), t("Desconectar las demás cuentas"), h("small", { class: "muted" }, t(" — y dejarán de conectarse al iniciar")))
        : null,
      status,
    ),
    actions: ["spacer", { label: t("Cancelar"), action: (c) => c() }, { label: t("Conectar"), primary: true, icon: "log-in", action: connectNew }],
  });
  pass.addEventListener("keydown", (e) => e.key === "Enter" && connectNew(m.close));
}

export function openAccounts(focusId) {
  let current = focusId || S.accounts[0]?.id || null;
  const listEl = h("div", { class: "acc-list" });
  const formEl = h("div", { class: "acc-form" });

  function renderList() {
    clear(listEl);
    for (const a of S.accounts) {
      const st = conn(a.id).state;
      listEl.append(
        h(
          "button",
          { class: `acc-list-item ${a.id === current ? "active" : ""}`, onclick: () => ((current = a.id), renderList(), renderForm()) },
          h("span", { class: `presence-dot ${st === "online" ? conn(a.id).show || "online" : st === "error" ? "dnd" : "offline"}` }),
          h("span", { class: "acc-list-name" }, h("b", {}, a.alias), h("small", { class: "muted" }, a.jid)),
        ),
      );
    }
    listEl.append(h("button", { class: `acc-list-item add ${current === null ? "active" : ""}`, onclick: () => ((current = null), renderList(), renderForm()) }, icon("plus"), t("Nueva cuenta")));
    listEl.append(h("button", { class: "acc-list-item add", onclick: () => (m.close(), openPidginImport()) }, icon("import"), t("Importar de Pidgin")));
  }

  function renderForm() {
    clear(formEl);
    const a = current ? account(current) : null;
    const d = a || { jid: "", alias: "", nick: "", resource: "EvEX-MPP", host: "", port: 5222, security: "starttls", autoLogin: true, savePassword: true, priority: 1, conferenceServer: "", syncBookmarks: true };
    const v = { ...d };
    const inp = (key, attrs = {}) => h("input", { class: "input", value: v[key] ?? "", oninput: (e) => (v[key] = attrs.type === "number" ? Number(e.target.value) : e.target.value), ...attrs });
    const chk = (key, label, hint) => h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!v[key], onchange: (e) => (v[key] = e.target.checked) }), label, hint ? h("small", { class: "muted" }, ` ${hint}`) : null);
    const pass = h("input", { class: "input", type: "password", placeholder: a?.hasPassword ? t("•••••••• (guardada — escribe para cambiarla)") : t("Contraseña") });
    const showPass = iconButton("eye", t("Mostrar"), () => (pass.type = pass.type === "password" ? "text" : "password"));
    const jidInput = inp("jid", { placeholder: "usuario@ejemplo.com", autofocus: !a });
    jidInput.addEventListener("change", () => {
      const [local, domain] = jidInput.value.trim().toLowerCase().split("@");
      if (!v.alias) v.alias = local;
      if (!v.nick) v.nick = local;
      if (!v.conferenceServer && domain) v.conferenceServer = `conference.${domain}`;
      renderFormValues();
    });
    const advanced = h("details", { class: "advanced", open: !!(a && (a.host || a.port !== 5222)) });

    const save = async (connect) => {
      if (!/^[^@\s]+@[^@\s]+$/.test(v.jid.trim())) return toast(t("La dirección debe tener el formato usuario@servidor"), { kind: "error" });
      try {
        const saved = await api("account:save", { account: { ...v, id: a?.id, jid: v.jid.trim().toLowerCase() }, password: pass.value || undefined });
        const i = S.accounts.findIndex((x) => x.id === saved.id);
        if (i >= 0) S.accounts[i] = saved;
        else S.accounts.push(saved);
        current = saved.id;
        emit("accounts");
        renderList();
        renderForm();
        toast(t("Cuenta guardada"), { kind: "ok", timeout: 2000 });
        if (connect) {
          if (!saved.hasPassword && pass.value) await api("account:connect", saved.id, pass.value).catch((e) => toast(e.message, { kind: "error" }));
          else await connectWithPrompt(saved.id);
        }
      } catch (e) {
        toast(e.message, { kind: "error" });
      }
    };

    function renderFormValues() {
      clear(formEl);
      formEl.append(
        h("h3", {}, a ? a.alias : t("Nueva cuenta XMPP")),
        h(
          "div",
          { class: "form grid2" },
          field(t("Dirección (JID)"), jidInput),
          field(t("Contraseña"), h("div", { class: "input-group" }, pass, showPass)),
          field(t("Nombre visible"), inp("alias")),
          field(t("Apodo en salas"), inp("nick")),
          field(t("Servidor de salas (MUC)"), inp("conferenceServer", { placeholder: "conference.servidor" })),
          field(t("Recurso"), inp("resource"), t("Identifica este cliente; distinto de Pidgin para poder usar ambos")),
        ),
        h("div", { class: "checks" }, chk("savePassword", t("Recordar contraseña"), t("(cifrada con DPAPI de Windows)")), chk("autoLogin", t("Conectar al iniciar")), chk("syncBookmarks", t("Sincronizar marcadores de salas con el servidor"))),
        advanced,
      );
      clear(advanced).append(
        h("summary", {}, t("Conexión avanzada")),
        h(
          "div",
          { class: "form grid2" },
          field(t("Servidor de conexión"), inp("host", { placeholder: t("Vacío = dominio del JID") }), t("Solo si el servidor se conecta por un nombre distinto del dominio")),
          field(t("Puerto"), inp("port", { type: "number" })),
          field(t("Seguridad"), select(SECURITY, v.security, (x) => (v.security = x))),
          field(t("Prioridad"), inp("priority", { type: "number" }), t("Si usas Pidgin a la vez, la mayor prioridad recibe los mensajes directos (pings)")),
        ),
      );
      formEl.append(
        h(
          "div",
          { class: "acc-actions" },
          a ? h("button", { class: "btn danger ghost", onclick: () => remove(a) }, icon("trash-2"), t("Eliminar")) : null,
          h("span", { class: "spacer" }),
          a && conn(a.id).state === "online" ? h("button", { class: "btn", onclick: () => api("account:disconnect", a.id).then(renderList) }, icon("power"), t("Desconectar")) : null,
          h("button", { class: "btn", onclick: () => save(false) }, icon("check"), t("Guardar")),
          h("button", { class: "btn primary", onclick: () => save(true) }, icon("log-in"), t("Guardar y conectar")),
        ),
      );
    }
    renderFormValues();
  }

  async function remove(a) {
    if (!(await confirmDialog({ title: t("Eliminar cuenta"), message: t("¿Eliminar {jid} de EvEX-MPP? El historial local se conserva en disco.", { jid: a.jid }), okLabel: t("Eliminar"), danger: true }))) return;
    await api("account:delete", a.id);
    S.accounts = S.accounts.filter((x) => x.id !== a.id);
    current = S.accounts[0]?.id || null;
    emit("accounts");
    renderList();
    renderForm();
  }

  const m = modal({ title: t("Cuentas"), icon: "user-cog", wide: true, body: h("div", { class: "acc-layout" }, listEl, formEl) });
  renderList();
  renderForm();
}

// ---------- importación desde Pidgin ----------

export async function openPidginImport() {
  let scan;
  try {
    scan = await api("pidgin:scan");
  } catch (e) {
    return toast(e.message, { kind: "error" });
  }
  if (!scan.found || !scan.accounts.length) {
    return modal({ title: t("Importar de Pidgin"), icon: "import", body: h("p", {}, t("No se encontraron cuentas XMPP de Pidgin en {dir}.", { dir: scan.dir })), actions: ["spacer", { label: t("Cerrar"), action: (c) => c() }] });
  }
  const chosen = new Set(scan.accounts.map((a) => a.jid));
  const opts = { importRooms: true, importPasswords: true, importLogs: true };
  const progress = h("div", { class: "import-progress hidden" }, h("div", { class: "bar" }, h("i")), h("span", { class: "muted" }));
  const body = h(
    "div",
    { class: "form" },
    h("p", { class: "muted" }, t("Encontrado en {dir}:", { dir: scan.dir })),
    scan.accounts.map((a) =>
      h(
        "label",
        { class: "import-acc" },
        h("input", { type: "checkbox", checked: true, onchange: (e) => (e.target.checked ? chosen.add(a.jid) : chosen.delete(a.jid)) }),
        h(
          "div",
          {},
          h("b", {}, a.jid),
          h("div", { class: "muted small" }, t("Servidor {x}:{port} · {security} · {length} salas ({length2} con autounión) · {logConversations} conversaciones en el historial", { x: a.host || a.jid.split("@")[1], port: a.port, security: a.security, length: a.rooms.length, length2: a.rooms.filter((r) => r.autojoin).length, logConversations: a.logConversations })),
          h("div", { class: "chips" }, a.rooms.map((r) => h("span", { class: `chip ${r.autojoin ? "accent" : ""}` }, r.autojoin ? icon("zap") : icon("hash"), r.name))),
        ),
      ),
    ),
    h("label", { class: "check" }, h("input", { type: "checkbox", checked: true, onchange: (e) => (opts.importRooms = e.target.checked) }), t("Importar salas guardadas y su autounión")),
    h(
      "label",
      { class: "check" },
      h("input", { type: "checkbox", checked: true, onchange: (e) => (opts.importPasswords = e.target.checked) }),
      t("Importar la contraseña guardada"),
      h("small", { class: "muted" }, t(" — Pidgin la guarda en texto plano; aquí se cifra con Windows")),
    ),
    h("label", { class: "check" }, h("input", { type: "checkbox", checked: true, onchange: (e) => (opts.importLogs = e.target.checked) }), t("Importar historial de conversaciones"), h("small", { class: "muted" }, " — puede tardar un poco; no se duplica si lo repites")),
    progress,
  );

  const off = onMain("import-progress", (p) => {
    progress.classList.remove("hidden");
    progress.querySelector("i").style.width = `${Math.round((p.done / p.total) * 100)}%`;
    progress.querySelector("span").textContent = t("Historial: {done}/{total} — {conv}", { done: p.done, total: p.total, conv: p.conv });
  });

  modal({
    title: t("Importar de Pidgin"),
    icon: "import",
    wide: true,
    body,
    onClose: off,
    actions: [
      "spacer",
      { label: t("Cancelar"), action: (c) => c() },
      {
        label: t("Importar"),
        primary: true,
        icon: "import",
        action: async (close) => {
          if (!chosen.size) return;
          body.querySelectorAll("input").forEach((i) => (i.disabled = true));
          progress.classList.remove("hidden");
          progress.querySelector("span").textContent = t("Importando…");
          try {
            const r = await api("pidgin:import", { jids: [...chosen], ...opts });
            S.accounts = r.accounts;
            emit("accounts");
            close();
            const msgs = r.results.reduce((n, x) => n + (x.logs?.messages || 0), 0);
            toast(t("Importado: {accounts} cuenta(s), {rooms} salas{extra}.", { accounts: r.results.length, rooms: r.results.reduce((n, x) => n + x.rooms, 0), extra: opts.importLogs ? t(", {n} mensajes de historial", { n: msgs.toLocaleString(locale()) }) : "" }), { kind: "ok", timeout: 8000 });
            for (const x of r.results) if (x.password) api("account:connect", x.accountId).catch((e) => toast(e.message, { kind: "error" }));
            emit("imported");
          } catch (e) {
            toast(t("Error al importar: {message}", { message: e.message }), { kind: "error" });
            body.querySelectorAll("input").forEach((i) => (i.disabled = false));
          }
        },
      },
    ],
  });
}
