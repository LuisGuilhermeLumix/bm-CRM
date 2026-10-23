// Topo do board: nome (renomear inline), busca, filtros por tag e por status,
// configurar, novo card
import { icon, refreshIcons } from './icons.js';
import { esc, debounce, isMobile } from '../utils.js';
import { state, on, getBoard, setFilters, sortedTags, sortedColumns, sortedFields } from '../state.js';
import { updateBoard } from '../boards.js';
import { createCard } from '../cards.js';
import { openPopover, openDialog } from './dialog.js';
import { toast, toastError } from './toast.js';
import { toggleSidebar } from './sidebar.js';
import { openBoardSettings } from './boardSettings.js';
import { openCardModal } from './cardModal.js';
import { chipHtml } from './common.js';

let renaming = false;

export function initTopbar() {
  on('board', render);
  on('boards', render);
  on('tags', render);
  on('fields', updateFilterUi);
  on('filters', updateFilterUi);
  render();
}

function render() {
  const host = document.getElementById('topbar');
  if (!host) return;
  const board = getBoard();
  if (!board) { host.classList.add('hidden'); host.innerHTML = ''; return; }
  host.classList.remove('hidden');
  // Não interrompe quem está digitando na busca
  if (document.activeElement?.id === 'searchInput' && host.contains(document.activeElement)) { updateFilterUi(); return; }

  host.innerHTML = `
    <button class="btn btn--ghost btn--icon btn-menu" id="btnMenu" aria-label="Menu">${icon('menu')}</button>
    ${renaming
      ? `<input class="input topbar__title-input" id="boardTitleInput" value="${esc(board.name)}" autocomplete="off" />`
      : `<h1 class="topbar__title" id="boardTitle" title="Clique para renomear">
           <span class="dot" style="--c:${esc(board.color)}"></span><span class="truncate">${esc(board.name)}</span>
         </h1>`}
    <div class="topbar__spacer"></div>
    <div class="search" id="search">
      ${icon('search')}
      <input class="input" id="searchInput" placeholder="Buscar cards…" value="${esc(state.filters.q)}" autocomplete="off" />
      <button class="search__clear hidden" id="searchClear" aria-label="Limpar busca">${icon('x', 'ico--sm')}</button>
      <span class="search__kbd">/</span>
    </div>
    <button class="btn" id="btnTagFilter" title="Filtrar por tag">${icon('tag')}<span class="btn-label">Tags</span><span class="filter-badge hidden" id="tagBadge"></span></button>
    <button class="btn" id="btnStatusFilter" title="Filtrar por status">${icon('circle-dot')}<span class="btn-label">Status</span><span class="filter-badge hidden" id="statusBadge"></span></button>
    <button class="btn" id="btnSettings" title="Configurar board">${icon('settings-2')}<span class="btn-label">Configurar</span></button>
    <button class="btn btn--primary" id="btnNewCard" title="Novo card (N)">${icon('plus')}<span class="btn-label">Novo card</span></button>`;
  refreshIcons();
  bind(host, board);
  updateFilterUi();
}

function bind(host, board) {
  host.querySelector('#btnMenu').addEventListener('click', toggleSidebar);

  // --- renomear inline ---
  const title = host.querySelector('#boardTitle');
  if (title) {
    title.addEventListener('click', () => {
      renaming = true;
      render();
      const inp = document.getElementById('boardTitleInput');
      inp?.focus(); inp?.select();
    });
  }
  const inp = host.querySelector('#boardTitleInput');
  if (inp) {
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      renaming = false;
      const name = inp.value.trim();
      if (save && name && name !== board.name) {
        try { await updateBoard(board.id, { name }); } catch (e) { toastError(e); render(); }
      } else {
        render();
      }
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    inp.addEventListener('blur', () => finish(true));
  }

  // --- busca ---
  const search = host.querySelector('#search');
  const input = host.querySelector('#searchInput');
  const apply = debounce(() => setFilters({ q: input.value }), 150);
  input.addEventListener('input', apply);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); input.value = ''; setFilters({ q: '' }); input.blur(); }
    if (e.key === 'Enter') input.blur();
  });
  search.addEventListener('click', () => { if (isMobile()) { search.classList.add('is-open'); input.focus(); } });
  input.addEventListener('blur', () => { if (isMobile() && !input.value) search.classList.remove('is-open'); });
  host.querySelector('#searchClear').addEventListener('click', () => {
    input.value = '';
    setFilters({ q: '' });
    if (isMobile()) search.classList.remove('is-open'); else input.focus();
  });

  host.querySelector('#btnTagFilter').addEventListener('click', (e) => openTagFilter(e.currentTarget));
  host.querySelector('#btnStatusFilter').addEventListener('click', (e) => openStatusFilter(e.currentTarget));
  host.querySelector('#btnSettings').addEventListener('click', () => openBoardSettings('columns'));
  host.querySelector('#btnNewCard').addEventListener('click', () => newCardFlow());
}

function updateFilterUi() {
  const host = document.getElementById('topbar');
  if (!host || !getBoard()) return;
  const input = host.querySelector('#searchInput');
  const clear = host.querySelector('#searchClear');
  const kbd = host.querySelector('.search__kbd');
  if (input && input.value !== state.filters.q && document.activeElement !== input) input.value = state.filters.q;
  const hasQ = !!state.filters.q;
  clear?.classList.toggle('hidden', !hasQ);
  kbd?.classList.toggle('hidden', hasQ);

  const setBadge = (badgeId, btnId, n) => {
    const badge = host.querySelector(badgeId);
    const btn = host.querySelector(btnId);
    if (badge) { badge.textContent = n; badge.classList.toggle('hidden', !n); }
    btn?.classList.toggle('has-filter', n > 0);
  };
  setBadge('#tagBadge', '#btnTagFilter', state.filters.tagIds.length);
  // descarta chaves de status que não existem mais (campo/opção removidos)
  const valid = new Set(statusEntries().map((e) => e.key));
  const statusKeys = state.filters.statusKeys.filter((k) => valid.has(k));
  if (statusKeys.length !== state.filters.statusKeys.length) { setFilters({ statusKeys }); return; }
  setBadge('#statusBadge', '#btnStatusFilter', statusKeys.length);
}

function openTagFilter(anchor) {
  const tags = sortedTags();
  const paint = (pop) => {
    const sel = state.filters.tagIds;
    pop.querySelector('.menu').innerHTML = `
      ${tags.length ? '<div class="menu__label">Filtrar por tag</div>' : ''}
      ${tags.map((t) => `
        <button type="button" class="menu__item ${sel.includes(t.id) ? 'is-selected' : ''}" data-tag="${t.id}">
          ${chipHtml(t.name, t.color)}${sel.includes(t.id) ? icon('check', 'check ico--sm') : ''}
        </button>`).join('')}
      ${!tags.length ? `<div class="popover__empty">Nenhuma tag neste board ainda.</div>
        <button type="button" class="menu__item" data-create>${icon('plus')}<span>Criar tags</span></button>` : ''}
      ${sel.length ? `<div class="menu__sep"></div><button type="button" class="menu__item" data-clear>${icon('x')}<span>Limpar filtro</span></button>` : ''}`;
    refreshIcons();
  };
  const pop = openPopover(anchor, '<div class="menu"></div>', { align: 'end' });
  paint(pop);
  pop.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tag]');
    if (t) {
      const id = t.dataset.tag;
      const cur = state.filters.tagIds;
      setFilters({ tagIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
      paint(pop);
      return;
    }
    if (e.target.closest('[data-clear]')) { setFilters({ tagIds: [] }); paint(pop); return; }
    if (e.target.closest('[data-create]')) { openBoardSettings('tags'); }
  });
}

/** Todas as opções de status do board: [{ key: "<fieldId>:<optionId>", field, option }] */
function statusEntries() {
  const out = [];
  for (const f of sortedFields()) {
    if (!f.status_enabled) continue;
    for (const o of f.status_options || []) out.push({ key: `${f.id}:${o.id}`, field: f, option: o });
  }
  return out;
}

function openStatusFilter(anchor) {
  const paint = (pop) => {
    const sel = state.filters.statusKeys;
    const fields = sortedFields().filter((f) => f.status_enabled);
    pop.querySelector('.menu').innerHTML = `
      ${fields.map((f) => `
        <div class="menu__label">${esc(f.name)} › ${esc(f.status_label || 'Status')}</div>
        ${(f.status_options || []).map((o) => {
          const key = `${f.id}:${o.id}`;
          return `<button type="button" class="menu__item ${sel.includes(key) ? 'is-selected' : ''}" data-key="${esc(key)}">
            ${chipHtml(o.label, o.color)}${sel.includes(key) ? icon('check', 'check ico--sm') : ''}
          </button>`;
        }).join('') || '<div class="popover__empty">Sem opções ainda.</div>'}`).join('')}
      ${!fields.length ? '<div class="popover__empty">Nenhum campo com status neste board. Ative em "Editar campo" → Status.</div>' : ''}
      ${sel.length ? `<div class="menu__sep"></div><button type="button" class="menu__item" data-clear>${icon('x')}<span>Limpar filtro</span></button>` : ''}`;
    refreshIcons();
  };
  const pop = openPopover(anchor, '<div class="menu"></div>', { align: 'end', cls: 'popover--wide' });
  paint(pop);
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-key]');
    if (b) {
      const key = b.dataset.key;
      const cur = state.filters.statusKeys;
      setFilters({ statusKeys: cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key] });
      paint(pop);
      return;
    }
    if (e.target.closest('[data-clear]')) { setFilters({ statusKeys: [] }); paint(pop); }
  });
}

/** Fluxo "Novo card": pergunta título + coluna, cria e abre o modal. */
export async function newCardFlow(columnId = null) {
  const board = getBoard();
  if (!board) return;
  const cols = sortedColumns();
  if (!cols.length) {
    toast('Crie uma coluna antes de adicionar cards.', { type: 'warning' });
    openBoardSettings('columns');
    return;
  }
  const dlg = openDialog({
    title: 'Novo card',
    body: `
      <div class="form-field">
        <label>Título</label>
        <input class="input" id="ncTitle" placeholder="Nome do cliente ou lead" autocomplete="off" />
      </div>
      <div class="form-field">
        <label>Coluna</label>
        <select class="select" id="ncColumn">
          ${cols.map((c) => `<option value="${c.id}" ${c.id === (columnId || cols[0].id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </div>`,
    actions: [
      { label: 'Cancelar', cls: 'btn--ghost', value: null },
      {
        label: 'Criar card', cls: 'btn--primary', value: 'ok',
        onClick: (root) => {
          if (!root.querySelector('#ncTitle').value.trim()) { root.querySelector('#ncTitle').focus(); return false; }
          return true;
        },
      },
    ],
  });
  dlg.root.querySelector('#ncTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); dlg.root.querySelector('[data-action="1"]').click(); }
  });
  const r = await dlg.result;
  if (r !== 'ok') return;
  const titleV = dlg.root.querySelector('#ncTitle').value.trim();
  const colId = dlg.root.querySelector('#ncColumn').value;
  try {
    const card = await createCard(board.id, colId, titleV);
    openCardModal(card.id);
  } catch (e) {
    toastError(e);
  }
}
