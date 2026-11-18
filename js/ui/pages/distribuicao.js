// Seção Distribuição de Lucro (#/distribuicao): lucro do mês por tipo de
// operação (RPC fin_profit_by_operation), quanto cabe a cada sócio pelas regras,
// itens considerados e registro da distribuição.
import { icon, refreshIcons } from '../icons.js';
import { esc, debounce } from '../../utils.js';
import { navigate } from '../../router.js';
import { canManage } from '../../access.js';
import { createPeriod, periodRange, mountPeriodPicker } from '../periodPicker.js';
import { chipHtml, clientAvatarHtml, emptyHtml } from '../common.js';
import { confirmDialog } from '../dialog.js';
import { toastError, toastSuccess } from '../toast.js';
import { brl, dateShort } from '../../fin/format.js';
import { fetchClients } from '../../fin/clients.js';
import { fetchPartners, fetchRules, fetchSettings, SETTING_DEFAULTS } from '../../fin/refs.js';
import { subscribeEntries } from '../../fin/entries.js';
import {
  fetchProfitByOperation, fetchPaidItems, fetchDistributions, registerDistribution, computeDistribution, round2,
} from '../../fin/reports.js';

const UNTYPED = 'none'; // valor do filtro para a linha "Sem tipo"
const TONE = { revenue: '#8b6cf6', expense: '#d95926' }; // mesmas cores dos gráficos (receita / despesa)
const pctText = (n) => `${(Math.round(n * 10) / 10).toLocaleString('pt-BR')}%`;

let ctx = null;

export function mount(container) {
  const c = ctx = {
    container, offs: [], seq: 0,
    period: createPeriod('month'), typeFilter: '',
    clients: null, partners: [], rules: {}, settings: { ...SETTING_DEFAULTS },
    rows: [], items: [], distributions: [],
    loading: true, error: null, saving: false,
  };
  container.innerHTML = `
    <div class="page__inner">
      <div class="toolbar">
        <div id="dsPeriod"></div>
        <select class="select toolbar__select" id="dsType" aria-label="Filtrar por tipo de operação"><option value="">Todos os tipos</option></select>
        <div class="toolbar__spacer"></div>
        <span class="reg-status" id="dsStatus"></span>
        <button type="button" class="btn ${canManage() ? '' : 'hidden'}" id="dsRules" title="Regras de distribuição, sócios, reinvestimento e reserva">${icon('settings-2')}<span class="hide-md">Configurar regras</span></button>
        <button type="button" class="btn btn--primary ${canManage() ? '' : 'hidden'}" id="dsRegister" disabled></button>
      </div>
      <div id="dsBody"></div>
    </div>`;
  refreshIcons();

  const $ = (sel) => container.querySelector(sel);
  mountPeriodPicker($('#dsPeriod'), c.period, () => { c.typeFilter = ''; load(c); }, { modes: ['month'] });
  $('#dsType').addEventListener('change', (e) => { c.typeFilter = e.target.value; render(c); });
  $('#dsRules').addEventListener('click', () => navigate('#/config/operacoes'));
  $('#dsRegister').addEventListener('click', () => register(c));
  $('#dsBody').addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) start(c); });

  const soft = debounce(() => { if (ctx === c && c.clients && !c.saving) load(c, { soft: true }); }, 300);
  c.offs.push(subscribeEntries(() => soft()), () => soft.cancel());
  start(c);
}

export function unmount() {
  if (!ctx) return;
  const c = ctx;
  ctx = null;
  c.offs.forEach((off) => off());
}

/** Cadastros que não mudam com o mês: clientes, sócios, regras e percentuais. */
async function start(c) {
  c.error = null;
  c.loading = true;
  render(c);
  try {
    const [clients, partners, rules, settings] = await Promise.all([
      fetchClients(), fetchPartners(), fetchRules(),
      fetchSettings().catch(() => ({ ...SETTING_DEFAULTS })), // sem a 011, vale 0%
    ]);
    if (ctx !== c) return;
    c.clients = new Map(clients.map((x) => [x.id, x]));
    c.partners = partners;
    c.rules = Object.fromEntries(rules.map((r) => [`${r.operation_type_id}:${r.partner_id}`, Number(r.pct) || 0]));
    c.settings = settings;
  } catch (e) {
    if (ctx !== c) return;
    c.loading = false;
    c.error = e.message || 'Não foi possível carregar a distribuição.';
    render(c);
    return;
  }
  load(c);
}

const monthOf = (c) => { const { from, to } = periodRange(c.period); return { from, to, key: from.slice(0, 7), label: periodRange(c.period).label }; };

async function load(c, { soft = false } = {}) {
  if (!c.clients) return;
  const seq = ++c.seq;
  if (!soft) { c.loading = true; render(c); }
  const m = monthOf(c);
  try {
    const [rows, items, distributions] = await Promise.all([
      fetchProfitByOperation(m.from), fetchPaidItems(m.from, m.to), fetchDistributions(m.key),
    ]);
    if (ctx !== c || seq !== c.seq) return;
    c.rows = rows; c.items = items; c.distributions = distributions; c.error = null;
  } catch (e) {
    if (ctx !== c || seq !== c.seq) return;
    c.error = e.message || 'Não foi possível calcular a distribuição.';
  }
  c.loading = false;
  render(c);
}

// ----------------------------------------------------------------------------
// Cálculo da visão
// ----------------------------------------------------------------------------

/** Como o lançamento entra na conta: tipo do cliente, custo geral rateado ou sem tipo. */
function classify(c, item) {
  const cl = c.clients.get(item.client_id);
  if (cl?.operation_type_id) return { group: 'typed', typeId: cl.operation_type_id };
  if (item.kind === 'expense' && cl?.is_internal) return { group: 'shared', typeId: null };
  return { group: 'untyped', typeId: null };
}

function view(c) {
  const all = computeDistribution(c.rows, c.rules, c.partners, c.settings);          // mês inteiro
  const inScope = (typeId) => !c.typeFilter || (c.typeFilter === UNTYPED ? !typeId : typeId === c.typeFilter);
  const rows = c.rows.filter((r) => inScope(r.typeId));
  const scoped = c.typeFilter ? computeDistribution(rows, c.rules, c.partners, c.settings) : all;
  const items = c.items.map((it) => ({ ...it, ...classify(c, it) })).filter((it) => {
    if (!c.typeFilter) return true;
    if (c.typeFilter === UNTYPED) return it.group === 'untyped';
    return it.typeId === c.typeFilter || it.group === 'shared'; // o custo geral rateado também pesa no tipo
  });
  // o que entra num registro: tipos (com tipo) do escopo que tiveram movimento
  const toRegister = scoped.byType.filter((t) => t.revenue || t.direct || t.shared);
  const ids = new Set(scoped.byType.map((t) => t.typeId));
  const registered = c.distributions.filter((d) => d.operation_type_id && ids.has(d.operation_type_id));
  const stale = registered.some((d) => {
    const t = scoped.byType.find((x) => x.typeId === d.operation_type_id);
    return !t || Math.abs(Number(d.net_amount) - t.profit) > 0.005;
  });
  return { all, scoped, rows, items, toRegister, registered, stale };
}

async function register(c) {
  if (!canManage() || c.saving || c.loading || c.error) return;
  const v = view(c);
  const m = monthOf(c);
  if (!v.toRegister.length) return;
  const bad = v.toRegister.filter((t) => Math.abs(t.rulesPct - 100) >= 0.005);
  if (bad.length) {
    toastError(`A regra de ${bad.map((t) => `${t.name} soma ${pctText(t.rulesPct)}`).join('; ')}. Ajuste em "Configurar regras" antes de registrar.`);
    return;
  }
  if (v.registered.length) {
    const ok = await confirmDialog({
      title: 'Refazer a distribuição',
      message: `A distribuição de <b>${esc(m.label)}</b> já foi registrada. Refazer substitui os valores gravados pelos calculados agora (<b>${esc(brl(v.scoped.total))}</b> entre os sócios).`,
      confirmText: 'Refazer', danger: false,
    });
    if (!ok) return;
  }
  c.saving = true;
  renderToolbar(c, v);
  try {
    await registerDistribution(m.key, v.toRegister);
    toastSuccess(`Distribuição de ${m.label} registrada.`);
    c.distributions = await fetchDistributions(m.key);
  } catch (e) {
    toastError(e);
  }
  c.saving = false;
  if (ctx === c) render(c);
}

// ----------------------------------------------------------------------------
// Render
// ----------------------------------------------------------------------------
function render(c) {
  const body = c.container.querySelector('#dsBody');
  const state = (html) => { body.innerHTML = `<div class="page-state">${html}</div>`; refreshIcons(); };
  if (c.error) {
    renderToolbar(c, null);
    return state(emptyHtml({
      icon: 'triangle-alert', title: 'Não deu para calcular', text: c.error,
      action: `<button type="button" class="btn" data-retry>${icon('refresh-cw')} Tentar de novo</button>`,
    }));
  }
  if (c.loading && !c.rows.length) { renderToolbar(c, null); return state(`${icon('loader-circle', 'spin')} Calculando a distribuição…`); }

  const v = view(c);
  renderToolbar(c, v);
  const m = monthOf(c);
  body.className = c.loading ? 'is-loading' : '';
  body.innerHTML = `
    <div class="stack">
      <div class="stats">${statsHtml(c, v, m)}</div>
      ${c.items.length ? `
        ${partnersHtml(c, v)}
        ${typesTableHtml(c, v)}
        ${itemsTableHtml(c, v, m)}` : `
        <div class="page-state">${emptyHtml({ icon: 'chart-pie', title: `Nada pago em ${esc(m.label)}`, text: 'Só entram na distribuição as receitas e despesas com status Pago e Data dentro do mês.' })}</div>`}
    </div>`;
  refreshIcons();
}

function renderToolbar(c, v) {
  const $ = (sel) => c.container.querySelector(sel);
  // filtro de tipo: as linhas que o mês devolveu
  const sel = $('#dsType');
  const options = c.rows.map((r) => ({ value: r.typeId || UNTYPED, label: r.name }));
  sel.innerHTML = `<option value="">Todos os tipos</option>${options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}`;
  if (!options.some((o) => o.value === c.typeFilter)) c.typeFilter = '';
  sel.value = c.typeFilter;

  const btn = $('#dsRegister');
  const status = $('#dsStatus');
  if (!v) { btn.disabled = true; btn.innerHTML = 'Registrar distribuição'; status.innerHTML = ''; return; }
  const done = v.registered.length > 0;
  btn.disabled = c.saving || c.loading || !v.toRegister.length;
  btn.title = v.toRegister.length ? '' : 'Não há lucro de tipo de operação para registrar neste mês';
  btn.innerHTML = c.saving ? `${icon('loader-circle', 'spin')} Registrando…` : (done ? `${icon('refresh-cw')} Refazer` : `${icon('check')} Registrar distribuição`);
  if (done) {
    const last = v.registered.map((d) => d.registered_at).filter(Boolean).sort().pop();
    const when = last ? new Date(last).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
    const partial = v.registered.length < v.toRegister.length;
    status.innerHTML = `${chipHtml(`${partial ? 'Registrada em parte' : 'Registrada'}${when ? ` em ${when}` : ''}`, '#22c55e')}
      ${v.stale ? chipHtml('Valores mudaram desde o registro', '#f59e0b', { title: 'Algum lançamento do mês foi criado, pago ou alterado depois do registro. Use "Refazer" para gravar os valores atuais.' }) : ''}`;
  } else {
    status.innerHTML = '';
  }
  refreshIcons();
}

function statsHtml(c, v, m) {
  const sum = (key) => round2(c.rows.reduce((s, r) => s + r[key], 0));
  const rec = c.rows.find((r) => r.slug === 'recuperacao');
  const others = round2(c.rows.filter((r) => r.typeId && r.slug !== 'recuperacao').reduce((s, r) => s + r.profit, 0));
  const untypedRow = c.rows.find((r) => !r.typeId);
  const classified = c.items.map((it) => ({ ...it, ...classify(c, it) }));
  const untyped = classified.filter((it) => it.group === 'untyped');
  const nRev = c.items.filter((it) => it.kind === 'revenue').length;
  const cut = Number(c.settings.reinvest_pct || 0) + Number(c.settings.reserve_pct || 0);
  const tile = (ic, label, value, hint) => `
    <div class="stat">
      <div class="stat__label">${icon(ic)}<span>${label}</span></div>
      <div class="stat__value">${value}</div>
      <div class="stat__hint">${esc(hint)}</div>
    </div>`;
  return tile('scale', 'Lucro líquido do mês', esc(brl(sum('profit'))), m.label)
    + tile('chart-pie', 'Recuperação líquida', rec ? esc(brl(rec.profit)) : '—', rec ? 'Receita − despesas diretas − rateio' : 'Tipo "Recuperação" não encontrado')
    + tile('layers', 'Outras operações líquidas', esc(brl(others)), 'Demais tipos de operação')
    + tile('piggy-bank', 'Total distribuído', esc(brl(v.all.total)), cut > 0 ? `Após ${String(cut).replace('.', ',')}% de reinvestimento e reserva` : 'Lucro dos tipos de operação')
    + tile('list', 'Itens considerados', c.items.length, 'Pagos, com Data no mês')
    + tile('trending-up', 'Receitas pagas', esc(brl(sum('revenue'))), `${nRev} ${nRev === 1 ? 'receita' : 'receitas'}`)
    + tile('trending-down', 'Despesas pagas', esc(brl(round2(sum('direct') + sum('shared')))), `${c.items.length - nRev} ${c.items.length - nRev === 1 ? 'despesa' : 'despesas'}`)
    + tile('triangle-alert', 'Itens sem tipo de operação', untyped.length, untyped.length ? `Saldo fora da distribuição: ${brl(untypedRow?.profit || 0)}` : 'Tudo classificado');
}

function partnersHtml(c, v) {
  const list = v.scoped.partners;
  if (!list.length || !v.scoped.byType.length) { // "Sem tipo" não tem regra: nada a dividir
    return `<section class="panel"><header class="panel__head"><div><h2>Quanto cada sócio recebe</h2></div></header>
      <p class="hint">${c.typeFilter === UNTYPED ? 'Itens sem tipo de operação não entram na distribuição.' : 'Nenhum sócio com percentual nas regras deste escopo.'}</p></section>`;
  }
  return `
    <section class="panel">
      <header class="panel__head">
        <div><h2>Quanto cada sócio recebe</h2><p class="hint">Soma, por tipo de operação, do lucro distribuível × o percentual do sócio na regra do tipo.</p></div>
        <span class="panel__meta">${esc(brl(v.scoped.total))} no total</span>
      </header>
      <div class="partner-grid">
        ${list.map((p) => `
          <div class="partner">
            <div class="partner__head"><span class="dot" style="--c:${esc(p.partner.color || '#6b7280')}"></span><span class="truncate">${esc(p.partner.name)}</span>${p.partner.active ? '' : '<span class="subtle">(inativo)</span>'}</div>
            <div class="partner__value">${esc(brl(p.amount))}</div>
            <div class="partner__share">${esc(pctText(p.share * 100))} do total distribuído</div>
            ${p.byType.length ? `<ul class="partner__parts">${p.byType.map((t) => `<li><span class="truncate">${esc(t.name)}</span><span>${esc(brl(t.amount))}</span></li>`).join('')}</ul>` : '<p class="hint">Sem participação neste mês.</p>'}
          </div>`).join('')}
      </div>
    </section>`;
}

function typesTableHtml(c, v) {
  const partners = v.scoped.partners.map((p) => p.partner);
  const showDist = v.scoped.factor < 1;
  const typed = new Map(v.scoped.byType.map((t) => [t.typeId, t]));
  const money = (n) => esc(brl(n));
  const tot = (key) => round2(v.rows.reduce((s, r) => s + r[key], 0));
  return `
    <section class="panel">
      <header class="panel__head"><div><h2>Por tipo de operação</h2><p class="hint">Rateio = parte do custo geral (despesas das entidades internas sem tipo), proporcional à receita paga de cada tipo no mês.</p></div></header>
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Tipo de operação</th><th class="num">Receita</th><th class="num">Despesa direta</th><th class="num">Rateio</th><th class="num">Lucro</th>
            ${showDist ? '<th class="num">Distribuível</th>' : ''}
            ${partners.map((p) => `<th class="num"><span class="th-dot"><span class="dot" style="--c:${esc(p.color || '#6b7280')}"></span>${esc(p.name)}</span></th>`).join('')}
          </tr></thead>
          <tbody>${v.rows.map((r) => {
            const t = typed.get(r.typeId);
            const badRule = t && (t.revenue || t.direct || t.shared) && Math.abs(t.rulesPct - 100) >= 0.005;
            return `
            <tr class="${r.typeId ? '' : 'is-flagged'}">
              <td><span class="th-dot"><span class="dot" style="--c:${esc(r.color)}"></span><span class="truncate">${esc(r.name)}</span>${r.active ? '' : ' <span class="subtle">(inativo)</span>'}</span>
                ${badRule ? `<div class="subtle text-warning">Regra soma ${esc(pctText(t.rulesPct))}</div>` : ''}
                ${r.typeId ? '' : '<div class="subtle">Fora da distribuição</div>'}</td>
              <td class="num">${money(r.revenue)}</td><td class="num">${money(r.direct)}</td><td class="num">${money(r.shared)}</td><td class="num"><b>${money(r.profit)}</b></td>
              ${showDist ? `<td class="num">${t ? money(t.distributable) : '<span class="subtle">—</span>'}</td>` : ''}
              ${partners.map((p) => { const s = t?.shares.find((x) => x.partnerId === p.id); return `<td class="num">${s ? `${money(s.amount)}<div class="subtle">${esc(pctText(s.pct))}</div>` : '<span class="subtle">—</span>'}</td>`; }).join('')}
            </tr>`;
          }).join('')}</tbody>
          <tfoot><tr>
            <td>Total</td><td class="num">${money(tot('revenue'))}</td><td class="num">${money(tot('direct'))}</td><td class="num">${money(tot('shared'))}</td><td class="num">${money(tot('profit'))}</td>
            ${showDist ? `<td class="num">${money(round2(v.scoped.byType.reduce((s, t) => s + t.distributable, 0)))}</td>` : ''}
            ${v.scoped.partners.map((p) => `<td class="num">${money(p.amount)}</td>`).join('')}
          </tr></tfoot>
        </table>
      </div>
    </section>`;
}

function itemsTableHtml(c, v, m) {
  const typeName = new Map(c.rows.filter((r) => r.typeId).map((r) => [r.typeId, r]));
  const flagged = v.items.filter((it) => it.group === 'untyped').length;
  const dash = '<span class="subtle">—</span>';
  return `
    <section class="panel">
      <header class="panel__head">
        <div><h2>Itens considerados</h2><p class="hint">Receitas e despesas pagas com Data em ${esc(m.label)}.${flagged ? ' Os destacados não têm tipo de operação: dê um tipo ao cliente para entrarem na distribuição.' : ''}</p></div>
        <span class="panel__meta">${v.items.length} ${v.items.length === 1 ? 'item' : 'itens'}</span>
      </header>
      ${v.items.length ? `
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Data</th><th>Descrição</th><th class="hide-sm">Cliente</th><th class="hide-sm">Tipo de operação</th><th class="hide-sm">Natureza</th><th class="num">Valor</th></tr></thead>
          <tbody>${v.items.map((it) => {
            const cl = c.clients.get(it.client_id);
            const t = typeName.get(it.typeId);
            const typeChip = it.group === 'typed' ? chipHtml(t?.name || 'Tipo', t?.color || '#6b7280')
              : it.group === 'shared' ? chipHtml('Custo geral (rateado)', '#6b7280')
                : chipHtml('Sem tipo', '#f59e0b');
            return `
            <tr class="${it.group === 'untyped' ? 'is-flagged' : ''}">
              <td class="nowrap">${esc(dateShort(it.due_date))}</td>
              <td><span class="truncate-cell">${esc(it.description)}</span><div class="entry-sub show-sm-block"><span class="subtle truncate">${esc(cl?.name || 'Sem cliente')}</span>${typeChip}</div></td>
              <td class="hide-sm">${cl ? `<div class="cell-main">${clientAvatarHtml(cl)}<span class="truncate">${esc(cl.name)}</span></div>` : dash}</td>
              <td class="hide-sm">${typeChip}</td>
              <td class="hide-sm">${chipHtml(it.kind === 'revenue' ? 'Receita' : 'Despesa', TONE[it.kind])}</td>
              <td class="num">${it.kind === 'revenue' ? '' : '−'}${esc(brl(it.value))}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>` : '<p class="hint">Nenhum item neste filtro.</p>'}
    </section>`;
}
