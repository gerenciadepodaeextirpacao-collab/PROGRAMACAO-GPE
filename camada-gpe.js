/* Programação GPE – camada para rodar FORA do Claude (Netlify), com o banco no SUPABASE.
   Imita window.claude.use("db" | "assets" | "downloads" | "user") usando a tabela public.documentos
   (criada pelo GPE_SUPABASE.sql) e o bucket "midia". Dentro do Claude não faz nada. */
(function () {
  if (window.claude && window.claude.use) return;
  // ====== CONFIGURAÇÃO DO SEU PROJETO SUPABASE ======
  const SUPABASE_URL = "https://eyqbihvatzcjismsszvs.supabase.co";
  const SUPABASE_ANON = "sb_publishable_ekN-TZqBKMwRs6aGHPPejg_rLkBgjgv";
  // ==================================================
  window.GPE_NETLIFY = true;
  const erro = (code, message) => Object.assign(new Error(message || code), { code });
  const novoId = () => { const c = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; crypto.getRandomValues(new Uint8Array(20)).forEach(x => s += c[x % 36]); return s; };
  const sessaoId = () => { try { return JSON.parse(localStorage.getItem("gpe_sessao") || "null")?.id || ""; } catch (e) { return ""; } };

  // carrega a biblioteca do Supabase uma vez
  let _sb;
  function sb() {
    if (_sb) return _sb;
    const fontes = ["https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js", "https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js"];
    const carregar = (i) => new Promise((ok, falha) => {
      if (i >= fontes.length) return falha(erro("unavailable", "biblioteca do Supabase não carregou"));
      const s = document.createElement("script"); s.src = fontes[i];
      s.onload = () => window.supabase ? ok() : carregar(i + 1).then(ok, falha);
      s.onerror = () => carregar(i + 1).then(ok, falha);
      document.head.appendChild(s);
    });
    _sb = carregar(0).then(() => window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 5 } } }))
      .catch(e => { _sb = null; throw e; });
    return _sb;
  }
  const traduz = (e) => { const m = String(e?.message || e || ""); if (/gerente|row-level|violates|permission/i.test(m)) return erro("invalid_argument", m); if (/fetch|network|Failed/i.test(m)) return erro("unavailable", m); return erro("invalid_argument", m); };

  /* ---------- db ---------- */
  const cache = {};            // col -> {docs:{id:dados}, pronto:Promise}
  const assinantes = new Set();
  function notificar(col) { for (const a of [...assinantes]) if (a.col === col) try { a.fn(); } catch (e) {} }
  let canal = null;
  async function tempoReal() {
    if (canal) return; const c = await sb();
    canal = c.channel("gpe-documentos")
      .on("postgres_changes", { event: "*", schema: "public", table: "documentos" }, (p) => {
        const r = p.new && p.new.colecao ? p.new : p.old; if (!r || !r.colecao || !cache[r.colecao]) return;
        if (p.eventType === "DELETE") delete cache[r.colecao].docs[r.id]; else cache[r.colecao].docs[r.id] = p.new.dados;
        notificar(r.colecao);
      })
      .subscribe((st) => { if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") { canal = null; setTimeout(() => recarregarTudo(), 5000); } });
  }
  async function baixar(col) {
    const c = await sb(); const docs = {}; let de = 0;
    for (;;) {
      const { data, error } = await c.from("documentos").select("id,dados").eq("colecao", col).range(de, de + 999);
      if (error) throw traduz(error);
      data.forEach(r => docs[r.id] = r.dados); if (data.length < 1000) break; de += 1000;
    }
    return docs;
  }
  function colecao(col) {
    if (!cache[col]) { cache[col] = { docs: {}, pronto: null }; }
    if (!cache[col].pronto) cache[col].pronto = baixar(col).then(d => { cache[col].docs = d; tempoReal(); return d; }).catch(e => { cache[col].pronto = null; throw e; });
    return cache[col].pronto.then(() => cache[col].docs);
  }
  async function recarregarTudo() { for (const col of Object.keys(cache)) { cache[col].pronto = null; try { await colecao(col); notificar(col); } catch (e) {} } }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) recarregarTudo(); });
  addEventListener("online", () => recarregarTudo());

  const docSnap = (id, d) => ({ id, exists: d != null, data: () => (d == null ? undefined : JSON.parse(JSON.stringify(d))), metadata: {} });
  const OPS = { "==": (a, b) => a === b, "!=": (a, b) => a !== b, "<": (a, b) => a < b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, ">=": (a, b) => a >= b, "in": (a, b) => Array.isArray(b) && b.includes(a), "array-contains": (a, b) => Array.isArray(a) && a.includes(b) };
  const campo = (o, f) => f.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
  function aplicar(docs, q) {
    let arr = Object.entries(docs).map(([id, data]) => ({ id, data }));
    q.filtros.forEach(([f, op, v]) => { const fn = OPS[op]; arr = arr.filter(d => { const x = campo(d.data, f); return x !== undefined && fn && fn(x, v); }); });
    if (q.ordem) { const [f, dir] = q.ordem; arr.sort((a, b) => { const x = campo(a.data, f), y = campo(b.data, f); const r = x < y ? -1 : x > y ? 1 : 0; return dir === "desc" ? -r : r; }); }
    if (q.lim) arr = arr.slice(0, q.lim);
    const lista = arr.map(d => docSnap(d.id, d.data));
    return { docs: lista, size: lista.length, empty: !lista.length };
  }
  function assinar(col, fn, errCb) {
    const a = { col, fn: () => fn(cache[col].docs) }; assinantes.add(a);
    colecao(col).then(d => fn(d)).catch(e => errCb && errCb(e));
    return () => assinantes.delete(a);
  }
  function docRef(col, id) {
    return {
      id,
      async set(dados) {
        const c = await sb().catch(() => { throw erro("unavailable"); });
        const r = col === "cfg" ? await c.rpc("gpe_salvar_cfg", { p_id: id, p_dados: dados, p_sessao: sessaoId() })
                                : await c.from("documentos").upsert({ colecao: col, id, dados }, { onConflict: "colecao,id" });
        if (r.error) throw traduz(r.error);
        if (cache[col]) { cache[col].docs[id] = JSON.parse(JSON.stringify(dados)); notificar(col); }
      },
      async delete() {
        const c = await sb().catch(() => { throw erro("unavailable"); });
        const r = await c.from("documentos").delete().eq("colecao", col).eq("id", id);
        if (r.error) throw traduz(r.error);
        if (cache[col]) { delete cache[col].docs[id]; notificar(col); }
      },
      async get() {
        const c = await sb(); const r = await c.from("documentos").select("dados").eq("colecao", col).eq("id", id).maybeSingle();
        if (r.error) throw traduz(r.error); return docSnap(id, r.data ? r.data.dados : null);
      },
      onSnapshot(cb, errCb) { let ult; return assinar(col, (docs) => { const d = docs[id] ?? null, s = JSON.stringify(d); if (s !== ult) { ult = s; cb(docSnap(id, d)); } }, errCb); }
    };
  }
  function consulta(col, q) {
    return {
      where: (f, op, v) => consulta(col, { ...q, filtros: [...q.filtros, [f, op, v]] }),
      orderBy: (f, dir) => consulta(col, { ...q, ordem: [f, dir || "asc"] }),
      limit: (n) => consulta(col, { ...q, lim: n }),
      doc: (id) => docRef(col, id || novoId()),
      async get() { return aplicar(await colecao(col), q); },
      onSnapshot(cb, errCb) { let ult; return assinar(col, (docs) => { const r = aplicar(docs, q), s = JSON.stringify(r.docs.map(d => [d.id, d.data()])); if (s !== ult) { ult = s; cb(r); } }, errCb); }
    };
  }
  const db = { collection: (col) => consulta(col, { filtros: [], ordem: null, lim: 0 }), doc: (p) => { const [col, id] = String(p).split("/"); return docRef(col, id); } };

  /* ---------- assets: bucket "midia" (servido em /_blob/<id> pelo redirecionamento do netlify.toml) ---------- */
  const assets = {
    async upload(blob, opt) {
      const tipo = ((opt && opt.type) || blob.type || "").split(";")[0];
      if (blob.size > 50 * 1024 * 1024) throw erro("too_large");
      const id = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");
      let c; try { c = await sb(); } catch (e) { throw erro("store_unavailable"); }
      const r = await c.storage.from("midia").upload(id, blob, { contentType: tipo, upsert: false });
      if (r.error) throw erro(/mime|type/i.test(r.error.message) ? "unsupported_type" : /size|large/i.test(r.error.message) ? "too_large" : "upstream_error", r.error.message);
      return { id, url: "/_blob/" + id, sizeBytes: blob.size, contentType: tipo };
    },
    async list() { return { assets: [], usage: { files: 0, bytes: 0, maxFiles: 0, maxBytes: 0 } }; },
    async delete() { return { deleted: false }; }
  };

  /* ---------- downloads ---------- */
  const downloads = { async save({ filename, data }) { const u = URL.createObjectURL(data instanceof Blob ? data : new Blob([data])); const a = document.createElement("a"); a.href = u; a.download = filename || "arquivo"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); } };

  /* ---------- user ---------- */
  const ehGerente = () => { try { return JSON.parse(localStorage.getItem("gpe_sessao") || "null")?.perfil === "gerencia"; } catch (e) { return false; } };
  const user = {
    async id() { let i = localStorage.getItem("gpe_aparelho"); if (!i) { i = "u_" + novoId(); localStorage.setItem("gpe_aparelho", i); } return i; },
    async isOwner() { return ehGerente(); }, async canEdit() { return ehGerente(); }, async can() { return true; },
    async me() { return { id: await user.id(), name: "" }; }, async profiles() { return {}; }
  };

  const mapa = { db, assets, downloads, user };
  // ao abrir: confere a ligação com o Supabase e deixa o motivo do erro para a tela de login mostrar
  async function conferir() {
    let c; try { c = await sb(); } catch (e) { window.GPE_ERRO_BANCO = "Não foi possível baixar a biblioteca do Supabase (internet bloqueada ou fora do ar). Tente de novo em outra rede."; console.error("GPE:", e); return false; }
    try {
      const r = await c.from("documentos").select("id").eq("colecao", "cfg").limit(1);
      if (r.error) { window.GPE_ERRO_BANCO = "O Supabase recusou a conexão: " + r.error.message + ". Confira a chave (anon/publishable) no camada-gpe.js e se o script GPE_SUPABASE.sql foi rodado."; console.error("GPE:", r.error); return false; }
      if (!r.data.length) { window.GPE_ERRO_BANCO = "O banco do Supabase está vazio: rode o script GPE_SUPABASE.sql no SQL Editor."; return false; }
      return true;
    } catch (e) { window.GPE_ERRO_BANCO = "Sem conexão com o Supabase: " + (e.message || e); console.error("GPE:", e); return false; }
  }
  let _ok;
  window.claude = { use: async (nome) => { if (nome === "db") { _ok = _ok || conferir(); if (!(await _ok)) { _ok = null; return null; } } return mapa[nome] || null; } };
})();
