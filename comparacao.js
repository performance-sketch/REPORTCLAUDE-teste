/*
 * comparacao.js — Comparação Personalizada de Períodos (Dashboard Vertical Rio)
 *
 * Período A = base de comparação · Período B = período comparado. Variações = B em relação a A.
 * Vendas usam a Booking Date (criação da reserva); voos usam a Fulfilment Date (data do voo).
 * Dados: data/comparacao.json (scripts/gerar_comparacao.py). Nada é projetado ou estimado
 * sem rótulo: períodos em andamento usam só os dias já transcorridos e são sinalizados.
 *
 * Integração com o dashboard existente: chama applyDateRange(B, ..., A) para que todos os
 * indicadores, gráficos e tabelas atuais usem B como período e A como comparação.
 */
(() => {
  const URL_DADOS = 'data/comparacao.json';
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const CANAIS = {O: 'Online', I: 'Interno', N: 'Negotiated Rate'};
  const STATUS = {C: 'Confirmados', A: 'Abandonados', X: 'Cancelados', H: 'On Hold', O: 'Outros'};
  const GATEWAYS = {PAYPAL: 'PayPal', CREDITCARD: 'Cartão de crédito', BANKTRANSFER: 'Transferência', CASH: 'Dinheiro', VOUCHER: 'Voucher', OTHER: 'Outros', EXTERNAL: 'Externo (marketplace)'};
  const NAO_RECEBIDO = ['FREE', 'PROMO_CODE', 'REFUND'];     // cortesia (FOC), cupom e estorno: não são recebimento
  const S = {modo: 'padrao', preset: 'ciclo', prop: false, A: null, B: null, dados: null, carregando: null, aplicado: null, min: false};
  const MIN_KEY = 'vr_cmp_minimizado';
  try { S.min = localStorage.getItem(MIN_KEY) === '1'; } catch (_) {}

  // ─── Datas e ciclos (26 de um mês a 25 do seguinte) ────────────────────────
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dia = s => new Date(s + 'T12:00:00');
  const mais = (s, n) => { const d = dia(s); d.setDate(d.getDate() + n); return iso(d); };
  const nDias = (a, b) => Math.round((dia(b) - dia(a)) / 864e5) + 1;
  const hoje = () => (typeof HOJE === 'string' ? HOJE : iso(new Date()));
  const br = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—';
  const brCurto = s => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  const ciclo = (y, m) => ({ini: iso(new Date(y, m - 2, 26)), fim: iso(new Date(y, m - 1, 25)), nome: `${MESES[m - 1]} ${y}`});
  const cicloDe = s => { let [y, m, d] = s.split('-').map(Number); if (d >= 26) { m++; if (m > 12) { m = 1; y++; } } return {y, m}; };
  const anterior = ({y, m}, n = 1) => { m -= n; while (m < 1) { m += 12; y--; } return {y, m}; };

  function presets() {
    const atual = cicloDe(hoje()), ant = anterior(atual);
    const c = (x, nome) => ({...ciclo(x.y, x.m), nome: nome || ciclo(x.y, x.m).nome});
    const lista = {
      'mes-ant-yoy': {rotulo: `${MESES[ant.m - 1]} ${ant.y} × ${MESES[ant.m - 1]} ${ant.y - 1}`, A: c({y: ant.y - 1, m: ant.m}), B: c(ant)},
      'mes-atual-yoy': {rotulo: `${MESES[atual.m - 1]} ${atual.y} × ${MESES[atual.m - 1]} ${atual.y - 1}`, A: c({y: atual.y - 1, m: atual.m}), B: c(atual)},
      'ciclo': {rotulo: 'Ciclo atual × Ciclo anterior', A: c(ant, `Ciclo ${ciclo(ant.y, ant.m).nome}`), B: c(atual, `Ciclo ${ciclo(atual.y, atual.m).nome}`)},
      '30d': {rotulo: 'Últimos 30 dias × 30 dias anteriores', A: {ini: mais(hoje(), -59), fim: mais(hoje(), -30), nome: '30 dias anteriores'}, B: {ini: mais(hoje(), -29), fim: hoje(), nome: 'Últimos 30 dias'}},
      'personalizado': {rotulo: 'Personalizado'},
    };
    return lista;
  }

  // Datas efetivamente usadas: nunca além de hoje; no modo proporcional, o mesmo nº de dias nos dois
  function efetivos() {
    const corta = P => ({...P, fimEf: P.fim < hoje() ? P.fim : hoje()});
    const A = corta(S.A), B = corta(S.B);
    const dA = A.ini > A.fimEf ? 0 : nDias(A.ini, A.fimEf), dB = B.ini > B.fimEf ? 0 : nDias(B.ini, B.fimEf);
    if (S.prop && dA && dB) {
      const n = Math.min(dA, dB);
      A.fimEf = mais(A.ini, n - 1); B.fimEf = mais(B.ini, n - 1);
      A.dias = B.dias = n;
    } else { A.dias = dA; B.dias = dB; }
    A.andamento = S.A.fim > hoje(); B.andamento = S.B.fim > hoje();
    A.total = nDias(S.A.ini, S.A.fim); B.total = nDias(S.B.ini, S.B.fim);
    return {A, B};
  }

  // ─── Formatação ────────────────────────────────────────────────────────────
  const brl = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const brl0 = v => 'R$ ' + Math.round(v || 0).toLocaleString('pt-BR');
  const num = (v, d = 0) => Number(v || 0).toLocaleString('pt-BR', {minimumFractionDigits: d, maximumFractionDigits: d});
  const pct = (v, d = 1) => v == null || !isFinite(v) ? '—' : num(v, d) + '%';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

  // Variação de B em relação a A. bom = +1 (subir é bom) | -1 (cair é bom) | 0 (neutro)
  function variacao(a, b, fmt, bom = 1, pp = false) {
    if (a == null || b == null || !isFinite(a) || !isFinite(b)) return '<span class="cmp-d nul">—</span>';
    const d = b - a;
    if (Math.abs(d) < 1e-9) return '<span class="cmp-d nul">= sem variação</span>';
    const cls = bom === 0 ? 'neu' : (d > 0) === (bom > 0) ? 'pos' : 'neg';
    const seta = d > 0 ? '▲' : '▼';
    const abs = (d > 0 ? '+' : '−') + (pp ? num(Math.abs(d), 1) + ' p.p.' : fmt(Math.abs(d)));
    const rel = pp || !a ? '' : ` · ${d > 0 ? '+' : '−'}${num(Math.abs(d / a * 100), 1)}%`;
    return `<span class="cmp-d ${cls}">${seta} ${abs}${rel}</span>`;
  }

  // ─── Cálculo das métricas de um período ────────────────────────────────────
  const tipoProduto = nome => /no-?show/i.test(nome) ? 'noshow' : /fee/i.test(nome) ? 'fee' : /gift/i.test(nome) ? 'gift'
    : /doors|voo|flight|heli/i.test(nome) ? 'voo' : 'outro';

  function calcular(ini, fim) {
    const D = S.dados, P = D.produtos, E = D.extras;
    const venda = D.b.filter(x => x[1] >= ini && x[1] <= fim);              // Booking Date
    const conf = venda.filter(x => x[2] === 'C');
    const r = {pedidos: venda.length, status: {C: 0, A: 0, X: 0, H: 0, O: 0}, canal: {}, gateway: {}, naoRec: {FREE: 0, PROMO_CODE: 0, REFUND: 0},
      bookings: conf.length, pax: 0, bruta: 0, comissao: 0, foc: 0, focBookings: 0, focTotal: 0,
      extras: {}, comExtra: 0, servicos: {noshow: [0, 0], fee: [0, 0], gift: [0, 0], outro: [0, 0]}};
    Object.keys(CANAIS).forEach(c => { r.canal[c] = {pedidos: 0, abandonos: 0, bookings: 0, receita: 0, pax: 0}; });
    venda.forEach(x => {
      r.status[x[2]] = (r.status[x[2]] || 0) + 1;
      const c = r.canal[x[3]]; if (!c) return;
      c.pedidos++; if (x[2] === 'A') c.abandonos++;
    });
    conf.forEach(x => {
      const [, , , c, v, com, pag, itens] = x;
      r.bruta += v; r.comissao += com || 0;
      let paxB = 0, temExtra = false;
      itens.forEach(it => {
        const tipo = tipoProduto(P[it[0]]);
        if (tipo === 'voo') paxB += it[3] || 0;
        else { r.servicos[tipo][0]++; r.servicos[tipo][1] += it[5] ?? (itens.length === 1 ? v : 0); }
        (it[4] || []).forEach(([e, q, rec]) => {
          temExtra = true;
          const o = r.extras[E[e]] ||= {qtd: 0, receita: 0, bookings: 0};
          o.qtd += q; o.receita += rec;
        });
        [...new Set((it[4] || []).map(e => e[0]))].forEach(e => { r.extras[E[e]].bookings++; });
      });
      if (temExtra) r.comExtra++;
      r.pax += paxB;
      if (r.canal[c]) { r.canal[c].bookings++; r.canal[c].receita += v; r.canal[c].pax += paxB; }
      let recebido = 0;
      Object.entries(pag || {}).forEach(([t, val]) => {
        if (NAO_RECEBIDO.includes(t)) r.naoRec[t] += val;
        else { r.gateway[t] = (r.gateway[t] || 0) + val; recebido += val; }
      });
      if (pag && pag.FREE) { r.focBookings++; if (recebido < 0.01 && !pag.PROMO_CODE) r.focTotal++; }
    });
    r.foc = r.naoRec.FREE;
    r.liquida = r.bruta - r.naoRec.FREE - r.naoRec.PROMO_CODE - r.naoRec.REFUND - r.comissao;
    r.ticket = r.bookings ? r.bruta / r.bookings : null;
    r.ticketPax = r.pax ? r.bruta / r.pax : null;
    r.paxPorBooking = r.bookings ? r.pax / r.bookings : null;
    r.abandono = r.pedidos ? r.status.A / r.pedidos * 100 : null;

    // Voos: Fulfilment Date (data do voo) dentro do período, só reservas confirmadas
    r.voos = {realizados: 0, agendados: 0, minutos: 0, semDuracao: 0, pax: 0, mix: {}};
    D.b.forEach(x => {
      if (x[2] !== 'C') return;
      x[7].forEach(it => {
        const t = it[1]; if (!t || t < ini || t > fim || tipoProduto(P[it[0]]) !== 'voo') return;
        if (t < hoje()) r.voos.realizados++; else r.voos.agendados++;
        r.voos.pax += it[3] || 0;
        if (it[2]) r.voos.minutos += it[2]; else r.voos.semDuracao++;
        r.voos.mix[P[it[0]]] = (r.voos.mix[P[it[0]]] || 0) + 1;
      });
    });
    return r;
  }

  // ─── Insights executivos (recalculados a cada aplicação) ────────────────────
  function insights(a, b, ef) {
    const out = [];
    if (!a.bookings || !b.bookings) {
      out.push(`Sem reservas confirmadas em ${!a.bookings ? 'A' : 'B'} — não há base para conclusões de vendas.`);
      return out;
    }
    const v = (x, y) => (y - x) / x * 100, sinal = x => x >= 0 ? 'cresceu' : 'caiu';
    const vr = v(a.bruta, b.bruta);
    out.push(`A receita bruta ${sinal(vr)} <b>${num(Math.abs(vr), 1)}%</b> (${b.bruta >= a.bruta ? '+' : '−'}${brl0(Math.abs(b.bruta - a.bruta))}), com ${num(b.bookings)} reservas em B contra ${num(a.bookings)} em A.`);
    if (a.ticket && b.ticket && Math.abs(v(a.ticket, b.ticket)) >= 3)
      out.push(`O ticket médio por reserva ${sinal(v(a.ticket, b.ticket))} ${num(Math.abs(v(a.ticket, b.ticket)), 1)}% (${brl(a.ticket)} → ${brl(b.ticket)}).`);
    const partes = Object.keys(CANAIS).map(c => ({c, d: (b.bruta ? b.canal[c].receita / b.bruta : 0) * 100 - (a.bruta ? a.canal[c].receita / a.bruta : 0) * 100}))
      .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    if (partes[0] && Math.abs(partes[0].d) >= 2)
      out.push(`O canal <b>${CANAIS[partes[0].c]}</b> ${partes[0].d > 0 ? 'ganhou' : 'perdeu'} ${num(Math.abs(partes[0].d), 1)} p.p. de participação na receita.`);
    if (a.abandono != null && b.abandono != null && Math.abs(b.abandono - a.abandono) >= 2)
      out.push(`A taxa de abandono ${b.abandono > a.abandono ? 'subiu' : 'caiu'} ${num(Math.abs(b.abandono - a.abandono), 1)} p.p. (${pct(a.abandono)} → ${pct(b.abandono)}).`);
    const attA = a.bookings ? a.comExtra / a.bookings * 100 : 0, attB = b.bookings ? b.comExtra / b.bookings * 100 : 0;
    if (Math.abs(attB - attA) >= 3)
      out.push(`${attB > attA ? 'Mais' : 'Menos'} reservas levaram extras: ${pct(attA)} → ${pct(attB)}.`);
    const gA = Object.values(a.gateway).reduce((s, x) => s + x, 0), gB = Object.values(b.gateway).reduce((s, x) => s + x, 0);
    if (gA && gB && Math.abs((b.gateway.PAYPAL || 0) / gB - (a.gateway.PAYPAL || 0) / gA) * 100 >= 5)
      out.push(`O PayPal passou de ${pct((a.gateway.PAYPAL || 0) / gA * 100)} para ${pct((b.gateway.PAYPAL || 0) / gB * 100)} dos valores recebidos.`);
    if (a.bruta && b.bruta && Math.abs(b.foc / b.bruta - a.foc / a.bruta) * 100 >= 1)
      out.push(`As cortesias (FOC) representaram ${pct(a.foc / a.bruta * 100)} da receita bruta em A e ${pct(b.foc / b.bruta * 100)} em B.`);
    if (ef.B.andamento && !S.prop)
      out.push(`⚠ B ainda está em andamento (${ef.B.dias} de ${ef.B.total} dias). Para comparar dias equivalentes, use a comparação proporcional.`);
    return out;
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  function cartao(rotulo, a, b, fmt, bom = 1, dica = '') {
    return `<div class="cmp-k"${dica ? ` title="${esc(dica)}"` : ''}><div class="cmp-kl">${rotulo}</div>
      <div class="cmp-kv">${b == null ? '—' : fmt(b)}</div><div class="cmp-ka">A: ${a == null ? '—' : fmt(a)}</div>${variacao(a, b, fmt, bom)}</div>`;
  }
  function linha(rotulo, a, b, fmt, bom = 1, pp = false) {
    return `<tr><td>${rotulo}</td><td class="r">${a == null ? '—' : fmt(a)}</td><td class="r">${b == null ? '—' : fmt(b)}</td><td class="r">${variacao(a, b, fmt, bom, pp)}</td></tr>`;
  }
  const tabela = (titulo, linhas, nota = '') => `<div class="cmp-tb"><div class="cmp-tt">${titulo}</div><div class="cmp-sc"><table>
    <thead><tr><th></th><th class="r">A · base</th><th class="r">B · comparado</th><th class="r">Variação (B vs A)</th></tr></thead><tbody>${linhas}</tbody></table></div>${nota ? `<div class="cmp-nt">${nota}</div>` : ''}</div>`;

  function renderResultado() {
    const box = document.getElementById('cmp-res');
    if (S.modo !== 'personalizada' || !S.aplicado) { box.innerHTML = ''; return; }
    const ef = S.aplicado, a = calcular(ef.A.ini, ef.A.fimEf), b = calcular(ef.B.ini, ef.B.fimEf);
    const shareRec = (r, c) => r.bruta ? r.canal[c].receita / r.bruta * 100 : null;
    const shareBk = (r, c) => r.bookings ? r.canal[c].bookings / r.bookings * 100 : null;
    const tk = (r, c) => r.canal[c].bookings ? r.canal[c].receita / r.canal[c].bookings : null;
    const ab = (r, c) => r.canal[c].pedidos ? r.canal[c].abandonos / r.canal[c].pedidos * 100 : null;
    const gTot = r => Object.values(r.gateway).reduce((s, x) => s + x, 0);
    const gws = [...new Set([...Object.keys(a.gateway), ...Object.keys(b.gateway)])].sort((x, y) => (b.gateway[y] || 0) - (b.gateway[x] || 0));
    const exs = [...new Set([...Object.keys(a.extras), ...Object.keys(b.extras)])];
    const mix = [...new Set([...Object.keys(a.voos.mix), ...Object.keys(b.voos.mix)])].sort((x, y) => (b.voos.mix[y] || 0) - (b.voos.mix[x] || 0));
    const totVoos = r => r.voos.realizados + r.voos.agendados;
    const metaIni = (typeof META_DATA !== 'undefined' && META_DATA.diario && META_DATA.diario[0]) ? META_DATA.diario[0].data : null;
    const fulfilIncompleto = [ef.A, ef.B].some(p => p.ini < '2025-03-01');
    box.innerHTML = `
      <div class="cmp-sec"><div class="cmp-st">💡 Insights executivos</div><ul class="cmp-ins">${insights(a, b, ef).map(t => `<li>${t}</li>`).join('')}</ul></div>

      <div class="cmp-sec"><div class="cmp-st">Vendas e receita <span>· pela data da reserva (Booking Date)</span></div>
        <div class="cmp-grid">
          ${cartao('Bookings confirmados', a.bookings, b.bookings, x => num(x))}
          ${cartao('Passageiros (PAX)', a.pax, b.pax, x => num(x))}
          ${cartao('Receita bruta', a.bruta, b.bruta, brl0)}
          ${cartao('Receita líquida', a.liquida, b.liquida, brl0, 1, 'Receita bruta − cortesias (FOC) − cupons (PROMO_CODE) − estornos − comissão de marketplace')}
          ${cartao('Ticket médio / booking', a.ticket, b.ticket, brl)}
          ${cartao('Ticket médio / passageiro', a.ticketPax, b.ticketPax, brl)}
        </div>
        <div class="cmp-nt">Receita líquida = bruta − cortesias (FOC) − cupons − estornos − comissão de marketplace (GetYourGuide).</div></div>

      <div class="cmp-sec"><div class="cmp-st">Performance por canal</div>
        ${tabela('Bookings e receita', Object.keys(CANAIS).map(c =>
          linha(`${CANAIS[c]} · bookings`, a.canal[c].bookings, b.canal[c].bookings, x => num(x)) +
          linha(`${CANAIS[c]} · receita`, a.canal[c].receita, b.canal[c].receita, brl0) +
          linha(`${CANAIS[c]} · ticket médio`, tk(a, c), tk(b, c), brl) +
          linha(`${CANAIS[c]} · participação na receita`, shareRec(a, c), shareRec(b, c), x => pct(x), 0, true) +
          linha(`${CANAIS[c]} · participação nos bookings`, shareBk(a, c), shareBk(b, c), x => pct(x), 0, true)).join(''),
          `Ticket médio Online × Interno — A: ${brl(tk(a, 'O'))} × ${brl(tk(a, 'I'))} · B: ${brl(tk(b, 'O'))} × ${brl(tk(b, 'I'))}. Negotiated Rate = marketplaces com tarifa negociada (GetYourGuide).`)}
      </div>

      <div class="cmp-sec"><div class="cmp-st">Fulfilments <span>· pela data do voo (Fulfilment Date)</span></div>
        <div class="cmp-grid">
          ${cartao('Voos realizados', a.voos.realizados, b.voos.realizados, x => num(x), 1, 'Reservas confirmadas com voo no período e antes de hoje')}
          ${cartao('Voos agendados', a.voos.agendados, b.voos.agendados, x => num(x), 1, 'Reservas confirmadas com voo a partir de hoje')}
          ${cartao('PAX voando', a.voos.pax, b.voos.pax, x => num(x))}
          ${cartao('PAX por booking', a.paxPorBooking, b.paxPorBooking, x => num(x, 2), 1, 'Pela data da reserva')}
          ${cartao('Horas de voo reservadas', a.voos.minutos / 60, b.voos.minutos / 60, x => num(x, 1) + ' h', 1, 'Soma da duração de cada reserva')}
        </div>
        ${tabela('Mix de produtos (voos no período)', mix.map(p => linha(esc(p), a.voos.mix[p] || 0, b.voos.mix[p] || 0, x => num(x)) +
          linha(`↳ participação`, totVoos(a) ? (a.voos.mix[p] || 0) / totVoos(a) * 100 : null, totVoos(b) ? (b.voos.mix[p] || 0) / totVoos(b) * 100 : null, x => pct(x), 0, true)).join('') || '<tr><td colspan="4">Sem voos no período.</td></tr>',
          `"Voos" = reservas com voo na data (um voo compartilhado conta uma vez por reserva). Horas = soma da duração informada no Rezdy por reserva${a.voos.semDuracao + b.voos.semDuracao ? `; ${a.voos.semDuracao + b.voos.semDuracao} reservas sem duração não entram` : ''}.${fulfilIncompleto ? ' ⚠ Voos até fev/2025 podem estar incompletos: reservas feitas antes de 2025 não estão nos dados.' : ''}`)}
      </div>

      <div class="cmp-sec"><div class="cmp-st">Conversão e pagamentos</div>
        ${tabela('Status dos pedidos', Object.keys(STATUS).filter(s => a.status[s] || b.status[s]).map(s =>
          linha(STATUS[s], a.status[s] || 0, b.status[s] || 0, x => num(x), s === 'C' ? 1 : s === 'O' ? 0 : -1)).join('') +
          linha('Taxa de abandono (geral)', a.abandono, b.abandono, x => pct(x), -1, true) +
          Object.keys(CANAIS).map(c => linha(`Taxa de abandono · ${CANAIS[c]}`, ab(a, c), ab(b, c), x => pct(x), -1, true)).join(''),
          'Taxa de abandono = carrinhos abandonados ÷ todos os pedidos do canal no período.')}
        ${tabela('Valores recebidos por meio de pagamento', gws.map(g =>
          linha(esc(GATEWAYS[g] || g), a.gateway[g] || 0, b.gateway[g] || 0, brl0) +
          linha('↳ participação', gTot(a) ? (a.gateway[g] || 0) / gTot(a) * 100 : null, gTot(b) ? (b.gateway[g] || 0) / gTot(b) * 100 : null, x => pct(x), 0, true)).join(''),
          'No Rezdy, os cartões aparecem como "CREDITCARD" (o processador, ex.: Stripe, não é identificado). Cortesias, cupons e estornos não entram aqui — veja Receita adicional.')}
      </div>

      <div class="cmp-sec"><div class="cmp-st">Receita adicional</div>
        ${tabela('Extras vendidos', exs.map(e =>
          linha(`${esc(e)} · quantidade`, a.extras[e]?.qtd || 0, b.extras[e]?.qtd || 0, x => num(x)) +
          linha(`${esc(e)} · receita`, a.extras[e]?.receita || 0, b.extras[e]?.receita || 0, brl0)).join('') +
          linha('Reservas com algum extra', a.bookings ? a.comExtra / a.bookings * 100 : null, b.bookings ? b.comExtra / b.bookings * 100 : null, x => pct(x), 1, true) +
          linha('Receita total de extras', exs.reduce((s, e) => s + (a.extras[e]?.receita || 0), 0), exs.reduce((s, e) => s + (b.extras[e]?.receita || 0), 0), brl0),
          'Receita de extras = preço informado no Rezdy (inclui extras depois cobertos por cortesia).')}
        ${tabela('Com e sem Free of Charge (FOC)',
          linha('Receita bruta (com FOC)', a.bruta, b.bruta, brl0) +
          linha('Cortesias (FOC)', a.foc, b.foc, brl0, -1) +
          linha('Receita sem FOC', a.bruta - a.foc, b.bruta - b.foc, brl0) +
          linha('Reservas com alguma cortesia', a.focBookings, b.focBookings, x => num(x), 0) +
          linha('Reservas 100% cortesia', a.focTotal, b.focTotal, x => num(x), 0) +
          linha('Reservas pagas', a.bookings - a.focTotal, b.bookings - b.focTotal, x => num(x)) +
          linha('Cupons de desconto (PROMO_CODE)', a.naoRec.PROMO_CODE, b.naoRec.PROMO_CODE, brl0, -1) +
          linha('Estornos', a.naoRec.REFUND, b.naoRec.REFUND, brl0, -1),
          'FOC = pagamentos do tipo FREE no Rezdy (ex.: "Cortesia GoPro").')}
        ${tabela('Fees e outros itens', [['noshow', 'No-Show Fees'], ['fee', 'Outras fees'], ['gift', 'Gift Cards'], ['outro', 'Outros serviços (ex.: shuttle)']]
          .filter(([k]) => a.servicos[k][0] || b.servicos[k][0]).map(([k, l]) =>
            linha(`${l} · quantidade`, a.servicos[k][0], b.servicos[k][0], x => num(x), 0) + linha(`${l} · receita`, a.servicos[k][1], b.servicos[k][1], brl0, 0)).join('') || '<tr><td colspan="4">Nenhum no período.</td></tr>')}
      </div>
      ${metaIni && (ef.A.ini < metaIni || ef.B.ini < metaIni) ? `<div class="cmp-av">⚠ Meta Ads só tem dados a partir de ${br(metaIni)}. Indicadores de Meta Ads nas abas do dashboard ficam zerados ou parciais para datas anteriores.</div>` : ''}`;
  }

  function renderBarra() {
    const bar = document.getElementById('cmp-bar');
    if (S.modo === 'personalizada' && S.aplicado) {
      const {A, B} = S.aplicado;
      const rot = (P, X) => `${esc(X.nome || 'Período')} (${brCurto(P.ini)}–${brCurto(P.fimEf)}${P.ini.slice(0, 4) !== P.fimEf.slice(0, 4) ? '' : '/' + P.ini.slice(2, 4)})`;
      bar.innerHTML = `<b>Comparando:</b> <span class="cmp-tag a">A</span> ${rot(A, S.A)} <span class="cmp-x">×</span> <span class="cmp-tag b">B</span> ${rot(B, S.B)}
        <span class="cmp-meta">${S.prop ? `proporcional · ${A.dias} dias em cada` : `absoluta · A ${A.dias} dias, B ${B.dias} dias`}${B.andamento ? ' · B em andamento' : ''} · datas usadas: ${br(A.ini)}–${br(A.fimEf)} × ${br(B.ini)}–${br(B.fimEf)}</span>`;
    } else {
      const p = window.__vrPeriodo;
      bar.innerHTML = p ? `<b>Comparação padrão:</b> ${br(p.from)}–${br(p.to)} <span class="cmp-x">×</span> ${br(p.pFrom)}–${br(p.pTo)} <span class="cmp-meta">(mesmo nº de dias, imediatamente antes)</span>` : '';
    }
    // Minimizar: esconde o seletor e o painel de resultados; a barra com os períodos continua visível
    if (bar.innerHTML) bar.insertAdjacentHTML('beforeend', `<button type="button" class="cmp-min" data-minimizar aria-expanded="${!S.min}" title="${S.min ? 'Mostrar o seletor e o painel da comparação' : 'Esconder o seletor e o painel da comparação'}">${S.min ? '▼ Expandir' : '▲ Minimizar'}</button>`);
    document.getElementById('cmp-ctl').hidden = S.min;
    document.getElementById('cmp-res').hidden = S.min;
  }

  function renderControles() {
    const ps = presets(), pers = S.modo === 'personalizada';
    document.getElementById('cmp-ctl').innerHTML = `
      <div class="cmp-row">
        <div class="cmp-seg"><button type="button" data-modo="padrao" class="${pers ? '' : 'on'}">Comparação padrão</button><button type="button" data-modo="personalizada" class="${pers ? 'on' : ''}">Comparação personalizada</button></div>
        ${pers ? `<div class="cmp-seg"><button type="button" data-prop="0" class="${S.prop ? '' : 'on'}" title="Números reais de cada período">Absoluta</button><button type="button" data-prop="1" class="${S.prop ? 'on' : ''}" title="Mesmo nº de dias transcorridos nos dois períodos">Proporcional</button></div>` : ''}
      </div>
      ${pers ? `<div class="cmp-chips">${Object.entries(ps).map(([k, p]) => `<button type="button" data-preset="${k}" class="${S.preset === k ? 'on' : ''}">${esc(p.rotulo)}</button>`).join('')}</div>
      <div class="cmp-datas">
        <fieldset><legend><span class="cmp-tag a">A</span> Base de comparação</legend><label>Data inicial<input type="date" id="cmp-a-ini" value="${S.A.ini}"></label><label>Data final<input type="date" id="cmp-a-fim" value="${S.A.fim}"></label></fieldset>
        <fieldset><legend><span class="cmp-tag b">B</span> Período comparado</legend><label>Data inicial<input type="date" id="cmp-b-ini" value="${S.B.ini}"></label><label>Data final<input type="date" id="cmp-b-fim" value="${S.B.fim}"></label></fieldset>
        <div class="cmp-bt"><button type="button" class="cmp-apl" data-aplicar>Aplicar Comparação</button><button type="button" class="cmp-rst" data-restaurar>Restaurar Padrão</button></div>
      </div><div class="cmp-msg" id="cmp-msg"></div>` : ''}`;
  }

  // ─── Ações ─────────────────────────────────────────────────────────────────
  function usarPreset(k) {
    const p = presets()[k]; S.preset = k;
    if (!p.A) return;
    S.A = {...p.A}; S.B = {...p.B};
    // Algum período ainda em andamento → proporcional (dias equivalentes); os dois fechados → absoluta
    S.prop = S.A.fim > hoje() || S.B.fim > hoje();
  }

  async function carregar() {
    if (S.dados) return S.dados;
    S.carregando ||= fetch(URL_DADOS + '?v=' + (typeof HOJE === 'string' ? HOJE : Date.now()), {cache: 'no-cache'}).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
    S.dados = await S.carregando; return S.dados;
  }

  async function aplicar() {
    const msg = document.getElementById('cmp-msg'), ler = id => document.getElementById(id).value;
    const A = {...S.A, ini: ler('cmp-a-ini'), fim: ler('cmp-a-fim')}, B = {...S.B, ini: ler('cmp-b-ini'), fim: ler('cmp-b-fim')};
    if (!A.ini || !A.fim || !B.ini || !B.fim) { msg.textContent = 'Preencha as quatro datas.'; return; }
    if (A.ini > A.fim || B.ini > B.fim) { msg.textContent = 'A data inicial precisa ser anterior à final.'; return; }
    if (A.ini > hoje() || B.ini > hoje()) { msg.textContent = 'Os períodos precisam começar até hoje — não há dados de datas futuras.'; return; }
    const dataMin = typeof D90_FROM === 'string' ? D90_FROM : '2025-01-01';
    if (A.ini < dataMin || B.ini < dataMin) { msg.textContent = `Há dados a partir de ${br(dataMin)}.`; return; }
    if (S.preset !== 'personalizado' && (A.ini !== S.A.ini || A.fim !== S.A.fim || B.ini !== S.B.ini || B.fim !== S.B.fim)) {
      S.preset = 'personalizado'; A.nome = 'Período A'; B.nome = 'Período B';
    }
    S.A = A; S.B = B;
    msg.textContent = 'Carregando dados…';
    try { await carregar(); } catch (_) { msg.textContent = 'Não foi possível carregar os dados da comparação.'; return; }
    S.aplicado = efetivos();
    // Todo o dashboard existente passa a usar B como período e A como comparação
    if (typeof applyDateRange === 'function') applyDateRange(S.aplicado.B.ini, S.aplicado.B.fimEf, {from: S.aplicado.A.ini, to: S.aplicado.A.fimEf});
    if (window.__vrFp) window.__vrFp.setDate([S.aplicado.B.ini, S.aplicado.B.fimEf], false);
    render();
  }

  function restaurar() {
    S.modo = 'padrao'; S.aplicado = null;
    if (typeof applyDateRange === 'function') applyDateRange(typeof D30_FROM === 'string' ? D30_FROM : mais(hoje(), -29), hoje());
    if (window.__vrFp) window.__vrFp.setDate([typeof D30_FROM === 'string' ? D30_FROM : mais(hoje(), -29), hoje()], false);
    render();
  }

  function render() { renderControles(); renderBarra(); renderResultado(); }

  // ─── Montagem ──────────────────────────────────────────────────────────────
  function montar() {
    const css = document.createElement('style');
    css.textContent = `
      #cmp{max-width:1280px;margin:0 auto;padding:4px 24px 0}
      #cmp-bar{position:sticky;z-index:40;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:8px 14px;font-size:.78rem;color:var(--text);display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin-bottom:10px;box-shadow:0 6px 16px rgba(0,0,0,.25)}
      #cmp-bar:empty{display:none}
      .cmp-min{margin-left:auto;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:7px;padding:4px 10px;font-size:.72rem;font-weight:600;cursor:pointer;white-space:nowrap}
      .cmp-min:hover{border-color:var(--indigo)}
      #cmp [hidden]{display:none!important}
      .cmp-meta{color:var(--sub);font-size:.72rem} .cmp-x{color:var(--sub)}
      .cmp-tag{display:inline-block;font-size:.66rem;font-weight:800;border-radius:5px;padding:1px 6px;color:#0f172a}
      .cmp-tag.a{background:#94a3b8} .cmp-tag.b{background:var(--cyan)}
      .cmp-box{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:12px}
      .cmp-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}
      .cmp-seg{display:inline-flex;background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:3px;gap:3px}
      .cmp-seg button{background:none;border:0;color:var(--sub);font-size:.8rem;font-weight:600;padding:6px 12px;border-radius:7px;cursor:pointer}
      .cmp-seg button.on{background:var(--indigo);color:#fff}
      .cmp-chips{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 4px}
      .cmp-chips button{background:var(--surface2);border:1px solid var(--border);color:var(--text);font-size:.76rem;padding:6px 11px;border-radius:99px;cursor:pointer}
      .cmp-chips button.on{border-color:var(--cyan);color:var(--cyan)}
      .cmp-datas{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-top:10px}
      .cmp-datas fieldset{border:1px solid var(--border);border-radius:10px;padding:8px 12px 10px;display:flex;gap:10px;flex-wrap:wrap}
      .cmp-datas legend{font-size:.72rem;color:var(--sub);padding:0 4px;display:flex;gap:6px;align-items:center}
      .cmp-datas label{display:flex;flex-direction:column;font-size:.68rem;color:var(--sub);gap:3px}
      .cmp-datas input{background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:.8rem;color-scheme:dark}
      .cmp-bt{display:flex;gap:8px;flex-wrap:wrap}
      .cmp-apl{background:var(--indigo);color:#fff;border:0;border-radius:8px;padding:9px 16px;font-weight:600;font-size:.82rem;cursor:pointer}
      .cmp-rst{background:none;color:var(--text);border:1px solid var(--border);border-radius:8px;padding:9px 14px;font-size:.82rem;cursor:pointer}
      .cmp-msg{font-size:.75rem;color:var(--amber);margin-top:8px;min-height:1em}
      .cmp-sec{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:12px}
      .cmp-st{font-weight:700;font-size:.92rem;margin-bottom:10px} .cmp-st span{font-weight:400;color:var(--sub);font-size:.75rem}
      .cmp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
      .cmp-k{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px 12px}
      .cmp-kl{font-size:.66rem;color:var(--sub);text-transform:uppercase;letter-spacing:.05em}
      .cmp-kv{font-size:1.25rem;font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums}
      .cmp-ka{font-size:.72rem;color:var(--sub);margin-top:2px;font-variant-numeric:tabular-nums}
      .cmp-d{display:inline-block;font-size:.72rem;font-weight:600;margin-top:4px;font-variant-numeric:tabular-nums}
      .cmp-d.pos{color:var(--green)} .cmp-d.neg{color:var(--red)} .cmp-d.neu{color:var(--cyan)} .cmp-d.nul{color:var(--sub)}
      .cmp-tb{margin-top:10px} .cmp-tt{font-size:.78rem;font-weight:600;color:var(--sub);margin-bottom:6px}
      .cmp-sc{overflow-x:auto} .cmp-tb table{width:100%;border-collapse:collapse;font-size:.78rem}
      .cmp-tb th{font-size:.66rem;color:var(--sub);text-transform:uppercase;letter-spacing:.04em;font-weight:600;padding:6px 8px;border-bottom:1px solid var(--border);text-align:left;white-space:nowrap}
      .cmp-tb td{padding:6px 8px;border-bottom:1px solid rgba(51,65,85,.5);font-variant-numeric:tabular-nums;white-space:nowrap}
      .cmp-tb .r{text-align:right} .cmp-tb .cmp-d{margin:0}
      .cmp-nt{font-size:.7rem;color:var(--sub);margin-top:6px;line-height:1.5}
      .cmp-ins{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px;font-size:.85rem;line-height:1.5}
      .cmp-av{font-size:.75rem;color:var(--amber);margin-bottom:12px}
      @media (max-width:640px){#cmp{padding:4px 14px 0}.cmp-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
    document.head.appendChild(css);
    const root = document.createElement('div');
    root.id = 'cmp';
    root.innerHTML = '<div id="cmp-bar"></div><div class="cmp-box" id="cmp-ctl"></div><div id="cmp-res"></div>';
    const main = document.querySelector('main');
    main.parentNode.insertBefore(root, main);
    const faixa = document.getElementById('faixa-teste');
    document.getElementById('cmp-bar').style.top = (faixa ? faixa.offsetHeight : 0) + 'px';

    root.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      const d = t.dataset;
      if ('minimizar' in d) {
        S.min = !S.min;
        try { localStorage.setItem(MIN_KEY, S.min ? '1' : '0'); } catch (_) {}
        return renderBarra();
      }
      if (d.modo) { if (d.modo === 'padrao') return restaurar(); S.modo = 'personalizada'; if (!S.A) usarPreset('ciclo'); render(); }
      else if (d.prop) { S.prop = d.prop === '1'; if (S.aplicado) aplicar(); else render(); }
      else if (d.preset) { usarPreset(d.preset); render(); if (d.preset !== 'personalizado') aplicar(); }
      else if ('aplicar' in d) aplicar();
      else if ('restaurar' in d) restaurar();
    });
    root.addEventListener('change', e => { if (e.target.matches('#cmp-ctl input[type=date]')) { S.preset = 'personalizado'; document.querySelectorAll('#cmp-ctl [data-preset]').forEach(b => b.classList.toggle('on', b.dataset.preset === 'personalizado')); } });
    // Período alterado pelo seletor de datas do dashboard: volta à comparação padrão
    window.addEventListener('vr:periodo', ev => {
      if (!ev.detail.custom && S.modo === 'personalizada') { S.modo = 'padrao'; S.aplicado = null; }
      render();
    });
    render();
  }

  window.VRComparacao = {montar};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar); else montar();
})();
