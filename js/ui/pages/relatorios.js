// Seção Relatórios (#/relatorios): realizado do período, receita e despesa por
// categoria (barras horizontais) e clientes por estágio.
import { icon, refreshIcons } from '../icons.js';
import { esc } from '../../utils.js';
import { createPeriod, periodRange, mountPeriodPicker } from '../periodPicker.js';
import { barsChart, chartEmpty } from '../charts.js';
import { chipHtml } from '../common.js';
import { STAGES, brl } from '../../fin/format.js';
import { isMissingInDb } from '../../fin/db.js';
import { fetchClients, externalClients } from '../../fin/clients.js';
import { fetchTotals } from '../../fin/entries.js';
import { fetchByCategory } from '../../fin/reports.js';

let ctx = null;

export function mount(container) {
  const c = ctx = {
    container, charts: [], seq: 0,
    period: createPeriod('year'), // por categoria faz mais sentido num período longo: abre no ano
    clients: null, totals: null, totalsError: null, cats: null, catsError: null, error: null, loading: true,
  };
  container.innerHTML = `
    <div class="page__inner">
      <div class="toolbar"><div id="rpPeriod"></div></div>
      <div id="rpWarn"></div>
      <div class="stats" id="rpStats"></div>
      <div class="chart-grid" id="rpCharts">
        <section class="panel">
          <header class="panel__head"><div><h2>Receita por categoria</h2><p class="hint">Receitas pagas no período.</p></div><span class="panel__meta" id="rpRevTotal"></span></header>
          <div id="rpRev"></div>
        </section>
        <section class="panel">
          <header class="panel__head"><div><h2>Despesa por categoria</h2><p class="hint">Despesas pagas no período.</p></div><span class="panel__meta" id="rpExpTotal"></span></header>
          <div id="rpExp"></div>
        </section>
      </div>
      <section class="panel">
        <header class="panel__head"><div><h2>Clientes por estágio</h2><p class="hint">Situação de hoje, sem as entidades da própria empresa. Não depende do período.</p></div></header>
        <div id="rpStages"></div>
      </section>
    </div>`;
  mountPeriodPicker(container.querySelector('#rpPeriod'), c.period, () => reload(c));
  container.querySelector('#rpWarn').addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) start(c); });
  start(c);
}

export function unmount() {
  if (!ctx) return;
  ctx.charts.forEach((off) => off());
  ctx = null;
}

async function start(c) {
  c.error = null;
  c.loading = true;
  render(c);
  try {
    const clients = await fetchClients();
    if (ctx !== c) return;
    c.clients = externalClients(clients);
  } catch (e) {
    if (ctx !== c) return;
    c.loading = false;
    c.error = isMissingInDb(e) ? 'As tabelas do Financeiro ainda não existem neste banco (migration 010_fin_schema.sql).' : (e.message || 'Não foi possível carregar os relatórios.');
    render(c);
    return;
  }
  reload(c);
}

async function reload(c) {
  if (!c.clients) return;
  const seq = ++c.seq;
  c.loading = true;
  render(c);
  const { from, to } = periodRange(c.period);
  const [totals, cats] = await Promise.all([
    fetchTotals({ from, to }).catch((e) => ({ error: e })),
    fetchByCategory({ from, to }).catch((e) => ({ error: e })),
  ]);
  if (ctx !== c || seq !== c.seq) return;
  c.loading = false;
  c.totalsError = totals.error || null;
  c.totals = totals.error ? null : totals;
  c.catsError = cats.error || null;
  c.cats = cats.error ? null : cats;
  render(c);
}

function render(c) {
  const problems = [c.error, c.totalsError?.message, c.catsError?.message].filter(Boolean);
  c.container.querySelector('#rpWarn').innerHTML = [...new Set(problems)].map((msg) => `
    <div class="info-box info-box--warn">${icon('triangle-alert')}<span>${esc(msg)}</span>
      ${c.error ? `<button type="button" class="btn btn--sm" data-retry>${icon('refresh-cw', 'ico--sm')} Tentar de novo</button>` : ''}</div>`).join('');
  renderStats(c);
  renderCharts(c);
  renderStages(c);
  refreshIcons();
}

function renderStats(c) {
  const t = c.totals;
  const period = periodRange(c.period).label;
  const margin = t && t.revenuePaid > 0 ? (t.revenuePaid - t.expensePaid) / t.revenuePaid : null;
  const pct = (v) => `${(Math.round(v * 1000) / 10).toLocaleString('pt-BR')}%`;
  const tile = (ic, label, value, hint) => `
    <div class="stat">
      <div class="stat__label">${icon(ic)}<span>${label}</span></div>
      <div class="stat__value">${value}</div>
      <div class="stat__hint">${esc(hint)}</div>
    </div>`;
  c.container.querySelector('#rpStats').innerHTML =
    tile('trending-up', 'Receita realizada', t ? esc(brl(t.revenuePaid)) : '—', `Paga · ${period}`)
    + tile('trending-down', 'Despesa realizada', t ? esc(brl(t.expensePaid)) : '—', `Paga · ${period}`)
    + tile('percent', 'Margem realizada', margin == null ? '—' : esc(pct(margin)), t && !(t.revenuePaid > 0) ? 'Sem receita paga no período' : '(Receita − despesa) ÷ receita')
    + tile('users', 'Nº de clientes', c.clients ? c.clients.length : '—', 'Todos os estágios, hoje');
}

function renderCharts(c) {
  c.charts.forEach((off) => off());
  c.charts = [];
  const $ = (sel) => c.container.querySelector(sel);
  $('#rpCharts').classList.toggle('is-loading', c.loading && !!c.cats);
  const draw = (host, totalHost, items, tone, name) => {
    totalHost.textContent = c.cats ? brl(items.reduce((s, x) => s + x.value, 0)) : '';
    if (!c.cats) return chartEmpty(host, c.catsError ? 'Sem dados para o gráfico.' : (c.error ? '' : 'Carregando…'));
    if (!items.length) return chartEmpty(host, `Nenhuma ${name.toLowerCase()} paga neste período.`);
    return barsChart(host, { items, tone, name: 'Categoria', format: brl, label: `${name} paga por categoria, ${periodRange(c.period).label}` });
  };
  c.charts.push(draw($('#rpRev'), $('#rpRevTotal'), c.cats?.revenue || [], 'revenue', 'Receita'));
  c.charts.push(draw($('#rpExp'), $('#rpExpTotal'), c.cats?.expense || [], 'expense', 'Despesa'));
}

function renderStages(c) {
  const host = c.container.querySelector('#rpStages');
  if (!c.clients) { host.innerHTML = `<p class="hint">${c.error ? '' : 'Carregando…'}</p>`; return; }
  const rows = STAGES.map((s) => {
    const list = c.clients.filter((x) => x.stage === s.id);
    return { stage: s, count: list.length, mrr: list.reduce((sum, x) => sum + Number(x.mrr || 0), 0) };
  });
  const total = rows.reduce((a, r) => ({ count: a.count + r.count, mrr: a.mrr + r.mrr }), { count: 0, mrr: 0 });
  host.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Estágio</th><th class="num">Clientes</th><th class="num">MRR</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr class="${r.count ? '' : 'is-off'}"><td>${chipHtml(r.stage.label, r.stage.color)}</td><td class="num">${r.count}</td><td class="num">${esc(brl(r.mrr))}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><td>Total</td><td class="num">${total.count}</td><td class="num">${esc(brl(total.mrr))}</td></tr></tfoot>
      </table>
    </div>`;
}
