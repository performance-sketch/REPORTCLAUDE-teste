/*
 * calendario.js — Calendário de Voos (Dashboard Vertical Rio)
 *
 * Visões de ano, mês e semana com os slots de voo e o PAX de cada slot.
 * Dados: data/slots.json (scripts/gerar_slots.py) — reservas confirmadas por data + horário local
 * + produto, com a capacidade da sessão quando o Rezdy informa. Se o arquivo ainda não existir,
 * usa data/comparacao.json, que tem a data do voo mas não o horário (sinalizado na tela).
 */
(() => {
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const SEM = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const SEM_HORA = '—';
  const VIEW_KEY = 'vr_cal_visao';
  const S = {visao: 'mes', ref: null, dados: null, fonte: null, gerado: null, produtos: [], filtro: null, sel: null, carregando: null};
  try { S.visao = localStorage.getItem(VIEW_KEY) || 'mes'; } catch (_) {}

  // ─── Datas ─────────────────────────────────────────────────────────────────
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dia = s => new Date(s + 'T12:00:00');
  const mais = (s, n) => { const d = dia(s); d.setDate(d.getDate() + n); return iso(d); };
  const hoje = () => (typeof HOJE === 'string' ? HOJE : iso(new Date()));
  const segunda = s => { const d = dia(s); return mais(s, -((d.getDay() + 6) % 7)); };
  const br = s => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  const num = (v, d = 0) => Number(v || 0).toLocaleString('pt-BR', {minimumFractionDigits: d, maximumFractionDigits: d});
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

  // ─── Dados ─────────────────────────────────────────────────────────────────
  async function carregar() {
    if (S.dados) return;
    if (!S.carregando) S.carregando = (async () => {
      let j = null;
      try { const r = await fetch('data/slots.json', {cache: 'no-cache'}); if (r.ok) j = await r.json(); } catch (_) {}
      const porDia = {};
      const add = (d, h, p, pax, r, cap, liv) => (porDia[d] ||= []).push({h, p, pax, r, cap, liv});
      if (j && Array.isArray(j.s)) {
        S.fonte = 'slots'; S.produtos = j.produtos; S.gerado = j.gerado_em;
        for (const [d, h, p, pax, r, cap, liv] of j.s) add(d, h, p, pax, r, cap, liv);
      } else {
        // Sem slots.json: data do voo e PAX vêm da comparação de períodos, sem horário
        const r = await fetch('data/comparacao.json', {cache: 'no-cache'});
        const c = await r.json();
        S.fonte = 'comparacao'; S.produtos = c.produtos; S.gerado = c.gerado_em;
        const agg = {};
        for (const b of c.b) {
          if (b[2] !== 'C' || !b[7]) continue;
          for (const [p, t, , pax] of b[7]) {
            if (!t || !pax) continue;
            const k = t + '|' + p;
            (agg[k] ||= {d: t, p, pax: 0, r: 0}); agg[k].pax += pax; agg[k].r++;
          }
        }
        for (const v of Object.values(agg)) add(v.d, SEM_HORA, v.p, v.pax, v.r, null, null);
      }
      // Produtos que não são voo ficam fora do filtro padrão
      const naoVoo = /gift card|no-show|shuttle/i;
      S.filtro = new Set(S.produtos.map((n, i) => naoVoo.test(n) ? null : i).filter(i => i !== null));
      S.dados = porDia;
    })();
    await S.carregando;
  }

  // Slots de um dia, somando os produtos filtrados que voam no mesmo horário
  function slotsDoDia(d) {
    const m = {};
    for (const x of S.dados[d] || []) {
      if (!S.filtro.has(x.p)) continue;
      const s = (m[x.h] ||= {h: x.h, pax: 0, r: 0, cap: null, liv: null, prods: {}});
      s.pax += x.pax; s.r += x.r;
      if (x.cap != null) { s.cap = (s.cap || 0) + x.cap; s.liv = (s.liv || 0) + x.liv; }
      if (x.pax) s.prods[x.p] = (s.prods[x.p] || 0) + x.pax;
    }
    return Object.values(m).sort((a, b) => a.h.localeCompare(b.h));
  }

  function resumo(ini, fim) {
    let pax = 0, voos = 0, cap = 0, ocup = 0, pico = null;
    for (let d = ini; d <= fim; d = mais(d, 1)) {
      let pd = 0;
      for (const s of slotsDoDia(d)) {
        pax += s.pax; pd += s.pax;
        if (s.pax) voos++;
        if (s.cap) { cap += s.cap; ocup += s.cap - s.liv; }
      }
      if (pd && (!pico || pd > pico.pax)) pico = {d, pax: pd};
    }
    return {pax, voos, cap, ocup, pico};
  }

  // ─── Cores (escala sequencial de um só tom; 0 = sem cor) ───────────────────
  const tom = (v, max) => {
    if (!v || !max) return '';
    const a = 0.14 + 0.76 * Math.min(1, v / max);
    return `background:rgba(99,102,241,${a.toFixed(2)});${a > 0.55 ? 'color:#fff;' : ''}`;
  };

  // ─── Visões ────────────────────────────────────────────────────────────────
  function periodo() {
    const r = S.ref;
    if (S.visao === 'ano') return {ini: `${r.slice(0, 4)}-01-01`, fim: `${r.slice(0, 4)}-12-31`, titulo: r.slice(0, 4)};
    if (S.visao === 'mes') {
      const y = +r.slice(0, 4), m = +r.slice(5, 7);
      return {ini: `${y}-${pad(m)}-01`, fim: iso(new Date(y, m, 0)), titulo: `${MESES[m - 1]} ${y}`};
    }
    const ini = segunda(r), fim = mais(ini, 6);
    return {ini, fim, titulo: `Semana de ${br(ini)} a ${br(fim)}/${fim.slice(0, 4)}`};
  }

  function navegar(passo) {
    const r = dia(S.ref);
    if (S.visao === 'ano') r.setFullYear(r.getFullYear() + passo, 0, 1);
    else if (S.visao === 'mes') r.setMonth(r.getMonth() + passo, 1);
    else r.setDate(r.getDate() + 7 * passo);
    S.ref = iso(r); S.sel = null; render();
  }

  function vAno(P) {
    const y = +P.ini.slice(0, 4);
    let max = 0;
    const totDia = {};
    for (let d = P.ini; d <= P.fim; d = mais(d, 1)) { const t = slotsDoDia(d).reduce((s, x) => s + x.pax, 0); totDia[d] = t; max = Math.max(max, t); }
    let h = '<div class="cal-ano">';
    for (let m = 1; m <= 12; m++) {
      const ini = `${y}-${pad(m)}-01`, nd = new Date(y, m, 0).getDate();
      let tot = 0, cel = '';
      for (let i = 0; i < (dia(ini).getDay() + 6) % 7; i++) cel += '<span></span>';
      for (let k = 1; k <= nd; k++) {
        const d = `${y}-${pad(m)}-${pad(k)}`, v = totDia[d]; tot += v;
        cel += `<button type="button" data-dia="${d}" class="${d === hoje() ? 'hj' : ''}" style="${tom(v, max)}" title="${br(d)}: ${num(v)} pax">${k}</button>`;
      }
      h += `<div class="cal-mini"><button type="button" class="cal-mt" data-mes="${ini}">${MESES[m - 1]}<span>${num(tot)} pax</span></button><div class="cal-mg">${SEM.map(s => `<i>${s[0]}</i>`).join('')}${cel}</div></div>`;
    }
    return h + '</div><div class="cal-leg">Cor mais forte = mais PAX no dia (máximo do ano: ' + num(max) + '). Clique no mês para abrir o mês, ou no dia para abrir a semana.</div>';
  }

  function vMes(P) {
    let max = 0;
    const dias = [];
    for (let d = P.ini; d <= P.fim; d = mais(d, 1)) { const sl = slotsDoDia(d); const t = sl.reduce((s, x) => s + x.pax, 0); dias.push({d, sl, t}); max = Math.max(max, t); }
    let h = `<div class="cal-mes">${SEM.map(s => `<div class="cal-dh">${s}</div>`).join('')}`;
    for (let i = 0; i < (dia(P.ini).getDay() + 6) % 7; i++) h += '<div class="cal-vz"></div>';
    for (const {d, sl, t} of dias) {
      const voos = sl.filter(s => s.pax);
      const cap = sl.reduce((s, x) => s + (x.cap || 0), 0), ocup = sl.reduce((s, x) => s + (x.cap ? x.cap - x.liv : 0), 0);
      const comHora = S.fonte === 'slots';
      const lin = !comHora ? '' : voos.slice(0, 4).map(s => `<div class="cal-sl"><span>${esc(s.h)}</span><b>${s.pax}</b></div>`).join('') + (voos.length > 4 ? `<div class="cal-mais">+${voos.length - 4} slots</div>` : '');
      h += `<button type="button" class="cal-d${d === hoje() ? ' hj' : ''}${t ? '' : ' zero'}" data-dia="${d}">
        <div class="cal-dn"><span>${+d.slice(8)}</span>${t ? `<em style="${tom(t, max)}">${num(t)} pax</em>` : ''}</div>
        ${t && comHora ? `<div class="cal-dm">${voos.length} ${voos.length === 1 ? 'slot' : 'slots'}${cap ? ` · ${num(ocup / cap * 100)}% ocup.` : ''}</div>${lin}` : ''}
      </button>`;
    }
    return h + '</div><div class="cal-leg">Cada dia mostra o PAX total, os slots com reserva e os primeiros horários (horário · PAX). Clique em um dia para ver a semana.</div>';
  }

  function vSemana(P) {
    const dias = [];
    for (let d = P.ini; d <= P.fim; d = mais(d, 1)) dias.push(d);
    const porDia = Object.fromEntries(dias.map(d => [d, Object.fromEntries(slotsDoDia(d).map(s => [s.h, s]))]));
    const horas = [...new Set(dias.flatMap(d => Object.keys(porDia[d])))].sort();
    if (!horas.length) return '<div class="cal-vazio">Nenhum voo com reserva confirmada nesta semana.</div>';
    let max = 0;
    for (const d of dias) for (const s of Object.values(porDia[d])) max = Math.max(max, s.pax);
    let h = `<div class="cal-sc"><table class="cal-wk"><thead><tr><th>Horário</th>${dias.map((d, i) => `<th class="${d === hoje() ? 'hj' : ''}">${SEM[i]}<span>${br(d)}</span></th>`).join('')}<th>Total</th></tr></thead><tbody>`;
    for (const hr of horas) {
      let tl = 0;
      h += `<tr><th>${esc(hr)}</th>`;
      for (const d of dias) {
        const s = porDia[d][hr];
        if (!s) { h += '<td class="nada"></td>'; continue; }
        tl += s.pax;
        const sel = S.sel && S.sel.d === d && S.sel.h === hr ? ' sel' : '';
        h += `<td><button type="button" class="cal-c${sel}" data-slot="${d}|${esc(hr)}" style="${tom(s.pax, max)}">
          <b>${s.pax}</b>${s.cap ? `<small>/${s.cap}</small>` : ''}<span>${s.r} ${s.r === 1 ? 'reserva' : 'reservas'}</span></button></td>`;
      }
      h += `<td class="tot">${num(tl)}</td></tr>`;
    }
    const tc = dias.map(d => Object.values(porDia[d]).reduce((s, x) => s + x.pax, 0));
    h += `</tbody><tfoot><tr><th>PAX no dia</th>${tc.map(v => `<td>${num(v)}</td>`).join('')}<td class="tot">${num(tc.reduce((a, b) => a + b, 0))}</td></tr>
      <tr><th>Slots com voo</th>${dias.map(d => `<td>${Object.values(porDia[d]).filter(s => s.pax).length}</td>`).join('')}<td></td></tr></tfoot></table></div>`;
    if (S.sel && porDia[S.sel.d] && porDia[S.sel.d][S.sel.h]) {
      const s = porDia[S.sel.d][S.sel.h];
      const prods = Object.entries(s.prods).sort((a, b) => b[1] - a[1]).map(([p, v]) => `<li>${esc(S.produtos[p])}: <b>${v} pax</b></li>`).join('');
      h += `<div class="cal-det"><div><b>${br(S.sel.d)} · ${esc(s.h)}</b> — ${s.pax} pax em ${s.r} ${s.r === 1 ? 'reserva' : 'reservas'}${s.cap ? ` · ${s.cap - s.liv} de ${s.cap} lugares ocupados no Rezdy (${s.liv} livres)` : ''}</div><ul>${prods}</ul></div>`;
    }
    return h + `<div class="cal-leg">Linhas = horários dos slots · colunas = dias. Número grande = PAX confirmado${S.fonte === 'slots' ? '; "/n" = lugares da sessão no Rezdy' : ''}. Clique em um slot para ver os produtos.</div>`;
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  function render() {
    const root = document.getElementById('cal-root');
    if (!S.dados) { root.innerHTML = '<div class="cal-box cal-vazio">Carregando calendário…</div>'; return; }
    const P = periodo(), R = resumo(P.ini, P.fim);
    const chips = S.produtos.map((n, i) => (S.dados && Object.values(S.dados).some(l => l.some(x => x.p === i)))
      ? `<button type="button" data-prod="${i}" class="${S.filtro.has(i) ? 'on' : ''}">${esc(n)}</button>` : '').join('');
    const aviso = S.fonte === 'comparacao'
      ? '<div class="cal-av">⚠ Horários dos slots ainda não disponíveis: o arquivo data/slots.json não foi gerado (precisa da chave da API Rezdy). Por enquanto o calendário mostra o PAX por <b>dia de voo</b>, sem separar por horário.</div>' : '';
    const kpis = [
      ['PAX confirmado', num(R.pax)],
      [S.fonte === 'slots' ? 'Slots com voo' : 'Dias com voo', num(S.fonte === 'slots' ? R.voos : new Set(Object.keys(S.dados).filter(d => d >= P.ini && d <= P.fim && slotsDoDia(d).some(s => s.pax))).size)],
      [S.fonte === 'slots' ? 'Média de PAX por slot' : 'Média de PAX por dia', R.voos ? num(R.pax / R.voos, 1) : '—'],
      ...(R.cap ? [['Ocupação (lugares Rezdy)', `${num(R.ocup / R.cap * 100, 1)}%`]] : []),
      ['Dia de pico', R.pico ? `${br(R.pico.d)} · ${num(R.pico.pax)} pax` : '—'],
    ];
    const corpo = S.visao === 'ano' ? vAno(P) : S.visao === 'mes' ? vMes(P) : vSemana(P);
    root.innerHTML = `
      <div class="cal-box">
        <div class="cal-top">
          <div class="cal-seg">${[['ano', 'Ano'], ['mes', 'Mês'], ['semana', 'Semana']].map(([v, r]) => `<button type="button" data-visao="${v}" class="${S.visao === v ? 'on' : ''}">${r}</button>`).join('')}</div>
          <div class="cal-nav"><button type="button" data-nav="-1" aria-label="Anterior">‹</button><h3>${esc(P.titulo)}</h3><button type="button" data-nav="1" aria-label="Próximo">›</button><button type="button" data-hoje class="cal-hj">Hoje</button></div>
        </div>
        <div class="cal-chips">${chips}</div>
        ${aviso}
        <div class="cal-kpis">${kpis.map(([l, v]) => `<div class="cal-k"><div class="cal-kl">${l}</div><div class="cal-kv">${v}</div></div>`).join('')}</div>
        ${corpo}
        <div class="cal-nt">Reservas confirmadas no Rezdy, pela data e horário do voo (inclui voos futuros já vendidos). Dados de ${esc((S.gerado || '').replace('T', ' ').slice(0, 16))}.</div>
      </div>`;
  }

  // ─── Montagem ──────────────────────────────────────────────────────────────
  function montar() {
    if (document.getElementById('cal-css')) return;
    const css = document.createElement('style');
    css.id = 'cal-css';
    css.textContent = `
      .cal-box{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px}
      .cal-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
      .cal-seg{display:inline-flex;background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:3px;gap:3px}
      .cal-seg button{background:none;border:0;color:var(--sub);font-size:.8rem;font-weight:600;padding:6px 14px;border-radius:7px;cursor:pointer}
      .cal-seg button.on{background:var(--indigo);color:#fff}
      .cal-nav{display:flex;align-items:center;gap:8px}
      .cal-nav h3{font-size:1rem;font-weight:700;min-width:200px;text-align:center}
      .cal-nav button{background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:8px;width:32px;height:32px;font-size:1.1rem;cursor:pointer}
      .cal-nav .cal-hj{width:auto;padding:0 12px;font-size:.78rem}
      .cal-nav button:hover,.cal-seg button:not(.on):hover{border-color:var(--indigo);color:var(--text)}
      .cal-chips{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 4px}
      .cal-chips button{background:var(--surface2);border:1px solid var(--border);color:var(--sub);font-size:.74rem;padding:5px 11px;border-radius:99px;cursor:pointer}
      .cal-chips button.on{border-color:var(--cyan);color:var(--cyan)}
      .cal-av{font-size:.76rem;color:var(--amber);margin:8px 0;line-height:1.5}
      .cal-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin:12px 0 14px}
      .cal-k{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px 12px}
      .cal-kl{font-size:.66rem;color:var(--sub);text-transform:uppercase;letter-spacing:.05em}
      .cal-kv{font-size:1.2rem;font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums}
      .cal-leg,.cal-nt{font-size:.7rem;color:var(--sub);margin-top:10px;line-height:1.5}
      .cal-vazio{color:var(--sub);font-size:.85rem;padding:24px;text-align:center}
      .hj{outline:2px solid var(--cyan);outline-offset:-2px}
      /* Ano */
      .cal-ano{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px}
      .cal-mini{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px}
      .cal-mt{display:flex;justify-content:space-between;width:100%;background:none;border:0;color:var(--text);font-weight:700;font-size:.82rem;cursor:pointer;margin-bottom:6px;padding:0}
      .cal-mt span{color:var(--sub);font-weight:500;font-size:.72rem}
      .cal-mt:hover{color:var(--cyan)}
      .cal-mg{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
      .cal-mg i{font-style:normal;font-size:.58rem;color:var(--sub);text-align:center}
      .cal-mg button{aspect-ratio:1;border:0;border-radius:4px;background:rgba(148,163,184,.06);color:var(--sub);font-size:.62rem;cursor:pointer;padding:0;font-variant-numeric:tabular-nums}
      .cal-mg button:hover{outline:1px solid var(--cyan)}
      /* Mês */
      .cal-mes{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
      .cal-dh{font-size:.7rem;color:var(--sub);text-align:center;font-weight:600}
      .cal-d{background:var(--surface2);border:1px solid var(--border);border-radius:9px;min-height:104px;padding:6px 7px;text-align:left;color:var(--text);cursor:pointer;display:flex;flex-direction:column;gap:2px}
      .cal-d:hover{border-color:var(--indigo)} .cal-d.zero{opacity:.55}
      .cal-dn{display:flex;justify-content:space-between;align-items:center;gap:4px;font-size:.78rem;font-weight:700}
      .cal-dn em{font-style:normal;font-size:.66rem;font-weight:700;border-radius:5px;padding:1px 5px;white-space:nowrap}
      .cal-dm{font-size:.64rem;color:var(--sub);margin-bottom:2px}
      .cal-sl{display:flex;justify-content:space-between;font-size:.68rem;font-variant-numeric:tabular-nums;color:var(--sub)}
      .cal-sl b{color:var(--text)} .cal-mais{font-size:.62rem;color:var(--cyan)}
      /* Semana */
      .cal-sc{overflow-x:auto}
      .cal-wk{width:100%;border-collapse:separate;border-spacing:4px;font-size:.78rem;min-width:640px}
      .cal-wk thead th{font-size:.72rem;color:var(--sub);font-weight:600;text-align:center;padding:4px}
      .cal-wk thead th span{display:block;font-size:.66rem;font-weight:400}
      .cal-wk tbody th,.cal-wk tfoot th{text-align:left;font-size:.74rem;color:var(--sub);font-weight:600;white-space:nowrap;padding-right:6px;font-variant-numeric:tabular-nums}
      .cal-wk td{text-align:center;padding:0;font-variant-numeric:tabular-nums}
      .cal-wk td.nada{background:rgba(148,163,184,.04);border-radius:7px}
      .cal-wk td.tot,.cal-wk tfoot td{color:var(--sub);font-weight:600;font-size:.74rem;padding:4px}
      .cal-c{width:100%;min-height:52px;border:1px solid var(--border);border-radius:7px;background:var(--surface2);color:var(--text);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px}
      .cal-c b{font-size:1rem;line-height:1.1} .cal-c small{font-size:.66rem;opacity:.85}
      .cal-c span{font-size:.6rem;opacity:.8} .cal-c.sel{outline:2px solid var(--cyan)}
      .cal-c:hover{border-color:var(--cyan)}
      .cal-det{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-top:10px;font-size:.8rem}
      .cal-det ul{margin:6px 0 0;padding-left:18px;color:var(--sub)} .cal-det li b{color:var(--text)}
      @media (max-width:640px){.cal-nav h3{min-width:0;font-size:.9rem}.cal-d{min-height:64px;padding:4px}.cal-sl,.cal-dm,.cal-mais{display:none}.cal-dn{flex-direction:column;align-items:flex-start}.cal-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
    document.head.appendChild(css);
    const root = document.getElementById('cal-root');
    root.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      const d = t.dataset;
      if (d.visao) { S.visao = d.visao; S.sel = null; try { localStorage.setItem(VIEW_KEY, S.visao); } catch (_) {} }
      else if (d.nav) return navegar(+d.nav);
      else if ('hoje' in d) { S.ref = hoje(); S.sel = null; }
      else if (d.prod) { const i = +d.prod; S.filtro.has(i) ? S.filtro.delete(i) : S.filtro.add(i); }
      else if (d.mes) { S.ref = d.mes; S.visao = 'mes'; }
      else if (d.dia) { S.ref = d.dia; S.visao = 'semana'; S.sel = null; }
      else if (d.slot) { const [dd, hh] = d.slot.split('|'); S.sel = S.sel && S.sel.d === dd && S.sel.h === hh ? null : {d: dd, h: hh}; }
      else return;
      render();
    });
    S.ref = hoje();
    render();
    carregar().then(render).catch(() => {
      root.innerHTML = '<div class="cal-box cal-vazio">Não foi possível carregar os dados do calendário.</div>';
    });
  }

  window.VRCalendario = {montar};
})();
