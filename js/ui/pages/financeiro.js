// Seção Financeiro (#/financeiro/receitas | despesas): cards do período,
// filtro de período, tabelas paginadas, "Marcar pago", modais e realtime.
import { icon, refreshIcons } from '../icons.js';
import { esc, storage, debounce } from '../../utils.js';
import { navigate, setSubRoute } from '../../router.js';
import { chipHtml, clientAvatarHtml, emptyHtml } from '../common.js';
import { toastError, toastSuccess } from '../toast.js';
import { openEntryForm } from '../entryForm.js';
import { createPeriod, periodRange, mountPeriodPicker } from '../periodPicker.js';
import { brl, dateShort } from '../../fin/format.js';
import { isMissingInDb } from '../../fin/db.js';
import { canManage } from '../../access.js';
import {
  KINDS, PAGE_SIZE, statusColor, statusLabel, isOpen,
  fetchEntries, fetchTotals, fetchFilterOptions, loadEntryRefs, markPaid, subscribeEntries,
} from '../../fin/entries.js';

const PERIOD_KEY = 'lumix.finPeriod';

let ctx = null;

// ----------------------------------------------------------------------------
// Montagem
// ----------------------------------------------------------------------------
export function mount(container, route) {
  const c = ctx = {
    container, offs: [], seq: 0,
    tab: route?.sub === KINDS.expense.sub ? 'expense' : 'revenue',
    period: createPeriod(storage.get(PERIOD_KEY) || 'month'), // lembra o tipo de período; a data volta para hoje
    page: { revenue: 0, expense: 0 },
    rows: [], count: null, totals: null, totalsError: null,
    refs: null, options: {}, // options = fin_filter_options: formas de pagamento e descrições já usadas
    loading: true, error: null, paying: new Set(),
  };
  container.innerHTML = `
    <div class="page__inner">
      <div class="stats" id="fnStats"></div>
      <div class="toolbar">
        <div id="fnPeriod"></div>
        <div class="toolbar__spacer"></div>
        ${canManage() ? `<button type="button" class="btn" id="fnCats" title="Categorias e centros de custo">${icon('tags')}<span class="hide-md">Categorias</span></button>
        <button type="button" class="btn" id="fnNewExpense">${icon('plus')}<span>Nova despesa</span></button>
        <button type="button" class="btn btn--primary" id="fnNewRevenue">${icon('plus')}<span>Nova receita</span></button>` : ''}
      </div>
      <div class="tabs tabs--page" id="fnTabs" role="tablist"></div>
      <div class="page__body" id="fnBody"></div>
      <div class="pager hidden" id="fnPager"></div>
    </div>`;
  refreshIcons();

  const $ = (sel) => container.querySelector(sel);
  mountPeriodPicker($('#fnPeriod'), c.period, () => { storage.set(PERIOD_KEY, c.period.mode); filtersChanged(c); });
  $('#fnCats')?.addEventListener('click', () => navigate('#/config/categorias'));
  $('#fnNewRevenue')?.addEventListener('click', () => openForm(c, 'revenue', null));
  $('#fnNewExpense')?.addEventListener('click', () => openForm(c, 'expense', null));

  $('#fnTabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t || t.dataset.tab === c.tab) return;
    c.tab = t.dataset.tab;
    setSubRoute(KINDS[c.tab].sub);
    c.rows = []; c.count = null;
    reload(c);
  });
  $('#fnBody').addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) { start(c); return; }
    if (e.target.closest('[data-new]')) { openForm(c, c.tab, null); return; }
    const pay = canManage() && e.target.closest('[data-pay]');
    if (pay) { e.stopPropagation(); payEntry(c, pay.dataset.pay); return; }
    const row = e.target.closest('tr[data-id]');
    if (row) openForm(c, c.tab, c.rows.find((x) => x.id === row.dataset.id));
  });
  $('#fnBody').addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.target.closest('button')) return;
    const row = e.target.closest('tr[data-id]');
    if (row) { e.preventDefault(); openForm(c, c.tab, c.rows.find((x) => x.id === row.dataset.id)); }
  });
  $('#fnPager').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (!b || b.disabled) return;
    c.page[c.tab] += Number(b.dataset.page);
    reload(c);
    container.scrollTop = 0;
  });

  // Mudou algo no banco (eu ou outra pessoa): recarrega totais e a página atual
  const soft = debounce(() => { if (ctx === c && !c.error) reload(c, { soft: true }); }, 250);
  c.offs.push(subscribeEntries(() => soft()));
  c.offs.push(() => soft.cancel());

  start(c);
}

export function unmount() {
  if (!ctx) return;
  const c = ctx;
  ctx = null;
  c.offs.forEach((off) => off());
}

/** Primeira carga: cadastros de apoio + opções de filtro + dados do período. */
async function start(c) {
  c.error = null;
  c.loading = true;
  render(c);
  try {
    const [refs, options] = await Promise.all([loadEntryRefs(), fetchFilterOptions()]);
    if (ctx !== c) return;
    c.refs = refs;
    c.options = options;
  } catch (e) {
    if (ctx !== c) return;
    c.loading = false;
    c.error = isMissingInDb(e) ? 'As tabelas do Financeiro ainda não existem neste banco (migration 010_fin_schema.sql).' : (e.message || 'Não foi possível carregar o Financeiro.');
    render(c);
    return;
  }
  reload(c);
}

function filtersChanged(c) {
  c.page.revenue = 0;
  c.page.expense = 0;
  reload(c);
}

const filters = (c) => { const r = periodRange(c.period); return { from: r.from, to: r.to }; };

/**
 * Busca totais (RPC) e a página da aba aberta. soft = true mantém a tabela na
 * tela enquanto carrega (realtime, depois de salvar).
 */
async function reload(c, { soft = false } = {}) {
  if (!c.refs) return;
  const seq = ++c.seq;
  if (!soft) { c.loading = true; render(c); }
  const f = filters(c);
  const [totals, list] = await Promise.all([
    fetchTotals(f).catch((e) => ({ error: e })),
    fetchEntries(c.tab, { ...f, page: c.page[c.tab] }).catch((e) => ({ error: e })),
  ]);
  if (ctx !== c || seq !== c.seq) return;
  if (list.count === null && !list.error && c.page[c.tab] > 0) { // a página sumiu (ex.: excluíram linhas)
    c.page[c.tab] = 0;
    return reload(c, { soft });
  }
  c.loading = false;
  c.totalsError = totals.error || null;
  c.totals = totals.error ? null : totals;
  if (list.error) {
    c.error = list.error.message || 'Não foi possível carregar os lançamentos.';
  } else {
    c.error = null;
    c.rows = list.rows;
    c.count = list.count ?? 0;
  }
  render(c);
}

function openForm(c, kind, entry) {
  if (!c.refs) return;
  const done = () => {
    if (ctx !== c) return;
    reload(c, { soft: true });
    fetchFilterOptions().then((o) => { if (ctx === c) c.options = o; }); // descrição ou forma de pagamento nova
  };
  openEntryForm({ kind, entry, refs: c.refs, options: c.options, onSaved: done, onDeleted: done, readOnly: !canManage() });
}

async function payEntry(c, id) {
  if (c.paying.has(id)) return;
  c.paying.add(id);
  renderTable(c);
  try {
    await markPaid(c.tab, id);
    toastSuccess('Marcado como pago.');
  } catch (e) {
    toastError(e);
  }
  c.paying.delete(id);
  if (ctx === c) reload(c, { soft: true });
}

// ----------------------------------------------------------------------------
// Render
// ----------------------------------------------------------------------------
function render(c) {
  renderStats(c);
  renderTabs(c);
  renderTable(c);
  renderPager(c);
}

function renderStats(c) {
  const t = c.totals;
  const period = periodRange(c.period).label;
  const tile = (ic, label, value) => `
    <div class="stat">
      <div class="stat__label">${icon(ic)}<span>${label}</span></div>
      <div class="stat__value">${t ? esc(brl(value)) : '—'}</div>
      <div class="stat__hint">${esc(period)}</div>
    </div>`;
  c.container.querySelector('#fnStats').innerHTML =
    (c.totalsError ? `<div class="info-box info-box--warn stats__wide">${icon('triangle-alert')}<span>Não deu para somar os totais. ${esc(c.totalsError.message || '')}</span></div>` : '')
    + tile('trending-up', 'Receitas recebidas', t?.revenuePaid)
    + tile('clock', 'A receber', t?.revenuePending)
    + tile('trending-down', 'Despesas pagas', t?.expensePaid)
    + tile('clock', 'A pagar', t?.expensePending);
  refreshIcons();
}

function renderTabs(c) {
  // N vem da RPC (as duas abas); sem ela, só a aba aberta sabe a própria contagem
  const n = (kind) => (c.totals ? (kind === 'revenue' ? c.totals.revenueCount : c.totals.expenseCount) : (kind === c.tab ? c.count : null));
  c.container.querySelector('#fnTabs').innerHTML = Object.entries(KINDS).map(([kind, def]) => `
    <button type="button" class="tab ${kind === c.tab ? 'is-active' : ''}" role="tab" aria-selected="${kind === c.tab}" data-tab="${kind}">
      ${icon(def.icon, 'ico--sm')} ${def.title}${n(kind) != null ? ` <span class="tab__count">· ${n(kind)}</span>` : ''}
    </button>`).join('');
  refreshIcons();
}

function renderTable(c) {
  const body = c.container.querySelector('#fnBody');
  if (!body) return;
  const def = KINDS[c.tab];
  const state = (html) => { body.innerHTML = `<div class="page-state">${html}</div>`; refreshIcons(); };

  if (c.error) {
    return state(emptyHtml({
      icon: 'triangle-alert', title: 'Não deu para carregar', text: c.error,
      action: `<button type="button" class="btn" data-retry>${icon('refresh-cw')} Tentar de novo</button>`,
    }));
  }
  if (c.loading && !c.rows.length) return state(`${icon('loader-circle', 'spin')} Carregando ${def.title.toLowerCase()}…`);
  if (!c.rows.length) {
    const filtered = c.period.mode !== 'all';
    return state(emptyHtml({
      icon: def.icon,
      title: filtered ? `Nenhuma ${def.one} neste filtro` : `Nenhuma ${def.one} ainda`,
      text: filtered ? 'Mude o período ou lance uma nova.' : '',
      action: canManage() ? `<button type="button" class="btn btn--primary" data-new>${icon('plus')} ${def.newLabel}</button>` : '',
    }));
  }

  const isRevenue = c.tab === 'revenue';
  const byId = (list) => new Map(list.map((x) => [String(x.id), x]));
  const clients = byId(c.refs.clients);
  const cats = byId(isRevenue ? c.refs.revenueCats : c.refs.expenseCats);
  const costs = byId(c.refs.costCenters);
  const dash = '<span class="subtle">—</span>';
  const text = (v) => (v ? `<span class="truncate-cell">${esc(v)}</span>` : dash);
  const clientCell = (id) => {
    const cl = clients.get(String(id));
    return cl ? `<div class="cell-main">${clientAvatarHtml(cl)}<span class="truncate">${esc(cl.name)}</span></div>` : dash;
  };

  body.innerHTML = `
    <div class="table-wrap ${c.loading ? 'is-loading' : ''}">
      <table class="table table--clickable ${isRevenue ? '' : 'table--dense'}">
        <thead><tr>
          <th>Descrição</th>
          <th class="hide-sm">${isRevenue ? 'Cliente' : 'Empresa'}</th>
          ${isRevenue ? '' : '<th class="hide-sm">Forma de Pagamento</th>'}
          <th class="hide-sm">Categoria</th>
          ${isRevenue ? '' : '<th class="hide-sm">Centro</th>'}
          <th class="hide-sm">Data</th>
          <th class="num">Valor</th>
          <th class="hide-sm">Status</th>
          <th class="table__actions"><span class="sr-only">Ações</span></th>
        </tr></thead>
        <tbody>${c.rows.map((x) => {
          const cl = clients.get(String(x.client_id));
          const status = chipHtml(statusLabel(x.status), statusColor(x.status));
          const sub = [cl?.name, dateShort(x.due_date)].filter(Boolean).join(' · ');
          const paying = c.paying.has(x.id);
          return `
          <tr data-id="${x.id}" tabindex="0">
            <td>
              <div class="entry-desc">
                <span class="truncate">${esc(x.description)}</span>
                ${x.recurring || x.recurring_parent_id ? `<span class="entry-desc__rec" title="${x.recurring ? 'Recorrente: gera a cobrança de cada mês' : 'Gerada pela recorrência'}">${icon('repeat', 'ico--sm')}</span>` : ''}
              </div>
              <div class="entry-sub show-sm-block"><span class="subtle truncate">${esc(sub)}</span>${chipHtml(statusLabel(x.status), statusColor(x.status), { small: true })}</div>
            </td>
            <td class="hide-sm">${clientCell(x.client_id)}</td>
            ${isRevenue ? '' : `<td class="hide-sm">${text(x.supplier)}</td>`}
            <td class="hide-sm">${text(cats.get(String(x.category_id))?.name)}</td>
            ${isRevenue ? '' : `<td class="hide-sm">${text(costs.get(String(x.cost_center_id))?.name)}</td>`}
            <td class="hide-sm nowrap">${esc(dateShort(x.due_date)) || dash}</td>
            <td class="num">${esc(brl(x.value))}</td>
            <td class="hide-sm">${status}</td>
            <td class="table__actions">${isOpen(x.status) && canManage() ? `
              <button type="button" class="btn btn--sm" data-pay="${x.id}" ${paying ? 'disabled' : ''} title="Marcar como pago">
                ${icon(paying ? 'loader-circle' : 'check', paying ? 'ico--sm spin' : 'ico--sm')}<span class="hide-md">Marcar pago</span>
              </button>` : ''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  refreshIcons();
}

function renderPager(c) {
  const host = c.container.querySelector('#fnPager');
  const total = c.count || 0;
  const show = !c.error && total > PAGE_SIZE;
  host.classList.toggle('hidden', !show);
  if (!show) { host.innerHTML = ''; return; }
  const page = c.page[c.tab];
  const first = page * PAGE_SIZE + 1;
  const last = Math.min(total, first + c.rows.length - 1);
  host.innerHTML = `
    <span class="subtle">${first}–${last} de ${total}</span>
    <button type="button" class="btn btn--sm" data-page="-1" ${page === 0 ? 'disabled' : ''}>${icon('chevron-left', 'ico--sm')} Anterior</button>
    <button type="button" class="btn btn--sm" data-page="1" ${last >= total ? 'disabled' : ''}>Próxima ${icon('chevron-right', 'ico--sm')}</button>`;
  refreshIcons();
}
