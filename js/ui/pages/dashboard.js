// Seção Dashboard (#/dashboard): cards do período, Receita × Despesa e Lucro
// por mês (6 meses terminando no mês do período) e atalhos de lançamento.
import { icon, refreshIcons } from '../icons.js';
import { esc, debounce } from '../../utils.js';
import { createPeriod, periodRange, periodEndMonth, mountPeriodPicker, MONTHS } from '../periodPicker.js';
import { columnsChart, lineChart, chartEmpty } from '../charts.js';
import { openEntryForm } from '../entryForm.js';
import { openClientForm } from '../clientForm.js';
import { brl } from '../../fin/format.js';
import { isMissingInDb } from '../../fin/db.js';
import { externalClients, subscribeClients } from '../../fin/clients.js';
import { fetchOperationTypes, fetchSettings, SETTING_DEFAULTS } from '../../fin/refs.js';
import { fetchTotals, fetchFilterOptions, loadEntryRefs, subscribeEntries } from '../../fin/entries.js';
import { fetchMonthlySeries } from '../../fin/reports.js';

const SERIES_MONTHS = 6;
let ctx = null;

export function mount(container) {
  const c = ctx = {
    container, offs: [], charts: [], seq: 0,
    period: createPeriod('month'), // sempre abre no mês atual
    refs: null, types: [], options: { tags: [], suppliers: [] }, settings: { ...SETTING_DEFAULTS },
    totals: null, totalsError: null, series: null, seriesError: null, error: null, loading: true,
  };
  container.innerHTML = `
    <div class="page__inner">
      <div class="toolbar">
        <div id="dbPeriod"></div>
        <div class="toolbar__spacer"></div>
        <button type="button" class="btn" id="dbNewClient">${icon('user-plus')}<span>Novo cliente</span></button>
        <button type="button" class="btn" id="dbNewExpense">${icon('plus')}<span>Nova despesa</span></button>
        <button type="button" class="btn btn--primary" id="dbNewRevenue">${icon('plus')}<span>Nova receita</span></button>
      </div>
      <div id="dbWarn"></div>
      <div class="stats" id="dbStats"></div>
      <div class="chart-grid" id="dbCharts">
        <section class="panel">
          <header class="panel__head"><div><h2>Receita × Despesa</h2><p class="hint" id="dbRange"></p></div></header>
          <div id="dbBars"></div>
        </section>
        <section class="panel">
          <header class="panel__head"><div><h2>Lucro por mês</h2><p class="hint">Receita paga menos despesas pagas, mês a mês.</p></div></header>
          <div id="dbLine"></div>
        </section>
      </div>
    </div>`;
  refreshIcons();

  const $ = (sel) => container.querySelector(sel);
  mountPeriodPicker($('#dbPeriod'), c.period, () => reload(c));
  $('#dbNewRevenue').addEventListener('click', () => openEntry(c, 'revenue'));
  $('#dbNewExpense').addEventListener('click', () => openEntry(c, 'expense'));
  $('#dbNewClient').addEventListener('click', () => {
    if (!c.refs) return;
    openClientForm({ types: c.types, onSaved: () => { if (ctx === c) loadRefs(c).then(() => renderStats(c)); } });
  });
  $('#dbWarn').addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) start(c); });

  // outra pessoa lançou ou pagou algo: atualiza sem piscar
  const soft = debounce(() => { if (ctx === c && c.refs) reload(c, { soft: true }); }, 300);
  const softClients = debounce(() => { if (ctx === c && c.refs) loadRefs(c).then(() => renderStats(c)).catch(() => {}); }, 300);
  c.offs.push(subscribeEntries(() => soft()), subscribeClients(() => softClients()));
  c.offs.push(() => { soft.cancel(); softClients.cancel(); });

  start(c);
}

export function unmount() {
  if (!ctx) return;
  const c = ctx;
  ctx = null;
  c.offs.forEach((off) => off());
  c.charts.forEach((off) => off());
}

async function loadRefs(c) {
  const refs = await loadEntryRefs();
  if (ctx === c) c.refs = refs;
}

async function start(c) {
  c.error = null;
  c.loading = true;
  render(c);
  try {
    const [, types, options, settings] = await Promise.all([
      loadRefs(c), fetchOperationTypes(), fetchFilterOptions(),
      fetchSettings().catch(() => ({ ...SETTING_DEFAULTS })), // sem a 011, vale 0%
    ]);
    if (ctx !== c) return;
    c.types = types; c.options = options; c.settings = settings;
  } catch (e) {
    if (ctx !== c) return;
    c.loading = false;
    c.error = isMissingInDb(e) ? 'As tabelas do Financeiro ainda não existem neste banco (migration 010_fin_schema.sql).' : (e.message || 'Não foi possível carregar o Dashboard.');
    render(c);
    return;
  }
  reload(c);
}

async function reload(c, { soft = false } = {}) {
  if (!c.refs) return;
  const seq = ++c.seq;
  if (!soft) { c.loading = true; render(c); }
  const range = periodRange(c.period);
  const [totals, series] = await Promise.all([
    fetchTotals({ from: range.from, to: range.to }).catch((e) => ({ error: e })),
    fetchMonthlySeries(periodEndMonth(c.period), SERIES_MONTHS).catch((e) => ({ error: e })),
  ]);
  if (ctx !== c || seq !== c.seq) return;
  c.loading = false;
  c.totalsError = totals.error || null;
  c.totals = totals.error ? null : totals;
  c.seriesError = series.error || null;
  c.series = series.error ? null : series;
  render(c);
}

function openEntry(c, kind) {
  if (!c.refs) return;
  openEntryForm({ kind, refs: c.refs, options: c.options, onSaved: () => { if (ctx === c) reload(c, { soft: true }); } });
}

// ----------------------------------------------------------------------------
// Render
// ----------------------------------------------------------------------------
function render(c) {
  const warn = c.container.querySelector('#dbWarn');
  const problems = [c.error, c.totalsError?.message, c.seriesError?.message].filter(Boolean);
  warn.innerHTML = [...new Set(problems)].map((msg) => `
    <div class="info-box info-box--warn">${icon('triangle-alert')}<span>${esc(msg)}</span>
      ${c.error ? `<button type="button" class="btn btn--sm" data-retry>${icon('refresh-cw', 'ico--sm')} Tentar de novo</button>` : ''}</div>`).join('');
  refreshIcons();
  renderStats(c);
  renderCharts(c);
}

function renderStats(c) {
  const t = c.totals;
  const period = periodRange(c.period).label;
  const cut = Number(c.settings.reinvest_pct || 0) + Number(c.settings.reserve_pct || 0);
  const net = t ? t.revenuePaid - t.expensePaid : 0;
  const active = c.refs ? externalClients(c.refs.clients).filter((x) => x.stage === 'active').length : null;
  const money = (v) => (t ? esc(brl(v)) : '—');
  const tile = (ic, label, value, hint) => `
    <div class="stat">
      <div class="stat__label">${icon(ic)}<span>${label}</span></div>
      <div class="stat__value">${value}</div>
      <div class="stat__hint">${esc(hint)}</div>
    </div>`;
  c.container.querySelector('#dbStats').innerHTML =
    tile('trending-up', 'Receita', money(t?.revenuePaid), `Paga · ${period}`)
    + tile('trending-down', 'Despesas', money(t?.expensePaid), `Pagas · ${period}`)
    + tile('scale', 'Lucro líquido', money(net), 'Receita menos despesas pagas')
    + tile('piggy-bank', 'Lucro distribuível', money(net * Math.max(0, 1 - cut / 100)), cut > 0 ? `Após ${String(cut).replace('.', ',')}% de reinvestimento e reserva` : 'Sem reinvestimento nem reserva')
    + tile('user-check', 'Clientes ativos', active == null ? '—' : active, 'Hoje')
    + tile('clock', 'A receber', money(t?.revenuePending), `Pendente · ${period}`)
    + tile('clock', 'A pagar', money(t?.expensePending), `Pendente · ${period}`);
  refreshIcons();
}

function renderCharts(c) {
  c.charts.forEach((off) => off());
  c.charts = [];
  const bars = c.container.querySelector('#dbBars');
  const line = c.container.querySelector('#dbLine');
  const range = c.container.querySelector('#dbRange');
  c.container.querySelector('#dbCharts').classList.toggle('is-loading', c.loading && !!c.series);
  if (!c.series) {
    const text = c.seriesError ? 'Sem dados para o gráfico.' : (c.error ? '' : 'Carregando…');
    range.textContent = '';
    c.charts.push(chartEmpty(bars, text), chartEmpty(line, text));
    return;
  }
  const s = c.series;
  const ym = (x) => { const [y, m] = x.month.split('-').map(Number); return { y, m }; };
  // rótulo curto do eixo; o ano só aparece no primeiro mês e a cada janeiro
  const labels = s.map((x, i) => { const { y, m } = ym(x); const short = MONTHS[m - 1].slice(0, 3).toLowerCase(); return i === 0 || m === 1 ? `${short}/${String(y).slice(2)}` : short; });
  const titles = s.map((x) => { const { y, m } = ym(x); return `${MONTHS[m - 1]} de ${y}`; });
  range.textContent = `Pagos, de ${titles[0].toLowerCase()} a ${titles[titles.length - 1].toLowerCase()}.`;
  c.charts.push(columnsChart(bars, {
    label: `Receita e despesa pagas por mês, ${titles[0]} a ${titles[titles.length - 1]}`,
    labels, titles, format: brl,
    series: [
      { label: 'Receita', tone: 'revenue', values: s.map((x) => x.revenue) },
      { label: 'Despesa', tone: 'expense', values: s.map((x) => x.expense) },
    ],
  }));
  c.charts.push(lineChart(line, {
    label: `Lucro por mês, ${titles[0]} a ${titles[titles.length - 1]}`,
    labels, titles, format: brl, values: s.map((x) => x.profit), tone: 'profit', name: 'Lucro',
  }));
}
