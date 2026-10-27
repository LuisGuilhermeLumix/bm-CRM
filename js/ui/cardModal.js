// Modal do card: título, coluna, tags, campos (editáveis e reordenáveis),
// observações, atividade. Salvamento automático com debounce de 500ms e flush
// ao perder o foco.
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/modular/sortable.esm.js';
import { icon, refreshIcons, fieldIconName } from './icons.js';
import { esc, el, debounce, autoResize, relativeTime, formatDateTimeBR, randomPaletteColor, isTyping } from '../utils.js';
import { state, on, getCard, getColumn, getTag, profileOf, sortedColumns, sortedFields, sortedTags, sortedBoards, cardsInColumn } from '../state.js';
import {
  updateCard, patchValues, moveCard, deleteCard, archiveCard, fetchActivity, addComment, logUpdated,
  cardFields, addFieldToCard, removeFieldFromCard, reorderCardFields, fieldCardUsage,
  duplicateCard, moveCardToBoard, previewMoveCard,
} from '../cards.js';
import { fetchColumns } from '../columns.js';
import { addTagToCard, removeTagFromCard, createTag } from '../tags.js';
import { isEmptyValue, fieldStatuses, statusPrefixOf, groupFieldsByName, fieldVariantSummary } from '../fields.js';
import { renderFieldControl, renderStatusControl, statusKey } from './fieldInputs.js';
import { openFieldEditor } from './fieldEditor.js';
import { chipHtml, avatarHtml, emptyHtml } from './common.js';
import { openMenu, openPopover, closePopover, closeAllPopovers, confirmDialog, openDialog, pushClosable, removeClosable } from './dialog.js';
import { colorGridHtml, bindColorGrid } from './colorPicker.js';
import { toast, toastError, toastSuccess } from './toast.js';

let cur = null;

export function isCardModalOpen() { return !!cur; }
export function currentCardId() { return cur?.cardId || null; }

export function openCardModal(cardId, { focusTitle = false } = {}) {
  if (cur) closeCardModal();
  const card = getCard(cardId);
  if (!card) return;

  const root = el(`
    <div class="modal-backdrop" id="cardModalBackdrop">
      <div class="card-modal" role="dialog" aria-modal="true" aria-label="Card">
        <div class="card-modal__head" id="cmHead"></div>
        <div class="card-modal__body">
          <div class="card-modal__main">
            <div id="cmTitle"></div>
            <div id="cmArchived"></div>
            <div class="section">
              <div class="section__title">${icon('sliders-horizontal')} Campos</div>
              <div class="fields-grid" id="cmFields"></div>
              <div id="cmFieldsFoot">
                <button type="button" class="btn btn--ghost btn--sm" id="cmAddField">${icon('plus', 'ico--sm')} Adicionar campo</button>
              </div>
            </div>
            <div class="section">
              <div class="section__title">${icon('align-left')} Observações</div>
              <div id="cmDesc"></div>
            </div>
            <div class="section">
              <div class="section__title">${icon('history')} Atividade</div>
              <div class="activity" id="cmActivity"></div>
            </div>
          </div>
          <aside class="card-modal__side">
            <div class="section">
              <div class="section__title">${icon('tag')} Tags</div>
              <div class="tags-wrap" id="cmTags"></div>
            </div>
            <div class="section">
              <div class="section__title">${icon('info')} Informações</div>
              <div id="cmInfo" class="subtle" style="display:flex;flex-direction:column;gap:4px"></div>
            </div>
          </aside>
        </div>
      </div>
    </div>`);
  document.getElementById('layers').appendChild(root);

  const ctx = {
    cardId, root,
    pending: { card: {}, values: {}, names: new Set() },
    saving: 0,
    status: 'idle',
    seenUpdatedAt: card.updated_at,
    seenTags: JSON.stringify(card.tag_ids),
    seenFieldIds: JSON.stringify(card.field_ids),
    stale: false,
    offs: [],
    activity: null,
    fieldsSortable: null,
  };
  ctx.save = debounce(() => flush(ctx), 500);
  ctx.onEsc = () => closeCardModal();
  cur = ctx;
  pushClosable(ctx.onEsc);

  root.addEventListener('mousedown', (e) => { if (e.target === root) ctx.backdropDown = true; });
  root.addEventListener('mouseup', (e) => { if (e.target === root && ctx.backdropDown) closeCardModal(); ctx.backdropDown = false; });
  // ao sair de qualquer campo, salva na hora e aplica linhas que ficaram pendentes
  root.addEventListener('focusout', () => {
    ctx.save.cancel();
    flush(ctx);
    setTimeout(() => {
      if (cur !== ctx || typingInside(ctx)) return;
      if (ctx.stale && !ctx.saving) refreshEditable(ctx);
      else syncFields(ctx);
    }, 50);
  });

  ctx.offs.push(on('cards', () => onCardsEvent(ctx)));
  // Mudança na definição de um campo (inclusive vinda do realtime): re-renderiza
  // só a linha daquele campo; linhas com foco esperam o usuário sair delas.
  ctx.offs.push(on('fields', () => syncFields(ctx)));
  ctx.offs.push(on('tags', () => renderTags(ctx)));
  ctx.offs.push(on('columns', () => { renderHead(ctx); renderInfo(ctx); }));
  ctx.offs.push(on('profiles', () => { renderInfo(ctx); renderActivity(ctx); }));

  root.querySelector('#cmAddField').addEventListener('click', (e) => openAddFieldPicker(e.currentTarget, ctx));

  renderHead(ctx);
  renderTitle(ctx);
  renderArchived(ctx);
  renderFields(ctx);
  renderDesc(ctx);
  renderTags(ctx);
  renderInfo(ctx);
  renderActivity(ctx);
  loadActivity(ctx);
  refreshIcons();
  root.querySelector('.card-modal').scrollTop = 0;
  if (focusTitle) {
    setTimeout(() => {
      const ta = root.querySelector('.card-modal__title');
      if (!ta || cur !== ctx) return;
      ta.focus();
      ta.select();
    }, 40);
  }
}

export function closeCardModal() {
  if (!cur) return;
  const ctx = cur;
  cur = null;
  ctx.save.cancel();
  flush(ctx);
  ctx.offs.forEach((off) => off());
  removeClosable(ctx.onEsc);
  closeAllPopovers();
  try { ctx.fieldsSortable?.destroy(); } catch { /* ignore */ }
  ctx.root.remove();
}

const typingInside = (ctx) => ctx.root.contains(document.activeElement) && isTyping();

// ----------------------------------------------------------------------------
// Autosave
// ----------------------------------------------------------------------------
function queueCard(ctx, patch, name) {
  Object.assign(ctx.pending.card, patch);
  ctx.pending.names.add(name);
  setStatus(ctx, 'dirty');
  ctx.save();
}
function queueValue(ctx, key, value, name) {
  ctx.pending.values[key] = value;
  ctx.pending.names.add(name);
  setStatus(ctx, 'dirty');
  ctx.save();
}
function hasPending(ctx) {
  return Object.keys(ctx.pending.card).length > 0 || Object.keys(ctx.pending.values).length > 0;
}

/** values do card + o que ainda não foi salvo (para re-renderizar sem perder digitação). */
function effectiveValues(ctx) {
  const v = { ...(getCard(ctx.cardId)?.values || {}) };
  for (const [k, val] of Object.entries(ctx.pending.values)) {
    if (val == null) delete v[k]; else v[k] = val;
  }
  return v;
}

async function flush(ctx) {
  if (!hasPending(ctx)) return;
  const { card: cardPatch, values, names } = ctx.pending;
  ctx.pending = { card: {}, values: {}, names: new Set() };
  ctx.saving++;
  setStatus(ctx, 'saving');
  try {
    if (Object.keys(cardPatch).length) await updateCard(ctx.cardId, cardPatch);
    if (Object.keys(values).length) await patchValues(ctx.cardId, values);
    ctx.seenUpdatedAt = getCard(ctx.cardId)?.updated_at ?? ctx.seenUpdatedAt;
    setStatus(ctx, 'saved');
    logUpdated(ctx.cardId, [...names]).then(() => { if (cur === ctx) loadActivity(ctx); }).catch(() => {});
  } catch (e) {
    setStatus(ctx, 'error');
    toastError(e);
  } finally {
    ctx.saving--;
    if (cur === ctx && !ctx.saving && !hasPending(ctx) && !typingInside(ctx)) {
      if (ctx.stale) refreshEditable(ctx);
      else syncFields(ctx);
    }
  }
}

function setStatus(ctx, status) {
  ctx.status = status;
  const elx = ctx.root?.querySelector('#cmSave');
  if (!elx) return;
  elx.className = 'card-modal__save';
  if (status === 'saving') elx.innerHTML = `${icon('loader-circle', 'ico--sm spin')} Salvando…`;
  else if (status === 'saved') { elx.classList.add('is-saved'); elx.innerHTML = `${icon('check', 'ico--sm')} Salvo`; }
  else if (status === 'error') { elx.classList.add('is-error'); elx.innerHTML = `${icon('circle-alert', 'ico--sm')} Erro ao salvar`; }
  else elx.innerHTML = '';
  refreshIcons();
  if (status === 'saved') {
    clearTimeout(ctx.statusTimer);
    ctx.statusTimer = setTimeout(() => { if (ctx.status === 'saved') setStatus(ctx, 'idle'); }, 2500);
  }
}

// ----------------------------------------------------------------------------
// Eventos de estado
// ----------------------------------------------------------------------------
function onCardsEvent(ctx) {
  const card = getCard(ctx.cardId);
  if (!card) {
    const moved = state.movedAway.has(ctx.cardId);
    closeCardModal();
    toast(moved ? 'Este card foi movido para outro board.' : 'Este card foi excluído.', { type: 'info' });
    return;
  }
  renderHead(ctx);
  renderInfo(ctx);
  const tagsSig = JSON.stringify(card.tag_ids);
  if (tagsSig !== ctx.seenTags) { ctx.seenTags = tagsSig; renderTags(ctx); }
  const fieldsSig = JSON.stringify(card.field_ids);
  if (fieldsSig !== ctx.seenFieldIds) { ctx.seenFieldIds = fieldsSig; syncFields(ctx); }
  if (card.updated_at !== ctx.seenUpdatedAt) {
    if (ctx.saving) { ctx.seenUpdatedAt = card.updated_at; return; } // mudança nossa
    if (typingInside(ctx) || hasPending(ctx)) { ctx.stale = true; return; }
    refreshEditable(ctx);
  }
}

/** Re-renderiza as partes editáveis com o estado atual (mudança remota). */
function refreshEditable(ctx) {
  const card = getCard(ctx.cardId);
  if (!card) return;
  ctx.stale = false;
  ctx.seenUpdatedAt = card.updated_at;
  renderTitle(ctx);
  renderArchived(ctx);
  renderFields(ctx);
  renderDesc(ctx);
}

// ----------------------------------------------------------------------------
// Cabeçalho / título / arquivado
// ----------------------------------------------------------------------------
function renderHead(ctx) {
  const head = ctx.root.querySelector('#cmHead');
  const card = getCard(ctx.cardId);
  if (!card) return;
  const col = getColumn(card.column_id);
  head.innerHTML = `
    <button type="button" class="col-select" id="cmColumn" title="Mudar de coluna">
      <span class="dot" style="--c:${esc(col?.color || '#6b7280')}"></span>
      <span>${esc(col?.name || '—')}</span>
      ${icon('chevron-down', 'ico--sm')}
    </button>
    <div class="grow"></div>
    <span class="card-modal__save" id="cmSave"></span>
    <button type="button" class="btn btn--ghost btn--icon" id="cmCopy" title="Duplicar ou mover">${icon('copy')}</button>
    <button type="button" class="btn btn--ghost btn--icon" id="cmArchive" title="${card.archived ? 'Restaurar' : 'Arquivar'}">${icon(card.archived ? 'archive-restore' : 'archive')}</button>
    <button type="button" class="btn btn--ghost btn--icon" id="cmDelete" title="Excluir">${icon('trash-2')}</button>
    <button type="button" class="btn btn--ghost btn--icon" id="cmClose" title="Fechar (Esc)">${icon('x')}</button>`;
  refreshIcons();
  setStatus(ctx, ctx.status);

  head.querySelector('#cmColumn').addEventListener('click', (e) => {
    const cols = sortedColumns();
    openMenu(e.currentTarget, [
      { label: 'Mover para', header: true },
      ...cols.map((c) => ({ label: c.name, color: c.color, value: c.id, selected: c.id === card.column_id })),
    ], async (colId) => {
      if (colId === getCard(ctx.cardId)?.column_id) return;
      try { await moveCard(ctx.cardId, colId, cardsInColumn(colId).length); } catch (err) { toastError(err); }
    });
  });
  head.querySelector('#cmCopy').addEventListener('click', (e) => {
    const others = sortedBoards().filter((b) => b.id !== state.boardId).length;
    openMenu(e.currentTarget, [
      { label: 'Duplicar', header: true },
      { label: 'Duplicar com informações', icon: 'copy', value: 'dup-full' },
      { label: 'Duplicar só a estrutura', icon: 'layout-template', value: 'dup-struct' },
      'sep',
      { label: others ? 'Mover para outro board' : 'Mover para outro board (crie outro board antes)', icon: 'arrow-right-left', value: 'move', disabled: !others },
    ], (v) => {
      if (v === 'dup-full') duplicateFlow(ctx, true);
      if (v === 'dup-struct') duplicateFlow(ctx, false);
      if (v === 'move') openMoveDialog(ctx);
    });
  });
  head.querySelector('#cmArchive').addEventListener('click', async () => {
    const c = getCard(ctx.cardId);
    try {
      await archiveCard(ctx.cardId, !c.archived);
      toastSuccess(c.archived ? 'Card restaurado.' : 'Card arquivado.');
      renderArchived(ctx);
      renderTitle(ctx);
      renderHead(ctx);
    } catch (err) { toastError(err); }
  });
  head.querySelector('#cmDelete').addEventListener('click', async () => {
    const c = getCard(ctx.cardId);
    const ok = await confirmDialog({
      title: 'Excluir card',
      message: `Excluir "<b>${esc(c.title)}</b>"? Isso apaga também o histórico e não pode ser desfeito.`,
      confirmText: 'Excluir',
    });
    if (!ok) return;
    try {
      ctx.pending = { card: {}, values: {}, names: new Set() };
      await deleteCard(ctx.cardId);
      if (cur === ctx) closeCardModal();
      toastSuccess('Card excluído.');
    } catch (err) { toastError(err); }
  });
  head.querySelector('#cmClose').addEventListener('click', closeCardModal);
}

/** Salva o que estiver pendente antes de copiar/mover (a cópia leva o estado atual). */
async function flushNow(ctx) {
  ctx.save.cancel();
  await flush(ctx);
}

async function duplicateFlow(ctx, withValues) {
  try {
    await flushNow(ctx);
    const copy = await duplicateCard(ctx.cardId, withValues);
    toastSuccess(withValues ? 'Card duplicado.' : 'Estrutura do card duplicada.');
    openCardModal(copy.id, { focusTitle: true });
  } catch (e) { toastError(e); }
}

/** Modal "Mover para outro board": board + coluna de destino e resumo do que será criado. */
async function openMoveDialog(ctx) {
  await flushNow(ctx);
  const boards = sortedBoards().filter((b) => b.id !== state.boardId);
  if (!boards.length) { toast('Crie outro board antes de mover cards.', { type: 'warning' }); return; }
  const cardId = ctx.cardId;
  let ready = false;
  const dlg = openDialog({
    title: 'Mover para outro board',
    size: 'md',
    body: `
      <div class="form-field">
        <label for="mvBoard">Board de destino</label>
        <select class="select" id="mvBoard">${boards.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>
      </div>
      <div class="form-field">
        <label for="mvColumn">Coluna</label>
        <select class="select" id="mvColumn" disabled><option>Carregando…</option></select>
      </div>
      <div class="info-box" id="mvSummary"></div>`,
    actions: [
      { label: 'Cancelar', cls: 'btn--ghost', value: null },
      { label: 'Mover', cls: 'btn--primary', value: 'ok', onClick: () => ready },
    ],
  });
  const root = dlg.root;
  const boardSel = root.querySelector('#mvBoard');
  const colSel = root.querySelector('#mvColumn');
  const summary = root.querySelector('#mvSummary');
  const okBtn = root.querySelector('[data-action="1"]');
  const setSummary = (ic, html, warn = false) => {
    summary.className = `info-box${warn ? ' info-box--warn' : ''}`;
    summary.innerHTML = `${icon(ic)}<span>${html}</span>`;
    refreshIcons();
  };
  const list = (names) => names.map((n) => `<b>${esc(n)}</b>`).join(', ');

  let seq = 0;
  const load = async () => {
    const my = ++seq;
    ready = false;
    okBtn.disabled = true;
    colSel.disabled = true;
    colSel.innerHTML = '<option>Carregando…</option>';
    setSummary('loader-circle', 'Verificando campos e tags no destino…');
    summary.querySelector('.ico')?.classList.add('spin');
    try {
      const [cols, preview] = await Promise.all([fetchColumns(boardSel.value), previewMoveCard(cardId, boardSel.value)]);
      if (my !== seq) return;
      if (!cols.length) {
        colSel.innerHTML = '<option>Sem colunas</option>';
        setSummary('triangle-alert', 'Esse board não tem colunas. Crie uma coluna nele antes de mover.', true);
        return;
      }
      colSel.innerHTML = cols.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
      colSel.disabled = false;
      const nf = preview?.fields_to_create || [];
      const nt = preview?.tags_to_create || [];
      const parts = [
        nf.length
          ? `${nf.length} ${nf.length === 1 ? 'campo será criado' : 'campos serão criados'} no board de destino: ${list(nf)}.`
          : 'Todos os campos já existem lá.',
      ];
      if (nt.length) parts.push(`${nt.length} ${nt.length === 1 ? 'tag será criada' : 'tags serão criadas'}: ${list(nt)}.`);
      setSummary(nf.length || nt.length ? 'info' : 'circle-check', parts.join(' '));
      ready = true;
      okBtn.disabled = false;
    } catch (e) {
      if (my !== seq) return;
      setSummary('circle-alert', esc(e.message || 'Não foi possível verificar o destino.'), true);
    }
  };
  boardSel.addEventListener('change', load);
  load();

  const r = await dlg.result;
  if (r !== 'ok') return;
  const boardId = boardSel.value;
  const columnId = colSel.value;
  const boardName = boards.find((b) => b.id === boardId)?.name || 'outro board';
  if (cur === ctx) closeCardModal();
  try {
    await moveCardToBoard(cardId, boardId, columnId);
    toastSuccess(`Card movido para "${boardName}".`);
  } catch (e) { toastError(e); }
}

function renderTitle(ctx) {
  const host = ctx.root.querySelector('#cmTitle');
  const card = getCard(ctx.cardId);
  host.innerHTML = '';
  const title = ctx.pending.card.title ?? card.title;
  const ta = el(`<textarea class="card-modal__title ${card.archived ? 'is-archived' : ''}" rows="1" placeholder="Título do card">${esc(title)}</textarea>`);
  ta.addEventListener('input', () => {
    autoResize(ta);
    const t = ta.value.trim();
    if (t) queueCard(ctx, { title: t }, 'Título');
  });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ta.blur(); } });
  ta.addEventListener('blur', () => { if (!ta.value.trim()) ta.value = getCard(ctx.cardId)?.title || ''; autoResize(ta); });
  host.appendChild(ta);
  requestAnimationFrame(() => autoResize(ta));
}

function renderArchived(ctx) {
  const host = ctx.root.querySelector('#cmArchived');
  const card = getCard(ctx.cardId);
  host.innerHTML = card?.archived
    ? `<div class="archived-banner">${icon('archive')} Este card está arquivado e não aparece no kanban. <button class="btn btn--sm" id="cmRestore" style="margin-left:auto">Restaurar</button></div>`
    : '';
  host.querySelector('#cmRestore')?.addEventListener('click', () => ctx.root.querySelector('#cmArchive')?.click());
  refreshIcons();
}

// ----------------------------------------------------------------------------
// Campos
// ----------------------------------------------------------------------------
function fieldSig(f) {
  return JSON.stringify([f.name, f.type, f.icon, f.required, f.show_on_card, f.is_deadline, f.options, f.statuses]);
}

function renderFieldRow(ctx, f) {
  const values = effectiveValues(ctx);
  const row = el(`<div class="field-row" data-field-id="${f.id}"></div>`);
  row.dataset.sig = fieldSig(f);
  row.innerHTML = `
    <div class="field-row__label" title="${esc(f.name)}">
      ${icon(fieldIconName(f))}
      <span>${esc(f.name)}</span>
      ${f.required ? '<span class="req">*</span>' : ''}
      <span class="field-row__actions">
        <button type="button" class="field-row__action" data-edit-field title="Editar campo">${icon('pencil')}</button>
        <button type="button" class="field-row__action field-row__action--danger" data-remove-field title="Remover deste card">${icon('trash-2')}</button>
        <span class="field-row__action field-row__grip" title="Arrastar para reordenar">${icon('grip-vertical')}</span>
      </span>
    </div>`;
  const wrap = el('<div class="field-row__control-wrap"></div>');
  const value = values[f.id];
  const hint = el(`<div class="required-hint ${f.required && isEmptyValue(value) ? '' : 'hidden'}">Campo obrigatório</div>`);
  const control = renderFieldControl(f, value, (v) => {
    queueValue(ctx, f.id, v, f.name);
    hint.classList.toggle('hidden', !(f.required && isEmptyValue(v)));
  });
  control.appendChild(hint);
  wrap.appendChild(control);
  const groups = fieldStatuses(f);
  if (groups.length) {
    const chips = el('<div class="status-chips"></div>');
    for (const g of groups) {
      chips.appendChild(renderStatusControl(f, g, values[statusKey(f.id, g.id)], (v) => {
        queueValue(ctx, statusKey(f.id, g.id), v, `${f.name} › ${g.label || 'Status'}`);
      }));
    }
    wrap.appendChild(chips);
  }
  row.appendChild(wrap);
  // com o card de contexto o editor oferece "Salvar" (só neste card) e "Salvar para todos"
  row.querySelector('[data-edit-field]').addEventListener('click', (e) => openFieldEditor(e.currentTarget, { fieldId: f.id, cardId: ctx.cardId }));
  row.querySelector('[data-remove-field]').addEventListener('click', () => askRemoveField(ctx, f));
  return row;
}

/** Remove o campo só deste card (a definição continua no board). */
async function askRemoveField(ctx, f) {
  const values = effectiveValues(ctx);
  const prefix = statusPrefixOf(f.id);
  const hasValue = !isEmptyValue(values[f.id]) || Object.keys(values).some((k) => k.startsWith(prefix) && !isEmptyValue(values[k]));
  const ok = await confirmDialog({
    title: 'Remover campo deste card',
    message: `Tirar "<b>${esc(f.name)}</b>" deste card?${hasValue ? ' O valor preenchido aqui será apagado.' : ''} O campo continua existindo no board e nos outros cards.`,
    confirmText: 'Remover',
  });
  if (!ok) return;
  // descarta digitação pendente desse campo, para o flush não recriar a chave
  delete ctx.pending.values[f.id];
  for (const k of Object.keys(ctx.pending.values)) if (k.startsWith(prefix)) delete ctx.pending.values[k];
  try {
    await removeFieldFromCard(ctx.cardId, f.id);
  } catch (e) { toastError(e); }
}

/**
 * Popover "+ Adicionar campo": campos do board que o card não tem, ou criar um
 * novo. Com forks o catálogo tem várias definições de mesmo nome, então a lista
 * é agrupada por nome + tipo: clicar na entrada adiciona a variação mais usada;
 * "N variações" expande e permite escolher uma específica. Um grupo do qual o
 * card já tem alguma variação não aparece (teria duas linhas com o mesmo nome).
 */
function openAddFieldPicker(anchor, ctx) {
  const pop = openPopover(anchor, `
    <input class="input input--sm popover__search" placeholder="Buscar campo…" autocomplete="off" />
    <div class="popover__list menu" id="afList"></div>
    <div class="menu__sep"></div>
    <button type="button" class="menu__item" id="afCreate">${icon('plus')}<span class="grow">Criar novo campo</span></button>`,
    { cls: 'popover--wide' });
  const search = pop.querySelector('input');
  const list = pop.querySelector('#afList');
  const expanded = new Set(); // grupos com as variações abertas

  const paint = () => {
    const card = getCard(ctx.cardId);
    const q = search.value.trim().toLowerCase();
    const have = new Set(card?.field_ids || []);
    const groups = groupFieldsByName(sortedFields(), (f) => fieldCardUsage(f.id))
      .filter((g) => !g.variants.some((f) => have.has(f.id)))
      .filter((g) => !q || g.name.toLowerCase().includes(q));
    list.innerHTML = groups.length
      ? groups.map((g) => {
        const multi = g.variants.length > 1;
        const open = multi && expanded.has(g.key);
        return `
          <div class="menu__group">
            <div class="menu__row">
              <button type="button" class="menu__item" data-add="${g.main.id}">
                ${icon(fieldIconName(g.main))}
                <span class="grow menu__item-text">
                  <span class="truncate">${esc(g.name)}</span>
                  ${multi ? `<span class="menu__item-sub">${g.variants.length} variações</span>` : ''}
                </span>
              </button>
              ${multi ? `<button type="button" class="btn btn--ghost btn--icon btn--sm" data-expand="${esc(g.key)}" aria-expanded="${open}" title="${open ? 'Ocultar' : 'Ver'} variações">${icon(open ? 'chevron-up' : 'chevron-down', 'ico--sm')}</button>` : ''}
            </div>
            ${open ? `<div class="menu__sub">${g.variants.map((f) => `
              <button type="button" class="menu__item menu__item--sub" data-add="${f.id}">
                ${icon(fieldIconName(f))}
                <span class="grow menu__item-text">
                  <span class="truncate">${esc(f.name)}</span>
                  <span class="menu__item-sub">${esc(fieldVariantSummary(f, fieldCardUsage(f.id)))}</span>
                </span>
              </button>`).join('')}</div>` : ''}
          </div>`;
      }).join('')
      : `<div class="popover__empty">${q ? 'Nenhum campo com esse nome.' : 'Todos os campos do board já estão neste card.'}</div>`;
    refreshIcons();
  };
  list.addEventListener('click', async (e) => {
    const ex = e.target.closest('[data-expand]');
    if (ex) {
      const k = ex.dataset.expand;
      if (expanded.has(k)) expanded.delete(k); else expanded.add(k);
      paint();
      return;
    }
    const b = e.target.closest('[data-add]');
    if (!b) return;
    closePopover(pop);
    try { await addFieldToCard(ctx.cardId, b.dataset.add); } catch (err) { toastError(err); }
  });
  pop.querySelector('#afCreate').addEventListener('click', () => {
    closePopover(pop);
    // fluxo atual de criação; o campo novo entra no field_ids DESTE card
    openFieldEditor(anchor, {
      fieldId: null,
      onSaved: (f) => { if (f && cur === ctx) addFieldToCard(ctx.cardId, f.id).catch(toastError); },
    });
  });
  search.addEventListener('input', paint);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); (list.querySelector('[data-add]') || pop.querySelector('#afCreate')).click(); }
  });
  paint();
  search.focus();
  return pop;
}

function renderFields(ctx) {
  const host = ctx.root.querySelector('#cmFields');
  try { ctx.fieldsSortable?.destroy(); } catch { /* ignore */ }
  ctx.fieldsSortable = null;
  host.innerHTML = '';
  const fields = cardFields(getCard(ctx.cardId));
  if (!fields.length) {
    host.innerHTML = emptyHtml({
      icon: 'sliders-horizontal', small: true,
      text: sortedFields().length
        ? 'Este card não tem campos. Use "Adicionar campo" para escolher entre os campos do board ou criar um novo.'
        : 'Este board ainda não tem campos personalizados. Use "Adicionar campo" para criar o primeiro.',
    });
    refreshIcons();
    return;
  }
  fields.forEach((f) => host.appendChild(renderFieldRow(ctx, f)));
  refreshIcons();
  ctx.fieldsSortable = new Sortable(host, {
    handle: '.field-row__grip', draggable: '.field-row', animation: 150, ghostClass: 'sortable-ghost',
    delay: 150, delayOnTouchOnly: true,
    onEnd: () => setTimeout(() => {
      const ids = [...host.querySelectorAll('.field-row')].map((r) => r.dataset.fieldId);
      const card = getCard(ctx.cardId);
      if (card && ids.join() !== card.field_ids.join()) {
        ctx.seenFieldIds = JSON.stringify([...ids, ...card.field_ids.filter((id) => !ids.includes(id))]);
        reorderCardFields(ctx.cardId, ids).catch((e) => { toastError(e); renderFields(ctx); });
      }
    }, 0),
  });
}

/**
 * Sincroniza as linhas com a definição atual dos campos: adiciona, remove,
 * reordena e substitui só as linhas cuja definição mudou. Uma linha com foco
 * não é substituída agora (a digitação não se perde); ela é atualizada no
 * próximo focusout.
 */
function syncFields(ctx) {
  const host = ctx.root.querySelector('#cmFields');
  if (!host) return;
  const fields = cardFields(getCard(ctx.cardId));
  const hasRows = !!host.querySelector('.field-row');
  if (!fields.length || !hasRows) { renderFields(ctx); return; }

  host.querySelectorAll('.field-row').forEach((row) => {
    if (!fields.some((f) => f.id === row.dataset.fieldId)) row.remove();
  });
  let prev = null;
  for (const f of fields) {
    let row = host.querySelector(`.field-row[data-field-id="${f.id}"]`);
    if (!row) {
      row = renderFieldRow(ctx, f);
    } else if (row.dataset.sig !== fieldSig(f) && !row.contains(document.activeElement)) {
      const fresh = renderFieldRow(ctx, f);
      row.replaceWith(fresh);
      row = fresh;
    }
    const expected = prev ? prev.nextElementSibling : host.firstElementChild;
    if (expected !== row) host.insertBefore(row, expected);
    prev = row;
  }
  refreshIcons();
}

// ----------------------------------------------------------------------------
// Observações / tags / info / atividade
// ----------------------------------------------------------------------------
function renderDesc(ctx) {
  const host = ctx.root.querySelector('#cmDesc');
  const card = getCard(ctx.cardId);
  host.innerHTML = '';
  const desc = ctx.pending.card.description !== undefined ? ctx.pending.card.description : card.description;
  const ta = el(`<textarea class="textarea input--invisible" rows="3" placeholder="Anotações sobre o cliente, contexto, próximos passos…">${esc(desc || '')}</textarea>`);
  ta.addEventListener('input', () => {
    autoResize(ta);
    queueCard(ctx, { description: ta.value.trim() ? ta.value : null }, 'Observações');
  });
  host.appendChild(ta);
  requestAnimationFrame(() => autoResize(ta));
}

function renderTags(ctx) {
  const host = ctx.root.querySelector('#cmTags');
  const card = getCard(ctx.cardId);
  if (!card) return;
  const tags = card.tag_ids.map(getTag).filter(Boolean);
  host.innerHTML = tags.map((t) => chipHtml(t.name, t.color, { removable: true, id: t.id })).join('')
    + `<button type="button" class="chip chip--btn" id="cmAddTag">${icon('plus', 'ico--sm')} Tag</button>`;
  refreshIcons();
  host.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    removeTagFromCard(card.id, b.dataset.remove).catch(toastError);
  }));
  host.querySelector('#cmAddTag').addEventListener('click', (e) => openTagPicker(e.currentTarget, ctx));
}

function openTagPicker(anchor, ctx) {
  const pop = openPopover(anchor, `
    <input class="input input--sm popover__search" placeholder="Buscar ou criar tag…" autocomplete="off" />
    <div class="menu popover__list"></div>`, { cls: 'popover--wide' });
  const search = pop.querySelector('input');
  const list = pop.querySelector('.popover__list');

  const paint = () => {
    const card = getCard(ctx.cardId);
    if (!card) return;
    const q = search.value.trim().toLowerCase();
    const tags = sortedTags().filter((t) => !q || t.name.toLowerCase().includes(q));
    const exact = sortedTags().some((t) => t.name.toLowerCase() === q);
    list.innerHTML = `
      ${tags.map((t) => `
        <button type="button" class="menu__item ${card.tag_ids.includes(t.id) ? 'is-selected' : ''}" data-tag="${t.id}">
          ${chipHtml(t.name, t.color)}${card.tag_ids.includes(t.id) ? icon('check', 'check ico--sm') : ''}
        </button>`).join('')}
      ${!tags.length && !q ? '<div class="popover__empty">Nenhuma tag ainda. Digite um nome para criar.</div>' : ''}
      ${q && !exact ? `<button type="button" class="menu__item" data-create>${icon('plus')}<span class="grow">Criar tag "${esc(search.value.trim())}"</span></button>` : ''}`;
    refreshIcons();
  };

  const showCreate = (name) => {
    let color = randomPaletteColor();
    pop.innerHTML = `
      <div class="menu__label">Nova tag</div>
      <div style="padding:4px"><input class="input input--sm" id="ntName" value="${esc(name)}" placeholder="Nome da tag" autocomplete="off" /></div>
      <div id="ntColor">${colorGridHtml(color, { custom: true })}</div>
      <div class="dialog__actions" style="padding:6px 4px 2px">
        <button type="button" class="btn btn--ghost btn--sm" id="ntCancel">Cancelar</button>
        <button type="button" class="btn btn--primary btn--sm" id="ntCreate">Criar tag</button>
      </div>`;
    refreshIcons();
    const colorHost = pop.querySelector('#ntColor');
    const wire = () => bindColorGrid(colorHost, (hex) => { color = hex; colorHost.innerHTML = colorGridHtml(hex, { custom: true }); refreshIcons(); wire(); });
    wire();
    const create = async () => {
      const nm = pop.querySelector('#ntName').value.trim();
      if (!nm) return;
      try {
        const t = await createTag(state.boardId, { name: nm, color });
        await addTagToCard(ctx.cardId, t.id);
        closePopover(pop);
      } catch (err) { toastError(err); }
    };
    pop.querySelector('#ntCreate').addEventListener('click', create);
    pop.querySelector('#ntName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
    pop.querySelector('#ntCancel').addEventListener('click', () => closePopover(pop));
    pop.querySelector('#ntName').focus();
  };

  list.addEventListener('click', async (e) => {
    if (e.target.closest('[data-create]')) { showCreate(search.value.trim()); return; }
    const b = e.target.closest('[data-tag]');
    if (!b) return;
    const card = getCard(ctx.cardId);
    const id = b.dataset.tag;
    try {
      if (card.tag_ids.includes(id)) await removeTagFromCard(card.id, id);
      else await addTagToCard(card.id, id);
    } catch (err) { toastError(err); }
    paint();
  });
  search.addEventListener('input', paint);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); list.querySelector('[data-tag], [data-create]')?.click(); }
  });
  paint();
}

function renderInfo(ctx) {
  const host = ctx.root.querySelector('#cmInfo');
  const card = getCard(ctx.cardId);
  if (!card) return;
  const creator = profileOf(card.created_by);
  host.innerHTML = `
    <div class="row">${avatarHtml(creator, 'sm')}<span>Criado por <b>${esc(creator?.name || '—')}</b></span></div>
    <div>${esc(formatDateTimeBR(card.created_at))}</div>
    <div>Atualizado ${esc(relativeTime(card.updated_at))}</div>`;
}

async function loadActivity(ctx) {
  try { ctx.activity = await fetchActivity(ctx.cardId); } catch { ctx.activity = []; }
  if (cur === ctx) renderActivity(ctx);
}

function activityText(a) {
  const who = `<b>${esc(profileOf(a.user_id)?.name || 'Alguém')}</b>`;
  const p = a.payload || {};
  switch (a.type) {
    case 'created':
      if (p.duplicated_from) return `${who} criou o card duplicando outro card`;
      if (p.duplicated_from_board) return `${who} criou o card ao duplicar o board`;
      return `${who} criou o card`;
    case 'moved':
      if (p.to_board || p.to_board_name) return `${who} moveu do board <b>${esc(p.from_board_name || '?')}</b> para <b>${esc(p.to_board_name || '?')}</b>`;
      return `${who} moveu de <b>${esc(p.from_name || getColumn(p.from)?.name || '?')}</b> para <b>${esc(p.to_name || getColumn(p.to)?.name || '?')}</b>`;
    case 'updated':
      if (p.field_forked) return `${who} alterou o campo <b>${esc(p.field_forked.name || '?')}</b> só neste card`;
      return `${who} atualizou ${(p.fields || []).map((f) => `<b>${esc(f)}</b>`).join(', ') || 'o card'}`;
    case 'comment': return `${who} comentou`;
    case 'archived': return `${who} arquivou o card`;
    case 'restored': return `${who} restaurou o card`;
    default: return `${who} — ${esc(a.type)}`;
  }
}

function renderActivity(ctx) {
  const host = ctx.root.querySelector('#cmActivity');
  const draft = host.querySelector('#cmComment')?.value || '';
  const items = ctx.activity;
  host.innerHTML = `
    <div class="activity__composer">
      ${avatarHtml(state.profile)}
      <textarea class="textarea grow" id="cmComment" rows="1" placeholder="Escreva um comentário… (Enter envia)">${esc(draft)}</textarea>
      <button type="button" class="btn btn--primary btn--icon" id="cmSend" title="Enviar">${icon('send')}</button>
    </div>
    <div class="activity__list">
      ${items === null ? `<div class="subtle">${icon('loader-circle', 'ico--sm spin')} Carregando histórico…</div>` : ''}
      ${items && !items.length ? '<div class="subtle">Nenhuma atividade ainda.</div>' : ''}
      ${(items || []).map((a) => `
        <div class="activity__item">
          ${avatarHtml(profileOf(a.user_id), 'sm')}
          <div class="grow">
            <div class="activity__text">${activityText(a)}<span class="activity__time" title="${esc(formatDateTimeBR(a.created_at))}">${esc(relativeTime(a.created_at))}</span></div>
            ${a.type === 'comment' ? `<div class="activity__comment">${esc(a.payload?.text || '')}</div>` : ''}
          </div>
        </div>`).join('')}
    </div>`;
  refreshIcons();

  const ta = host.querySelector('#cmComment');
  const send = async () => {
    const text = ta.value.trim();
    if (!text) return;
    ta.value = '';
    autoResize(ta);
    try {
      const row = await addComment(ctx.cardId, text);
      ctx.activity = [row, ...(ctx.activity || [])];
      renderActivity(ctx);
    } catch (err) { toastError(err); ta.value = text; }
  };
  ta.addEventListener('input', () => autoResize(ta));
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  host.querySelector('#cmSend').addEventListener('click', send);
}
