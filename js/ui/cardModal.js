// Modal do card: título, coluna, tags, campos, observações, atividade.
// Salvamento automático com debounce de 500ms e flush ao perder o foco.
import { icon, refreshIcons } from './icons.js';
import { esc, el, debounce, autoResize, relativeTime, formatDateTimeBR, randomPaletteColor, isTyping } from '../utils.js';
import { state, on, getCard, getColumn, getTag, profileOf, sortedColumns, sortedFields, sortedTags, cardsInColumn } from '../state.js';
import { updateCard, patchValues, moveCard, deleteCard, archiveCard, fetchActivity, addComment, logUpdated } from '../cards.js';
import { addTagToCard, removeTagFromCard, createTag } from '../tags.js';
import { isEmptyValue } from '../fields.js';
import { renderFieldControl, fieldIcon } from './fieldInputs.js';
import { chipHtml, avatarHtml, emptyHtml } from './common.js';
import { openMenu, openPopover, closePopover, confirmDialog, pushClosable, removeClosable } from './dialog.js';
import { colorGridHtml, bindColorGrid } from './colorPicker.js';
import { toast, toastError, toastSuccess } from './toast.js';
import { openBoardSettings } from './boardSettings.js';

let cur = null;

export function isCardModalOpen() { return !!cur; }
export function currentCardId() { return cur?.cardId || null; }

export function openCardModal(cardId) {
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
    stale: false,
    offs: [],
    activity: null,
  };
  ctx.save = debounce(() => flush(ctx), 500);
  ctx.onEsc = () => closeCardModal();
  cur = ctx;
  pushClosable(ctx.onEsc);

  root.addEventListener('mousedown', (e) => { if (e.target === root) ctx.backdropDown = true; });
  root.addEventListener('mouseup', (e) => { if (e.target === root && ctx.backdropDown) closeCardModal(); ctx.backdropDown = false; });
  // ao sair de qualquer campo, salva na hora
  root.addEventListener('focusout', () => {
    ctx.save.cancel();
    flush(ctx);
    if (ctx.stale && !ctx.saving) setTimeout(() => { if (cur === ctx && !(root.contains(document.activeElement) && isTyping())) refreshEditable(ctx); }, 50);
  });

  ctx.offs.push(on('cards', () => onCardsEvent(ctx)));
  // Mudanças só nas opções (ex.: criar opção pelo seletor) não re-renderizam:
  // os controles leem getField() ao vivo. Só estrutura (campo novo, tipo,
  // nome, ordem…) exige re-render.
  ctx.fieldsSig = fieldsSignature();
  ctx.offs.push(on('fields', () => {
    const sig = fieldsSignature();
    if (sig === ctx.fieldsSig) return;
    ctx.fieldsSig = sig;
    if ((root.contains(document.activeElement) && isTyping()) || hasPending(ctx) || ctx.saving) ctx.stale = true;
    else renderFields(ctx);
  }));
  ctx.offs.push(on('tags', () => renderTags(ctx)));
  ctx.offs.push(on('columns', () => { renderHead(ctx); renderInfo(ctx); }));
  ctx.offs.push(on('profiles', () => { renderInfo(ctx); renderActivity(ctx); }));

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
}

export function closeCardModal() {
  if (!cur) return;
  const ctx = cur;
  cur = null;
  ctx.save.cancel();
  flush(ctx);
  ctx.offs.forEach((off) => off());
  removeClosable(ctx.onEsc);
  closePopover();
  ctx.root.remove();
}

// ----------------------------------------------------------------------------
// Autosave
// ----------------------------------------------------------------------------
function queueCard(ctx, patch, name) {
  Object.assign(ctx.pending.card, patch);
  ctx.pending.names.add(name);
  setStatus(ctx, 'dirty');
  ctx.save();
}
function queueValue(ctx, fieldId, value, name) {
  ctx.pending.values[fieldId] = value;
  ctx.pending.names.add(name);
  setStatus(ctx, 'dirty');
  ctx.save();
}
function hasPending(ctx) {
  return Object.keys(ctx.pending.card).length > 0 || Object.keys(ctx.pending.values).length > 0;
}

function fieldsSignature() {
  return sortedFields().map((f) => [f.id, f.name, f.type, f.required, f.show_on_card, f.position].join('|')).join(';');
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
    if (cur === ctx && ctx.stale && !ctx.saving && !hasPending(ctx) && !(ctx.root.contains(document.activeElement) && isTyping())) {
      refreshEditable(ctx);
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
  else if (status === 'dirty') elx.innerHTML = '';
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
    closeCardModal();
    toast('Este card foi excluído.', { type: 'info' });
    return;
  }
  renderHead(ctx);
  renderInfo(ctx);
  const tagsSig = JSON.stringify(card.tag_ids);
  if (tagsSig !== ctx.seenTags) { ctx.seenTags = tagsSig; renderTags(ctx); }
  if (card.updated_at !== ctx.seenUpdatedAt) {
    if (ctx.saving) { ctx.seenUpdatedAt = card.updated_at; return; } // mudança nossa
    if ((ctx.root.contains(document.activeElement) && isTyping()) || hasPending(ctx)) { ctx.stale = true; return; }
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
// Seções
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

function renderTitle(ctx) {
  const host = ctx.root.querySelector('#cmTitle');
  const card = getCard(ctx.cardId);
  host.innerHTML = '';
  const ta = el(`<textarea class="card-modal__title ${card.archived ? 'is-archived' : ''}" rows="1" placeholder="Título do card">${esc(card.title)}</textarea>`);
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

function renderFields(ctx) {
  const host = ctx.root.querySelector('#cmFields');
  const card = getCard(ctx.cardId);
  const fields = sortedFields();
  host.innerHTML = '';
  if (!fields.length) {
    host.innerHTML = emptyHtml({
      icon: 'sliders-horizontal', small: true,
      text: 'Este board ainda não tem campos personalizados.',
      action: `<button type="button" class="btn btn--sm" id="cmGoFields">${icon('settings-2', 'ico--sm')} Configurar campos</button>`,
    });
    host.querySelector('#cmGoFields').addEventListener('click', () => { closeCardModal(); openBoardSettings('fields'); });
    refreshIcons();
    return;
  }
  for (const f of fields) {
    const value = card.values?.[f.id];
    const row = el(`<div class="field-row">
      <div class="field-row__label" title="${esc(f.name)}">${icon(fieldIcon(f.type))}<span>${esc(f.name)}</span>${f.required ? '<span class="req">*</span>' : ''}</div>
    </div>`);
    const hint = el(`<div class="required-hint ${f.required && isEmptyValue(value) ? '' : 'hidden'}">Campo obrigatório</div>`);
    const control = renderFieldControl(f, value, (v) => {
      queueValue(ctx, f.id, v, f.name);
      hint.classList.toggle('hidden', !(f.required && isEmptyValue(v)));
    });
    control.appendChild(hint);
    row.appendChild(control);
    host.appendChild(row);
  }
  refreshIcons();
}

function renderDesc(ctx) {
  const host = ctx.root.querySelector('#cmDesc');
  const card = getCard(ctx.cardId);
  host.innerHTML = '';
  const ta = el(`<textarea class="textarea input--invisible" rows="3" placeholder="Anotações sobre o cliente, contexto, próximos passos…">${esc(card.description || '')}</textarea>`);
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
        closePopover();
      } catch (err) { toastError(err); }
    };
    pop.querySelector('#ntCreate').addEventListener('click', create);
    pop.querySelector('#ntName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
    pop.querySelector('#ntCancel').addEventListener('click', closePopover);
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
    case 'created': return `${who} criou o card`;
    case 'moved': return `${who} moveu de <b>${esc(p.from_name || getColumn(p.from)?.name || '?')}</b> para <b>${esc(p.to_name || getColumn(p.to)?.name || '?')}</b>`;
    case 'updated': return `${who} atualizou ${(p.fields || []).map((f) => `<b>${esc(f)}</b>`).join(', ') || 'o card'}`;
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
