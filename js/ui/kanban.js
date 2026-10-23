// Render do board (colunas + cards) e drag-and-drop com SortableJS
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/modular/sortable.esm.js';
import { icon, refreshIcons } from './icons.js';
import { esc, relativeTime, formatDateTimeBR, isTyping, randomPaletteColor } from '../utils.js';
import {
  state, on, flushPendingRenders, getColumn, getTag, profileOf, sortedColumns, sortedFields, cardsInColumn, hasActiveFilters,
} from '../state.js';
import { createColumn, updateColumn, deleteColumn, reorderColumns, moveColumn } from '../columns.js';
import { createCard, moveCard, cardMatchesFilters } from '../cards.js';
import { chipHtml, avatarHtml, emptyHtml } from './common.js';
import { fieldSummaryHtml } from './fieldInputs.js';
import { openMenu, openDialog, confirmDialog, promptDialog } from './dialog.js';
import { openColorPopover } from './colorPicker.js';
import { toast, toastError } from './toast.js';
import { openCardModal } from './cardModal.js';
import { openBoardSettings } from './boardSettings.js';

let sortables = [];
let addingInColumn = null;   // id da coluna com o form "adicionar card" aberto
let addingColumn = false;    // form "nova coluna" aberto
let newColumnColor = '#3b82f6';
let editingColumnId = null;  // coluna sendo renomeada inline
let justDragged = false;
let deferred = false;

const host = () => document.getElementById('board');

export function initKanban() {
  ['board', 'cards', 'columns', 'fields', 'tags', 'filters', 'profiles'].forEach((ev) => on(ev, () => render(false)));
  const h = host();
  h.addEventListener('click', onClick);
  h.addEventListener('focusout', () => {
    if (deferred) { deferred = false; setTimeout(() => render(false), 0); }
  });
  render(true);
}

function destroySortables() {
  sortables.forEach((s) => { try { s.destroy(); } catch { /* ignore */ } });
  sortables = [];
}

export function render(force = false) {
  const h = host();
  if (!h || !state.boardId) return;
  // Não re-renderiza enquanto alguém digita num input do board (form inline, renomear coluna)
  if (!force && h.contains(document.activeElement) && isTyping()) { deferred = true; return; }

  if (state.loadingBoard) {
    destroySortables();
    h.innerHTML = `<div class="board__loading">${icon('loader-circle', 'spin')} Carregando board…</div>`;
    refreshIcons();
    return;
  }

  // preserva scroll
  const prev = h.querySelector('.kanban');
  const scrollLeft = prev?.scrollLeft || 0;
  const scrollTops = {};
  h.querySelectorAll('.column__list').forEach((l) => { scrollTops[l.dataset.columnId] = l.scrollTop; });

  destroySortables();
  const cols = sortedColumns();

  if (!cols.length && !addingColumn) {
    h.innerHTML = `<div class="board-empty">${emptyHtml({
      icon: 'columns-3',
      title: 'Este board ainda não tem colunas',
      text: 'Colunas são os status do seu funil (ex.: Lead, Proposta, Ativo). Crie a primeira para começar.',
      action: `<div class="row"><button class="btn btn--primary" data-add-column>${icon('plus')} Criar primeira coluna</button>
               <button class="btn" data-open-settings="columns">${icon('settings-2')} Configurar board</button></div>`,
    })}</div>`;
    refreshIcons();
    return;
  }

  h.innerHTML = `<div class="kanban" id="kanban">${cols.map(columnHtml).join('')}${addColumnHtml()}</div>`;
  refreshIcons();

  const kanban = h.querySelector('#kanban');
  kanban.scrollLeft = scrollLeft;
  h.querySelectorAll('.column__list').forEach((l) => { if (scrollTops[l.dataset.columnId]) l.scrollTop = scrollTops[l.dataset.columnId]; });

  bindInlineForms(h);
  initSortables(kanban);
}

// ----------------------------------------------------------------------------
// HTML
// ----------------------------------------------------------------------------
function columnHtml(col) {
  const all = cardsInColumn(col.id);
  const filtering = hasActiveFilters();
  const visible = filtering ? all.filter(cardMatchesFilters) : all;
  const over = col.wip_limit != null && all.length > col.wip_limit;
  const countLabel = filtering ? `${visible.length}/${all.length}` : (col.wip_limit != null ? `${all.length}/${col.wip_limit}` : `${all.length}`);
  const adding = addingInColumn === col.id;

  return `
  <section class="column" data-column-id="${col.id}" style="--c:${esc(col.color)}">
    <header class="column__header">
      <span class="dot"></span>
      ${editingColumnId === col.id
        ? `<input class="input input--sm column__name-input" value="${esc(col.name)}" data-rename="${col.id}" autocomplete="off" />`
        : `<h3 class="column__name" data-rename-trigger="${col.id}" title="Clique para renomear">${esc(col.name)}</h3>`}
      <span class="column__count ${over ? 'is-over' : ''}" title="${col.wip_limit != null ? `Limite WIP: ${col.wip_limit}` : 'Cards na coluna'}">${countLabel}</span>
      <button class="btn btn--ghost btn--icon btn--sm column__menu" data-colmenu="${col.id}" aria-label="Opções da coluna" aria-expanded="false">${icon('ellipsis')}</button>
    </header>
    ${over ? `<div class="column__wip">${icon('triangle-alert', 'ico--sm')} Limite de ${col.wip_limit} ultrapassado</div>` : ''}
    <div class="column__list" data-column-id="${col.id}">${visible.map(cardHtml).join('')}</div>
    ${!visible.length && !adding ? `<div class="column__empty">${emptyHtml({
      icon: filtering && all.length ? 'search' : 'inbox',
      text: filtering && all.length ? 'Nenhum card corresponde ao filtro' : 'Nenhum card aqui',
      action: !filtering ? `<button class="btn btn--sm" data-add-card="${col.id}">${icon('plus', 'ico--sm')} Adicionar card</button>` : '',
      small: true,
    })}</div>` : ''}
    <footer class="column__footer">
      ${adding ? inlineAddHtml(col.id) : (visible.length ? `<button class="column__add" data-add-card="${col.id}">${icon('plus')} Adicionar card</button>` : '')}
    </footer>
  </section>`;
}

function inlineAddHtml(colId) {
  return `
  <div class="inline-add" data-inline-add="${colId}">
    <textarea class="textarea" rows="2" placeholder="Título do card" data-inline-title></textarea>
    <div class="row">
      <button class="btn btn--primary btn--sm" data-inline-submit>Adicionar</button>
      <button class="btn btn--ghost btn--sm" data-inline-cancel>Cancelar</button>
      <span class="subtle grow" style="text-align:right">Enter para salvar</span>
    </div>
  </div>`;
}

function addColumnHtml() {
  if (!addingColumn) return `<button class="add-column" data-add-column>${icon('plus')} Nova coluna</button>`;
  return `
  <div class="add-column-form" data-add-column-form>
    <div class="row">
      <button type="button" class="color-btn" data-newcol-color style="--c:${esc(newColumnColor)}" title="Cor da coluna"></button>
      <input class="input" placeholder="Nome da coluna" data-newcol-name autocomplete="off" />
    </div>
    <div class="row">
      <button class="btn btn--primary btn--sm" data-newcol-submit>Criar coluna</button>
      <button class="btn btn--ghost btn--sm" data-newcol-cancel>Cancelar</button>
    </div>
  </div>`;
}

function cardHtml(card) {
  const tags = (card.tag_ids || []).map(getTag).filter(Boolean);
  const fields = sortedFields().filter((f) => f.show_on_card).map((f) => fieldSummaryHtml(f, card.values)).filter(Boolean);
  const creator = profileOf(card.created_by);
  return `
  <article class="card" data-card-id="${card.id}">
    <div class="card__title">${esc(card.title)}</div>
    ${tags.length ? `<div class="card__tags">${tags.map((t) => chipHtml(t.name, t.color, { small: true })).join('')}</div>` : ''}
    ${fields.length ? `<div class="card__fields">${fields.join('')}</div>` : ''}
    <div class="card__footer">
      <span class="row">${avatarHtml(creator, 'sm')}</span>
      <span title="Atualizado em ${esc(formatDateTimeBR(card.updated_at))}">${esc(relativeTime(card.updated_at))}</span>
    </div>
  </article>`;
}

// ----------------------------------------------------------------------------
// Eventos
// ----------------------------------------------------------------------------
function onClick(e) {
  const t = e.target;

  const card = t.closest('.card');
  if (card) {
    if (justDragged) return;
    openCardModal(card.dataset.cardId);
    return;
  }

  const addCard = t.closest('[data-add-card]');
  if (addCard) {
    addingInColumn = addCard.dataset.addCard;
    render(true);
    const ta = host().querySelector(`[data-inline-add="${addingInColumn}"] textarea`);
    ta?.focus();
    ta?.closest('.column__footer')?.scrollIntoView({ block: 'nearest' });
    return;
  }

  if (t.closest('[data-inline-submit]')) { submitInlineCard(t.closest('[data-inline-add]')); return; }
  if (t.closest('[data-inline-cancel]')) { addingInColumn = null; render(true); return; }

  const menu = t.closest('[data-colmenu]');
  if (menu) { openColumnMenu(menu, menu.dataset.colmenu); return; }

  const rename = t.closest('[data-rename-trigger]');
  if (rename) { startRename(rename.dataset.renameTrigger); return; }

  if (t.closest('[data-add-column]')) {
    addingColumn = true;
    render(true);
    const inp = host().querySelector('[data-newcol-name]');
    inp?.focus();
    inp?.closest('.add-column-form')?.scrollIntoView({ inline: 'end', block: 'nearest' });
    return;
  }
  if (t.closest('[data-newcol-cancel]')) { addingColumn = false; render(true); return; }
  if (t.closest('[data-newcol-submit]')) { submitNewColumn(); return; }
  const colorBtn = t.closest('[data-newcol-color]');
  if (colorBtn) {
    openColorPopover(colorBtn, newColumnColor, (hex) => { newColumnColor = hex; colorBtn.style.setProperty('--c', hex); });
    return;
  }

  const openSet = t.closest('[data-open-settings]');
  if (openSet) { openBoardSettings(openSet.dataset.openSettings); }
}

function bindInlineForms(h) {
  h.querySelectorAll('[data-inline-title]').forEach((ta) => {
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitInlineCard(ta.closest('[data-inline-add]')); }
      if (e.key === 'Escape') { e.stopPropagation(); addingInColumn = null; render(true); }
    });
  });
  const newCol = h.querySelector('[data-newcol-name]');
  if (newCol) {
    newCol.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitNewColumn(); }
      if (e.key === 'Escape') { e.stopPropagation(); addingColumn = false; render(true); }
    });
  }
  const renameInput = h.querySelector('[data-rename]');
  if (renameInput) {
    const colId = renameInput.dataset.rename;
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      editingColumnId = null;
      const name = renameInput.value.trim();
      const col = getColumn(colId);
      renameInput.blur();
      if (save && name && col && name !== col.name) {
        try { await updateColumn(colId, { name }); } catch (err) { toastError(err); }
      }
      render(true);
    };
    renameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    renameInput.addEventListener('blur', () => finish(true));
    setTimeout(() => { renameInput.focus(); renameInput.select(); }, 10);
  }
}

async function submitInlineCard(form) {
  if (!form) return;
  const colId = form.dataset.inlineAdd;
  const ta = form.querySelector('textarea');
  const title = ta.value.trim();
  if (!title) { ta.focus(); return; }
  addingInColumn = null;
  ta.blur();
  try {
    const card = await createCard(state.boardId, colId, title);
    openCardModal(card.id);
  } catch (e) {
    toastError(e);
    render(true);
  }
}

async function submitNewColumn() {
  const inp = host().querySelector('[data-newcol-name]');
  const name = inp?.value.trim();
  if (!name) { inp?.focus(); return; }
  addingColumn = false;
  inp.blur();
  try {
    await createColumn(state.boardId, { name, color: newColumnColor });
    newColumnColor = randomPaletteColor();
    const k = host().querySelector('#kanban');
    if (k) k.scrollLeft = k.scrollWidth;
  } catch (e) {
    toastError(e);
    render(true);
  }
}

function startRename(colId) {
  editingColumnId = colId;
  render(true);
}

function openColumnMenu(anchor, colId) {
  const cols = sortedColumns();
  const i = cols.findIndex((c) => c.id === colId);
  const col = cols[i];
  if (!col) return;
  openMenu(anchor, [
    { label: 'Renomear', icon: 'pencil', value: 'rename' },
    { label: 'Mudar cor', icon: 'palette', value: 'color' },
    { label: col.wip_limit != null ? `Limite WIP (${col.wip_limit})` : 'Definir limite WIP', icon: 'gauge', value: 'wip' },
    'sep',
    { label: 'Mover para a esquerda', icon: 'arrow-left', value: 'left', disabled: i === 0 },
    { label: 'Mover para a direita', icon: 'arrow-right', value: 'right', disabled: i === cols.length - 1 },
    'sep',
    { label: 'Excluir coluna', icon: 'trash-2', value: 'delete', danger: true },
  ], async (v) => {
    try {
      if (v === 'rename') startRename(colId);
      if (v === 'color') openColorPopover(anchor, col.color, (hex) => updateColumn(colId, { color: hex }).catch(toastError));
      if (v === 'wip') {
        const r = await promptDialog({
          title: 'Limite de cards (WIP)', label: 'Quantidade máxima de cards nesta coluna', type: 'number',
          value: col.wip_limit ?? '', placeholder: 'Deixe vazio para sem limite', hint: 'Só mostra um aviso quando ultrapassar; não bloqueia.',
        });
        if (r === null) return;
        const n = r.trim() === '' ? null : Math.max(0, parseInt(r, 10) || 0);
        await updateColumn(colId, { wip_limit: n });
      }
      if (v === 'left') await moveColumn(colId, -1);
      if (v === 'right') await moveColumn(colId, +1);
      if (v === 'delete') await askDeleteColumn(colId);
    } catch (e) { toastError(e); }
  }, { align: 'end' });
}

export async function askDeleteColumn(colId) {
  const col = getColumn(colId);
  if (!col) return;
  const cards = state.cards.filter((c) => c.column_id === colId);
  const others = sortedColumns().filter((c) => c.id !== colId);
  if (!cards.length) {
    const ok = await confirmDialog({ title: 'Excluir coluna', message: `Excluir a coluna "${esc(col.name)}"? Ela está vazia.`, confirmText: 'Excluir' });
    if (ok) await deleteColumn(colId);
    return;
  }
  if (!others.length) {
    toast('Esta é a única coluna e tem cards. Crie outra coluna para mover os cards antes de excluir.', { type: 'warning' });
    return;
  }
  const dlg = openDialog({
    title: 'Excluir coluna',
    danger: true,
    body: `
      <p>A coluna "<b>${esc(col.name)}</b>" tem <b>${cards.length} ${cards.length === 1 ? 'card' : 'cards'}</b>. Para onde mover?</p>
      <div class="form-field">
        <label>Mover cards para</label>
        <select class="select" id="delColTarget">${others.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      </div>`,
    actions: [
      { label: 'Cancelar', cls: 'btn--ghost', value: null },
      { label: 'Mover e excluir', cls: 'btn--danger', value: 'ok' },
    ],
  });
  const r = await dlg.result;
  if (r !== 'ok') return;
  const target = dlg.root.querySelector('#delColTarget').value;
  await deleteColumn(colId, target);
  toast('Coluna excluída e cards movidos.', { type: 'success' });
}

// ----------------------------------------------------------------------------
// Drag-and-drop
// ----------------------------------------------------------------------------
function initSortables(kanban) {
  const common = { animation: 150, delay: 150, delayOnTouchOnly: true, touchStartThreshold: 5, fallbackTolerance: 3 };

  // colunas
  sortables.push(new Sortable(kanban, {
    ...common,
    group: 'columns',
    draggable: '.column',
    handle: '.column__header',
    filter: 'input, button, .add-column, .add-column-form',
    preventOnFilter: false,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onStart: () => { state.dragging = true; },
    onEnd: () => {
      justDragged = true;
      setTimeout(() => { justDragged = false; }, 200);
      const ids = [...kanban.querySelectorAll('.column')].map((c) => c.dataset.columnId);
      if (ids.join() !== sortedColumns().map((c) => c.id).join()) {
        reorderColumns(ids).catch((e) => { toastError(e); render(true); });
      }
      setTimeout(() => { state.dragging = false; flushPendingRenders(); }, 0);
    },
  }));

  // cards
  kanban.querySelectorAll('.column__list').forEach((list) => {
    sortables.push(new Sortable(list, {
      ...common,
      group: 'cards',
      draggable: '.card',
      ghostClass: 'card--ghost',
      chosenClass: 'card--chosen',
      dragClass: 'card--drag',
      fallbackOnBody: true,
      emptyInsertThreshold: 24,
      onStart: () => { state.dragging = true; },
      onEnd: (evt) => {
        justDragged = true;
        setTimeout(() => { justDragged = false; }, 200);
        onCardDrop(evt);
        setTimeout(() => { state.dragging = false; flushPendingRenders(); }, 0);
      },
    }));
  });
}

/**
 * Calcula a nova posição a partir do vizinho seguinte no DOM (e não do índice
 * do Sortable), para funcionar também quando há filtro ativo e nem todos os
 * cards da coluna estão visíveis.
 */
function onCardDrop(evt) {
  const cardId = evt.item.dataset.cardId;
  const toCol = evt.to.dataset.columnId;
  const fromCol = evt.from.dataset.columnId;
  if (fromCol === toCol && evt.oldIndex === evt.newIndex) return;

  let next = evt.item.nextElementSibling;
  while (next && !next.classList.contains('card')) next = next.nextElementSibling;
  const others = cardsInColumn(toCol).filter((c) => c.id !== cardId);
  let pos = others.length;
  if (next) {
    const i = others.findIndex((c) => c.id === next.dataset.cardId);
    if (i !== -1) pos = i;
  }
  moveCard(cardId, toCol, pos).catch((e) => toastError(e));
}
