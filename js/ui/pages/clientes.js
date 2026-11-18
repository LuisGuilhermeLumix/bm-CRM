// Seção Clientes (#/clientes): indicadores, lista com filtros, modal de
// criar/editar e realtime em fin_clients. As entidades internas (Lumix,
// Lumix REC) não aparecem aqui: ficam em Configurações → Empresa.
import { icon, refreshIcons } from '../icons.js';
import { esc, debounce } from '../../utils.js';
import { on, profileOf, stable } from '../../state.js';
import { chipHtml, avatarHtml, clientAvatarHtml, emptyHtml } from '../common.js';
import { openClientForm } from '../clientForm.js';
import { STAGES, stageOf, brl, dateShort, fold } from '../../fin/format.js';
import { isMissingInDb } from '../../fin/db.js';
import { fetchClients, subscribeClients, isInternal } from '../../fin/clients.js';
import { fetchOperationTypes } from '../../fin/refs.js';
import { canManage } from '../../access.js';

let ctx = null; // estado da página montada (null fora da seção)

export function mount(container) {
  const c = ctx = {
    container,
    clients: [], types: [], loading: true, error: null,
    q: '', stage: '', type: '', offs: [],
  };
  container.innerHTML = `
    <div class="page__inner">
      <div class="stats" id="clStats"></div>
      <div class="toolbar">
        <label class="filter-search">
          ${icon('search')}
          <input class="input" id="clSearch" placeholder="Buscar por nome ou contato…" autocomplete="off" aria-label="Buscar clientes" />
        </label>
        <select class="select toolbar__select" id="clStage" aria-label="Filtrar por estágio">
          <option value="">Todos os estágios</option>
          ${STAGES.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('')}
        </select>
        <select class="select toolbar__select" id="clType" aria-label="Filtrar por tipo de operação">
          <option value="">Todos os tipos</option>
        </select>
        <div class="toolbar__spacer"></div>
        ${canManage() ? `<button type="button" class="btn btn--primary" id="clNew">${icon('plus')}<span>Novo cliente</span></button>` : ''}
      </div>
      <div class="page__body" id="clBody"></div>
    </div>`;
  refreshIcons();

  const $ = (sel) => container.querySelector(sel);
  $('#clSearch').addEventListener('input', debounce(() => { c.q = $('#clSearch').value; renderBody(c); }, 120));
  $('#clStage').addEventListener('change', (e) => { c.stage = e.target.value; renderBody(c); });
  $('#clType').addEventListener('change', (e) => { c.type = e.target.value; renderBody(c); });
  $('#clNew')?.addEventListener('click', () => openForm(c, null));
  $('#clBody').addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) { load(c); return; }
    if (e.target.closest('[data-new]')) { openForm(c, null); return; }
    if (e.target.closest('[data-clear-filters]')) { clearFilters(c); return; }
    const row = e.target.closest('[data-client-id]');
    if (row) openForm(c, c.clients.find((x) => x.id === row.dataset.clientId));
  });
  $('#clBody').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('tr[data-client-id]');
    if (row) { e.preventDefault(); openForm(c, c.clients.find((x) => x.id === row.dataset.clientId)); }
  });

  c.offs.push(subscribeClients((p) => onRealtime(c, p)));
  c.offs.push(on('profiles', () => { if (!c.loading) renderBody(c); }));
  render(c);
  load(c);
}

export function unmount() {
  if (!ctx) return;
  const c = ctx;
  ctx = null;
  c.offs.forEach((off) => off());
}

async function load(c) {
  c.loading = true;
  c.error = null;
  render(c);
  try {
    const [clients, types] = await Promise.all([fetchClients(), fetchOperationTypes()]);
    if (ctx !== c) return;
    c.clients = clients.filter((x) => !isInternal(x));
    c.types = types;
  } catch (e) {
    if (ctx !== c) return;
    c.error = isMissingInDb(e) ? 'As tabelas do Financeiro ainda não existem neste banco (migration 010_fin_schema.sql).' : (e.message || 'Não foi possível carregar os clientes.');
  }
  c.loading = false;
  render(c);
}

function clearFilters(c) {
  c.q = ''; c.stage = ''; c.type = '';
  c.container.querySelector('#clSearch').value = '';
  c.container.querySelector('#clStage').value = '';
  c.container.querySelector('#clType').value = '';
  renderBody(c);
}

// ----------------------------------------------------------------------------
// Dados locais
// ----------------------------------------------------------------------------
// Ordem fixa da lista: prioridade do estágio e, dentro dele, "Cliente desde" do
// mais antigo para o mais novo (sem data vai para o fim do grupo). O nome não
// entra na ordenação; empate cai na ordem de cadastro.
const STAGE_PRIORITY = ['active', 'deal', 'lead', 'paused', 'canceled', 'done'];
const stageRank = (stage) => { const i = STAGE_PRIORITY.indexOf(stage); return i === -1 ? STAGE_PRIORITY.length : i; };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function byStageThenSince(a, b) {
  return (stageRank(a.stage) - stageRank(b.stage))
    || (Number(!a.since) - Number(!b.since))               // com data antes de sem data
    || cmp(a.since || '', b.since || '')                   // "YYYY-MM-DD" ordena como texto
    || cmp(a.created_at || '', b.created_at || '')
    || cmp(a.id, b.id);
}

function upsertLocal(c, row) {
  const i = c.clients.findIndex((x) => x.id === row.id);
  if (i === -1) { c.clients.push(row); return true; }
  if (stable(c.clients[i]) === stable(row)) return false; // eco do nosso próprio update
  c.clients[i] = row;
  return true;
}

function removeLocal(c, id) {
  const i = c.clients.findIndex((x) => x.id === id);
  if (i === -1) return false;
  c.clients.splice(i, 1);
  return true;
}

function onRealtime(c, payload) {
  if (ctx !== c || c.loading) return;
  // cliente que virou entidade interna (ou evento de uma delas) sai da lista
  const gone = payload.eventType === 'DELETE' || isInternal(payload.new);
  const changed = gone ? removeLocal(c, (payload.new?.id || payload.old?.id)) : upsertLocal(c, payload.new);
  if (!changed) return;
  renderStats(c);
  renderBody(c);
}

function filtered(c) {
  const q = fold(c.q.trim());
  return c.clients
    .filter((x) => (!c.stage || x.stage === c.stage)
      && (!c.type || x.operation_type_id === c.type)
      && (!q || fold(x.name).includes(q) || fold(x.contact).includes(q)))
    .sort(byStageThenSince);
}

const typeOf = (c, id) => c.types.find((t) => t.id === id) || null;

function openForm(c, client) {
  openClientForm({
    client,
    readOnly: !canManage(),
    types: c.types,
    onSaved: (row) => { if (ctx === c && upsertLocal(c, row)) { renderStats(c); renderBody(c); } },
    onDeleted: (id) => { if (ctx === c && removeLocal(c, id)) { renderStats(c); renderBody(c); } },
  });
}

// ----------------------------------------------------------------------------
// Render
// ----------------------------------------------------------------------------
function render(c) {
  // tipos no filtro (preserva a escolha)
  const sel = c.container.querySelector('#clType');
  sel.innerHTML = `<option value="">Todos os tipos</option>${c.types.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}`;
  sel.value = c.types.some((t) => t.id === c.type) ? c.type : '';
  c.type = sel.value;
  renderStats(c);
  renderBody(c);
}

function renderStats(c) {
  const count = (stage) => c.clients.filter((x) => x.stage === stage).length;
  const mrr = c.clients.filter((x) => x.stage === 'active').reduce((sum, x) => sum + Number(x.mrr || 0), 0);
  const dash = c.loading || c.error;
  const tile = (ic, label, value, hint = '') => `
    <div class="stat">
      <div class="stat__label">${icon(ic)}<span>${label}</span></div>
      <div class="stat__value">${dash ? '—' : value}</div>
      ${hint ? `<div class="stat__hint">${hint}</div>` : ''}
    </div>`;
  c.container.querySelector('#clStats').innerHTML =
    tile('circle-dollar-sign', 'MRR', esc(brl(mrr)), 'Soma dos clientes ativos')
    + tile('user-check', 'Clientes ativos', count('active'))
    + tile('handshake', 'Em negociação', count('deal'))
    + tile('target', 'Leads', count('lead'));
  refreshIcons();
}

function renderBody(c) {
  const body = c.container.querySelector('#clBody');
  if (!body) return;
  const state = (html) => { body.innerHTML = `<div class="page-state">${html}</div>`; refreshIcons(); };

  if (c.loading) return state(`${icon('loader-circle', 'spin')} Carregando clientes…`);
  if (c.error) {
    return state(emptyHtml({
      icon: 'triangle-alert', title: 'Não deu para carregar', text: c.error,
      action: `<button type="button" class="btn" data-retry>${icon('refresh-cw')} Tentar de novo</button>`,
    }));
  }
  if (!c.clients.length) {
    return state(emptyHtml({
      icon: 'users', title: 'Nenhum cliente ainda', text: 'Cadastre o primeiro cliente para acompanhar o MRR e os estágios.',
      action: canManage() ? `<button type="button" class="btn btn--primary" data-new>${icon('plus')} Novo cliente</button>` : '',
    }));
  }
  const rows = filtered(c);
  if (!rows.length) {
    return state(emptyHtml({
      icon: 'search', title: 'Nenhum cliente corresponde ao filtro',
      action: `<button type="button" class="btn" data-clear-filters>${icon('x')} Limpar filtros</button>`,
    }));
  }

  // No celular só cabem cliente e MRR: o estágio desce para baixo do nome (.show-sm)
  body.innerHTML = `
    <div class="table-wrap">
      <table class="table table--clickable">
        <thead><tr>
          <th>Cliente</th>
          <th class="hide-sm">Contato</th>
          <th class="hide-sm">Estágio</th>
          <th class="hide-sm">Tipo de operação</th>
          <th class="num">MRR</th>
          <th class="hide-sm">Cliente desde</th>
          <th class="hide-sm">Responsável</th>
        </tr></thead>
        <tbody>${rows.map((x) => {
          const stage = stageOf(x.stage);
          const type = typeOf(c, x.operation_type_id);
          const owner = profileOf(x.owner_id);
          return `
          <tr data-client-id="${x.id}" tabindex="0">
            <td><div class="cell-main">${clientAvatarHtml(x)}<span class="cell-main__text"><span class="truncate">${esc(x.name)}</span><span class="cell-tags cell-tags--sm-only"><span class="show-sm">${chipHtml(stage.label, stage.color, { small: true })}</span></span></span></div></td>
            <td class="hide-sm">${x.contact ? `<div class="truncate">${esc(x.contact)}</div>${x.contact_role ? `<div class="subtle truncate">${esc(x.contact_role)}</div>` : ''}` : '<span class="subtle">—</span>'}</td>
            <td class="hide-sm">${chipHtml(stage.label, stage.color)}</td>
            <td class="hide-sm">${type ? chipHtml(type.name, type.color) : '<span class="subtle">—</span>'}</td>
            <td class="num">${esc(brl(x.mrr))}</td>
            <td class="hide-sm">${esc(dateShort(x.since)) || '<span class="subtle">—</span>'}</td>
            <td class="hide-sm">${owner ? `<div class="cell-main">${avatarHtml(owner, 'sm')}<span class="truncate">${esc(owner.name)}</span></div>` : '<span class="subtle">—</span>'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  refreshIcons();
}
