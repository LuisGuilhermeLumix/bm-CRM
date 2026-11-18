// Seção Clientes (#/clientes): indicadores, lista ou pipeline, filtros, modal
// de criar/editar e realtime em fin_clients.
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/modular/sortable.esm.js';
import { icon, refreshIcons } from '../icons.js';
import { esc, storage, debounce } from '../../utils.js';
import { on, profileOf, stable } from '../../state.js';
import { chipHtml, avatarHtml, emptyHtml } from '../common.js';
import { tagChipsHtml } from '../tagsInput.js';
import { toastError } from '../toast.js';
import { openClientForm, clientLogoHtml } from '../clientForm.js';
import { STAGES, stageOf, brl, dateShort, fold } from '../../fin/format.js';
import { isMissingInDb } from '../../fin/db.js';
import { fetchClients, setClientStage, subscribeClients } from '../../fin/clients.js';
import { fetchOperationTypes } from '../../fin/refs.js';

const VIEW_KEY = 'lumix.clientsView';
let ctx = null; // estado da página montada (null fora da seção)

export function mount(container) {
  const c = ctx = {
    container,
    clients: [], types: [], loading: true, error: null,
    view: storage.get(VIEW_KEY) === 'pipeline' ? 'pipeline' : 'list',
    q: '', stage: '', type: '',
    sortables: [], dragging: false, pendingRender: false, offs: [],
  };
  container.innerHTML = `
    <div class="page__inner" id="clRoot">
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
        <div class="segmented" role="group" aria-label="Visão">
          <button type="button" data-view="list">${icon('list')}<span>Lista</span></button>
          <button type="button" data-view="pipeline">${icon('kanban')}<span>Pipeline</span></button>
        </div>
        <button type="button" class="btn btn--primary" id="clNew">${icon('plus')}<span>Novo cliente</span></button>
      </div>
      <div class="page__body" id="clBody"></div>
    </div>`;
  refreshIcons();

  const $ = (sel) => container.querySelector(sel);
  $('#clSearch').addEventListener('input', debounce(() => { c.q = $('#clSearch').value; renderBody(c); }, 120));
  $('#clStage').addEventListener('change', (e) => { c.stage = e.target.value; renderBody(c); });
  $('#clType').addEventListener('change', (e) => { c.type = e.target.value; renderBody(c); });
  container.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    c.view = b.dataset.view;
    storage.set(VIEW_KEY, c.view);
    render(c);
  }));
  $('#clNew').addEventListener('click', () => openForm(c, null));
  $('#clBody').addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) { load(c); return; }
    if (e.target.closest('[data-new]')) { openForm(c, null); return; }
    if (e.target.closest('[data-clear-filters]')) { clearFilters(c); return; }
    const row = e.target.closest('[data-client-id]');
    if (row && !c.justDragged) openForm(c, c.clients.find((x) => x.id === row.dataset.clientId));
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
  destroySortables(c);
}

async function load(c) {
  c.loading = true;
  c.error = null;
  render(c);
  try {
    const [clients, types] = await Promise.all([fetchClients(), fetchOperationTypes()]);
    if (ctx !== c) return;
    c.clients = clients;
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
const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR') || (a.id > b.id ? 1 : -1);

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
  const changed = payload.eventType === 'DELETE' ? removeLocal(c, payload.old?.id) : upsertLocal(c, payload.new);
  if (!changed) return;
  if (c.dragging) { c.pendingRender = true; return; } // não mexe no DOM no meio de um arraste
  renderStats(c);
  renderBody(c);
}

function filtered(c) {
  const q = fold(c.q.trim());
  return c.clients
    .filter((x) => (!c.stage || x.stage === c.stage)
      && (!c.type || x.operation_type_id === c.type)
      && (!q || fold(x.name).includes(q) || fold(x.contact).includes(q)))
    .sort(byName);
}

const typeOf = (c, id) => c.types.find((t) => t.id === id) || null;
const allTags = (c) => [...new Set(c.clients.flatMap((x) => x.tags || []))];

function openForm(c, client) {
  openClientForm({
    client,
    types: c.types,
    tagSuggestions: allTags(c),
    onSaved: (row) => { if (ctx === c && upsertLocal(c, row)) { renderStats(c); renderBody(c); } },
    onDeleted: (id) => { if (ctx === c && removeLocal(c, id)) { renderStats(c); renderBody(c); } },
  });
}

// ----------------------------------------------------------------------------
// Render
// ----------------------------------------------------------------------------
function render(c) {
  const root = c.container.querySelector('#clRoot');
  root.classList.toggle('page__inner--fill', c.view === 'pipeline');
  c.container.querySelectorAll('[data-view]').forEach((b) => {
    const active = b.dataset.view === c.view;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-pressed', String(active));
  });
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

function destroySortables(c) {
  c.sortables.forEach((s) => { try { s.destroy(); } catch { /* ignore */ } });
  c.sortables = [];
}

function renderBody(c) {
  const body = c.container.querySelector('#clBody');
  if (!body) return;
  destroySortables(c);
  body.classList.toggle('page__body--fill', c.view === 'pipeline' && !c.loading && !c.error && c.clients.length > 0);

  if (c.loading) {
    body.innerHTML = `<div class="page-state">${icon('loader-circle', 'spin')} Carregando clientes…</div>`;
    refreshIcons();
    return;
  }
  if (c.error) {
    body.innerHTML = `<div class="page-state">${emptyHtml({
      icon: 'triangle-alert', title: 'Não deu para carregar', text: c.error,
      action: `<button type="button" class="btn" data-retry>${icon('refresh-cw')} Tentar de novo</button>`,
    })}</div>`;
    refreshIcons();
    return;
  }
  if (!c.clients.length) {
    body.innerHTML = `<div class="page-state">${emptyHtml({
      icon: 'users', title: 'Nenhum cliente ainda', text: 'Cadastre o primeiro cliente para acompanhar o pipeline e o MRR.',
      action: `<button type="button" class="btn btn--primary" data-new>${icon('plus')} Novo cliente</button>`,
    })}</div>`;
    refreshIcons();
    return;
  }

  const rows = filtered(c);
  if (c.view === 'pipeline') renderPipeline(c, body, rows);
  else renderList(c, body, rows);
  refreshIcons();
}

function renderList(c, body, rows) {
  if (!rows.length) {
    body.innerHTML = `<div class="page-state">${emptyHtml({
      icon: 'search', title: 'Nenhum cliente corresponde ao filtro',
      action: `<button type="button" class="btn" data-clear-filters>${icon('x')} Limpar filtros</button>`,
    })}</div>`;
    return;
  }
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
            <td><div class="cell-main">${clientLogoHtml(x)}<span class="cell-main__text"><span class="truncate">${esc(x.name)}</span><span class="cell-tags ${(x.tags || []).length ? '' : 'cell-tags--sm-only'}"><span class="show-sm">${chipHtml(stage.label, stage.color, { small: true })}</span>${tagChipsHtml(x.tags)}</span></span></div></td>
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
}

function renderPipeline(c, body, rows) {
  const prev = body.querySelector('.kanban');
  const scrollLeft = prev?.scrollLeft || 0;
  const filtering = !!(c.q.trim() || c.stage || c.type);
  body.innerHTML = `
    <div class="kanban kanban--pipeline">${STAGES.map((s) => {
      const all = c.clients.filter((x) => x.stage === s.id);
      const list = rows.filter((x) => x.stage === s.id);
      const mrr = list.reduce((sum, x) => sum + Number(x.mrr || 0), 0);
      return `
      <section class="column" style="--c:${s.color}">
        <header class="column__header">
          <span class="dot"></span>
          <h3 class="column__name">${esc(s.label)}</h3>
          <span class="column__count" title="Clientes neste estágio">${filtering ? `${list.length}/${all.length}` : all.length}</span>
        </header>
        <div class="column__sub">${esc(brl(mrr))} de MRR</div>
        <div class="column__list" data-stage="${s.id}">${list.map((x) => pipelineCardHtml(c, x)).join('')}</div>
      </section>`;
    }).join('')}</div>`;
  const kanban = body.querySelector('.kanban');
  kanban.scrollLeft = scrollLeft;

  kanban.querySelectorAll('.column__list').forEach((list) => {
    c.sortables.push(new Sortable(list, {
      group: 'clients', sort: false, draggable: '.card',
      animation: 150, delay: 150, delayOnTouchOnly: true, touchStartThreshold: 5, fallbackTolerance: 3,
      ghostClass: 'card--ghost', chosenClass: 'card--chosen', dragClass: 'card--drag',
      fallbackOnBody: true, emptyInsertThreshold: 24,
      onStart: () => { c.dragging = true; },
      onEnd: (evt) => {
        c.justDragged = true;
        setTimeout(() => { c.justDragged = false; }, 200);
        setTimeout(() => {
          c.dragging = false;
          c.pendingRender = false;
          onDrop(c, evt.item.dataset.clientId, evt.from.dataset.stage, evt.to.dataset.stage);
        }, 0);
      },
    }));
  });
}

function pipelineCardHtml(c, x) {
  const type = typeOf(c, x.operation_type_id);
  const owner = profileOf(x.owner_id);
  return `
  <article class="card" data-client-id="${x.id}">
    <div class="cell-main">${clientLogoHtml(x)}<span class="card__title truncate">${esc(x.name)}</span></div>
    ${x.contact ? `<div class="card__field">${icon('user')}<span>${esc(x.contact)}</span></div>` : ''}
    ${type || (x.tags || []).length ? `<div class="card__tags">${type ? chipHtml(type.name, type.color, { small: true }) : ''}${tagChipsHtml(x.tags)}</div>` : ''}
    <div class="card__footer">
      <span class="row">${owner ? avatarHtml(owner, 'sm') : ''}<span>${x.since ? `desde ${esc(dateShort(x.since))}` : ''}</span></span>
      <span class="card__amount" title="MRR">${esc(brl(x.mrr))}</span>
    </div>
  </article>`;
}

/** Soltou um card: se mudou de coluna, grava o novo estágio (otimista, com volta em caso de erro). */
async function onDrop(c, id, from, to) {
  if (ctx !== c) return;
  const client = c.clients.find((x) => x.id === id);
  if (!client || from === to) { renderStats(c); renderBody(c); return; }
  const before = { ...client };
  client.stage = to;
  client.status = stageOf(to).label;
  renderStats(c);
  renderBody(c);
  try {
    const row = await setClientStage(id, to);
    if (ctx !== c) return;
    if (upsertLocal(c, row)) { renderStats(c); renderBody(c); }
  } catch (e) {
    toastError(e);
    if (ctx !== c) return;
    upsertLocal(c, before);
    renderStats(c);
    renderBody(c);
  }
}
