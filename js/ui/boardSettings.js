// Painel lateral "Configurar board": Colunas / Campos / Tags / Board
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/modular/sortable.esm.js';
import { icon, refreshIcons, fieldIconName } from './icons.js';
import { esc, el, randomPaletteColor, isTyping, relativeTime } from '../utils.js';
import { state, on, getBoard, getColumn, getField, getTag, sortedColumns, sortedFields, sortedTags } from '../state.js';
import { updateBoard, deleteBoard } from '../boards.js';
import { createColumn, updateColumn, deleteColumn, reorderColumns } from '../columns.js';
import { fieldTypeInfo, deleteField, reorderFields, fieldUsage, updateField } from '../fields.js';
import { createTag, updateTag, deleteTag, tagUsage } from '../tags.js';
import { archiveCard, deleteCard, fieldCardUsage } from '../cards.js';
import { chipHtml, emptyHtml, toggleHtml } from './common.js';
import { colorGridHtml, bindColorGrid, openColorPopover } from './colorPicker.js';
import { openIconPicker } from './iconPicker.js';
import { openFieldEditor } from './fieldEditor.js';
import { openDialog, confirmDialog, pushClosable, removeClosable, closeAllPopovers } from './dialog.js';
import { toast, toastError, toastSuccess } from './toast.js';

let ctx = null;
let sortables = [];

const TABS = [
  { id: 'columns', label: 'Colunas', icon: 'columns-3' },
  { id: 'fields', label: 'Campos', icon: 'sliders-horizontal' },
  { id: 'tags', label: 'Tags', icon: 'tag' },
  { id: 'board', label: 'Board', icon: 'layout-grid' },
];

export function isBoardSettingsOpen() { return !!ctx; }

export function openBoardSettings(tab = 'columns') {
  if (!getBoard()) return;
  if (ctx) { ctx.tab = tab; renderTabs(); renderBody(); return; }

  const root = el(`
    <div>
      <div class="settings-backdrop" id="setBackdrop"></div>
      <aside class="settings" role="dialog" aria-label="Configurar board">
        <div class="settings__head">
          <h2>Configurar board</h2>
          <button type="button" class="btn btn--ghost btn--icon" id="setClose" title="Fechar (Esc)">${icon('x')}</button>
        </div>
        <div class="tabs" id="setTabs"></div>
        <div class="settings__body" id="setBody"></div>
      </aside>
    </div>`);
  document.getElementById('layers').appendChild(root);

  ctx = {
    root, tab, stale: false, offs: [], timer: null,
    newColColor: randomPaletteColor(), newTagColor: randomPaletteColor(),
  };
  ctx.onEsc = () => closeBoardSettings();
  pushClosable(ctx.onEsc);
  root.querySelector('#setBackdrop').addEventListener('click', closeBoardSettings);
  root.querySelector('#setClose').addEventListener('click', closeBoardSettings);
  root.addEventListener('focusout', () => {
    if (ctx?.stale) setTimeout(() => { if (ctx?.stale && !typingInside()) renderBody(); }, 60);
  });

  ['columns', 'fields', 'tags', 'cards', 'boards'].forEach((ev) => ctx.offs.push(on(ev, scheduleRender)));
  ctx.offs.push(on('board', () => { if (!state.boardId) closeBoardSettings(); else scheduleRender(); }));

  renderTabs();
  renderBody();
}

export function closeBoardSettings() {
  if (!ctx) return;
  const c = ctx;
  ctx = null;
  c.offs.forEach((off) => off());
  removeClosable(c.onEsc);
  closeAllPopovers();
  destroySortables();
  c.root.remove();
}

function typingInside() {
  return !!ctx && ctx.root.contains(document.activeElement) && isTyping();
}

function scheduleRender() {
  if (!ctx) return;
  clearTimeout(ctx.timer);
  ctx.timer = setTimeout(() => {
    if (!ctx) return;
    if (typingInside()) { ctx.stale = true; return; }
    renderBody();
  }, 30);
}

function destroySortables() {
  sortables.forEach((s) => { try { s.destroy(); } catch { /* ignore */ } });
  sortables = [];
}

function renderTabs() {
  const host = ctx.root.querySelector('#setTabs');
  host.innerHTML = TABS.map((t) => `<button type="button" class="tab ${t.id === ctx.tab ? 'is-active' : ''}" data-tab="${t.id}">${icon(t.icon, 'ico--sm')} ${t.label}</button>`).join('');
  refreshIcons();
  host.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    ctx.tab = b.dataset.tab;
    renderTabs();
    renderBody();
  }));
}

function renderBody() {
  if (!ctx) return;
  ctx.stale = false;
  destroySortables();
  const body = ctx.root.querySelector('#setBody');
  const scroll = body.scrollTop;
  switch (ctx.tab) {
    case 'columns': renderColumns(body); break;
    case 'fields': renderFields(body); break;
    case 'tags': renderTags(body); break;
    case 'board': renderBoardTab(body); break;
  }
  refreshIcons();
  body.scrollTop = scroll;
}

// ============================================================================
// COLUNAS
// ============================================================================
function renderColumns(body) {
  const cols = sortedColumns();
  body.innerHTML = `
    ${cols.length ? `<div class="settings-list" id="setColumns">
      ${cols.map((c) => {
        const n = state.cards.filter((x) => x.column_id === c.id && !x.archived).length;
        return `
        <div class="settings-row" data-id="${c.id}">
          <span class="handle" title="Arrastar para reordenar">${icon('grip-vertical')}</span>
          <button type="button" class="color-btn color-btn--sm" data-color="${c.id}" style="--c:${esc(c.color)}" title="Cor"></button>
          <input class="input input--invisible" value="${esc(c.name)}" data-name="${c.id}" aria-label="Nome da coluna" />
          <input class="input input--sm settings-row__wip" type="number" min="0" placeholder="WIP" value="${c.wip_limit ?? ''}" data-wip="${c.id}" title="Limite de cards (WIP). Vazio = sem limite" />
          <span class="settings-row__meta">${n} ${n === 1 ? 'card' : 'cards'}</span>
          <button type="button" class="btn btn--ghost btn--icon btn--sm" data-del="${c.id}" title="Excluir coluna">${icon('trash-2')}</button>
        </div>`;
      }).join('')}
    </div>` : emptyHtml({ icon: 'columns-3', title: 'Nenhuma coluna', text: 'Crie a primeira coluna abaixo.' })}
    <div class="row">
      <button type="button" class="color-btn" id="newColColor" style="--c:${esc(ctx.newColColor)}" title="Cor da nova coluna"></button>
      <input class="input grow" id="newColName" placeholder="Nome da nova coluna" autocomplete="off" />
      <button type="button" class="btn btn--primary" id="newColBtn">${icon('plus')} Adicionar</button>
    </div>
    <p class="hint">Arraste pelo ícone para reordenar. O limite WIP só mostra um aviso ao ser ultrapassado; não bloqueia.</p>`;

  const list = body.querySelector('#setColumns');
  if (list) {
    sortables.push(new Sortable(list, {
      handle: '.handle', draggable: '.settings-row', animation: 150, ghostClass: 'sortable-ghost',
      onEnd: () => setTimeout(() => {
        const ids = [...list.querySelectorAll('.settings-row')].map((r) => r.dataset.id);
        if (ids.join() !== sortedColumns().map((c) => c.id).join()) reorderColumns(ids).catch((e) => { toastError(e); renderBody(); });
      }, 0),
    }));
  }

  body.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
    openColorPopover(b, getColumn(b.dataset.color)?.color, (hex) => updateColumn(b.dataset.color, { color: hex }).catch(toastError));
  }));
  body.querySelectorAll('[data-name]').forEach((inp) => {
    const save = () => {
      const col = getColumn(inp.dataset.name);
      const name = inp.value.trim();
      if (!col) return;
      if (!name) { inp.value = col.name; return; }
      if (name !== col.name) updateColumn(col.id, { name }).catch(toastError);
    };
    inp.addEventListener('change', save);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
  });
  body.querySelectorAll('[data-wip]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const v = inp.value.trim() === '' ? null : Math.max(0, parseInt(inp.value, 10) || 0);
      updateColumn(inp.dataset.wip, { wip_limit: v }).catch(toastError);
    });
  });
  body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => askDeleteColumn(b.dataset.del)));

  const colorBtn = body.querySelector('#newColColor');
  colorBtn.addEventListener('click', () => openColorPopover(colorBtn, ctx.newColColor, (hex) => { ctx.newColColor = hex; colorBtn.style.setProperty('--c', hex); }));
  const nameInp = body.querySelector('#newColName');
  const create = async () => {
    const name = nameInp.value.trim();
    if (!name) { nameInp.focus(); return; }
    try {
      await createColumn(state.boardId, { name, color: ctx.newColColor });
      ctx.newColColor = randomPaletteColor();
      renderBody();
      ctx.root.querySelector('#newColName')?.focus();
    } catch (e) { toastError(e); }
  };
  body.querySelector('#newColBtn').addEventListener('click', create);
  nameInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
}

async function askDeleteColumn(colId) {
  const col = getColumn(colId);
  if (!col) return;
  const cards = state.cards.filter((c) => c.column_id === colId);
  const others = sortedColumns().filter((c) => c.id !== colId);
  try {
    if (!cards.length) {
      const ok = await confirmDialog({ title: 'Excluir coluna', message: `Excluir a coluna "<b>${esc(col.name)}</b>"?`, confirmText: 'Excluir' });
      if (ok) await deleteColumn(colId);
      return;
    }
    if (!others.length) {
      toast('Esta é a única coluna e tem cards. Crie outra coluna para mover os cards antes.', { type: 'warning' });
      return;
    }
    const dlg = openDialog({
      title: 'Excluir coluna', danger: true,
      body: `
        <p>A coluna "<b>${esc(col.name)}</b>" tem <b>${cards.length} ${cards.length === 1 ? 'card' : 'cards'}</b>. Para onde mover?</p>
        <div class="form-field"><label>Mover cards para</label>
          <select class="select" id="delColTarget">${others.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        </div>`,
      actions: [{ label: 'Cancelar', cls: 'btn--ghost', value: null }, { label: 'Mover e excluir', cls: 'btn--danger', value: 'ok' }],
    });
    if ((await dlg.result) !== 'ok') return;
    await deleteColumn(colId, dlg.root.querySelector('#delColTarget').value);
    toastSuccess('Coluna excluída e cards movidos.');
  } catch (e) { toastError(e); }
}

// ============================================================================
// CAMPOS — a edição em si acontece no popover compartilhado (fieldEditor.js)
// ============================================================================
function renderFields(body) {
  const fields = sortedFields();
  body.innerHTML = `
    ${fields.length ? `<div class="settings-list" id="setFields">
      ${fields.map((f) => {
        const t = fieldTypeInfo(f.type);
        const usage = fieldUsage(f.id);
        const inCards = fieldCardUsage(f.id);
        const nOpts = (f.options || []).length;
        const nStatus = (f.status_options || []).length;
        return `
        <div class="settings-row settings-row--col" data-id="${f.id}">
          <div class="settings-row__main">
            <span class="handle" title="Arrastar para reordenar">${icon('grip-vertical')}</span>
            ${icon(fieldIconName(f))}
            <span class="settings-row__name">${esc(f.name)}</span>
            <span class="settings-row__icons">
              <button type="button" class="btn btn--ghost btn--icon btn--sm" data-edit="${f.id}" title="Editar">${icon('pencil')}</button>
              <button type="button" class="btn btn--ghost btn--icon btn--sm" data-del="${f.id}" title="Excluir do board">${icon('trash-2')}</button>
            </span>
          </div>
          <div class="settings-row__sub">
            <span>${t.label}</span>
            ${f.show_on_card ? chipHtml('No card', '#6366f1') : ''}
            ${f.required ? chipHtml('Obrigatório', '#ef4444') : ''}
            ${f.status_enabled ? chipHtml(`${f.status_label || 'Status'} · ${nStatus} ${nStatus === 1 ? 'opção' : 'opções'}`, '#06b6d4') : ''}
            ${(f.type === 'select' || f.type === 'multiselect') ? `<span>· ${nOpts} ${nOpts === 1 ? 'opção' : 'opções'}</span>` : ''}
            <span>· em ${inCards} ${inCards === 1 ? 'card' : 'cards'}</span>
            ${usage ? `<span>· com valor em ${usage}</span>` : ''}
          </div>
          <div class="settings-row__sub">
            ${toggleHtml({ id: `fdef-${f.id}`, label: 'Padrão em novos cards', checked: f.default_on_new_cards !== false })}
          </div>
        </div>`;
      }).join('')}
    </div>` : emptyHtml({
      icon: 'sliders-horizontal', title: 'Nenhum campo personalizado',
      text: 'Campos aparecem no modal de cada card. Ex.: Telefone, Empresa, Valor, Próximo contato.',
    })}
    <div><button type="button" class="btn" id="newFieldBtn">${icon('plus')} Novo campo</button></div>
    <p class="hint">Cada card tem seus próprios campos: aqui fica o catálogo do board. "Padrão em novos cards" define quais entram automaticamente ao criar um card. A ordem aqui é a ordem padrão; cada card pode reordenar os seus. Excluir aqui remove o campo de todos os cards.</p>`;

  const list = body.querySelector('#setFields');
  if (list) {
    sortables.push(new Sortable(list, {
      handle: '.handle', draggable: '.settings-row', animation: 150, ghostClass: 'sortable-ghost',
      onEnd: () => setTimeout(() => {
        const ids = [...list.querySelectorAll('.settings-row[data-id]')].map((r) => r.dataset.id);
        if (ids.join() !== sortedFields().map((f) => f.id).join()) reorderFields(ids).catch((e) => { toastError(e); renderBody(); });
      }, 0),
    }));
  }
  body.querySelector('#newFieldBtn').addEventListener('click', (e) => openFieldEditor(e.currentTarget, { fieldId: null }));
  body.querySelectorAll('[id^="fdef-"]').forEach((inp) => inp.addEventListener('change', () => {
    const id = inp.id.slice(5);
    updateField(id, { default_on_new_cards: inp.checked }).catch((e) => { toastError(e); inp.checked = !inp.checked; });
  }));
  body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openFieldEditor(b, { fieldId: b.dataset.edit })));
  body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const f = getField(b.dataset.del);
    if (!f) return;
    const usage = fieldUsage(f.id);
    const inCards = fieldCardUsage(f.id);
    const ok = await confirmDialog({
      title: 'Excluir campo do board',
      message: `Excluir o campo "<b>${esc(f.name)}</b>" do board?${inCards ? ` Ele está em uso em <b>${inCards} ${inCards === 1 ? 'card' : 'cards'}</b>` : ' Nenhum card usa esse campo'}${usage ? ` e tem valor preenchido em ${usage} ${usage === 1 ? 'card' : 'cards'}, que será apagado.` : '.'}`,
      confirmText: 'Excluir do board',
    });
    if (!ok) return;
    try { await deleteField(f.id); toastSuccess('Campo excluído.'); } catch (e) { toastError(e); }
  }));
}

// ============================================================================
// TAGS
// ============================================================================
function renderTags(body) {
  const tags = sortedTags();
  body.innerHTML = `
    ${tags.length ? `<div class="settings-list">
      ${tags.map((t) => {
        const n = tagUsage(t.id);
        return `
        <div class="settings-row" data-id="${t.id}">
          <button type="button" class="color-btn color-btn--sm" data-color="${t.id}" style="--c:${esc(t.color)}" title="Cor"></button>
          <input class="input input--invisible" value="${esc(t.name)}" data-name="${t.id}" aria-label="Nome da tag" />
          ${chipHtml(t.name, t.color, { small: true })}
          <span class="settings-row__meta">${n} ${n === 1 ? 'card' : 'cards'}</span>
          <button type="button" class="btn btn--ghost btn--icon btn--sm" data-del="${t.id}" title="Excluir tag">${icon('trash-2')}</button>
        </div>`;
      }).join('')}
    </div>` : emptyHtml({ icon: 'tag', title: 'Nenhuma tag', text: 'Tags ajudam a marcar e filtrar cards (ex.: Urgente, Indicação, VIP).' })}
    <div class="row">
      <button type="button" class="color-btn" id="newTagColor" style="--c:${esc(ctx.newTagColor)}" title="Cor da nova tag"></button>
      <input class="input grow" id="newTagName" placeholder="Nome da nova tag" autocomplete="off" />
      <button type="button" class="btn btn--primary" id="newTagBtn">${icon('plus')} Adicionar</button>
    </div>`;

  body.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
    openColorPopover(b, getTag(b.dataset.color)?.color, (hex) => updateTag(b.dataset.color, { color: hex }).catch(toastError));
  }));
  body.querySelectorAll('[data-name]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const t = getTag(inp.dataset.name);
      const name = inp.value.trim();
      if (!t) return;
      if (!name) { inp.value = t.name; return; }
      if (name !== t.name) updateTag(t.id, { name }).catch(toastError);
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
  });
  body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const t = getTag(b.dataset.del);
    if (!t) return;
    const n = tagUsage(t.id);
    const ok = await confirmDialog({
      title: 'Excluir tag',
      message: `Excluir a tag "<b>${esc(t.name)}</b>"?${n ? ` Ela será removida de <b>${n} ${n === 1 ? 'card' : 'cards'}</b>.` : ''}`,
      confirmText: 'Excluir',
    });
    if (!ok) return;
    try { await deleteTag(t.id); } catch (e) { toastError(e); }
  }));

  const colorBtn = body.querySelector('#newTagColor');
  colorBtn.addEventListener('click', () => openColorPopover(colorBtn, ctx.newTagColor, (hex) => { ctx.newTagColor = hex; colorBtn.style.setProperty('--c', hex); }));
  const nameInp = body.querySelector('#newTagName');
  const create = async () => {
    const name = nameInp.value.trim();
    if (!name) { nameInp.focus(); return; }
    try {
      await createTag(state.boardId, { name, color: ctx.newTagColor });
      ctx.newTagColor = randomPaletteColor();
      renderBody();
      ctx.root.querySelector('#newTagName')?.focus();
    } catch (e) { toastError(e); }
  };
  body.querySelector('#newTagBtn').addEventListener('click', create);
  nameInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
}

// ============================================================================
// BOARD
// ============================================================================
function renderBoardTab(body) {
  const board = getBoard();
  if (!board) return;
  const archived = state.cards.filter((c) => c.archived).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  const boardIcon = board.icon || 'kanban';
  body.innerHTML = `
    <div class="form-field">
      <label>Nome do board</label>
      <input class="input" id="bName" value="${esc(board.name)}" autocomplete="off" />
    </div>
    <div class="form-field">
      <label>Cor</label>
      <div id="bColor">${colorGridHtml(board.color)}</div>
    </div>
    <div class="form-field">
      <label>Ícone</label>
      <div><button type="button" class="btn icon-btn" id="bIcon">${icon(boardIcon)}<span>${esc(boardIcon)}</span>${icon('chevron-down', 'ico--sm')}</button></div>
    </div>
    <div class="section">
      <div class="section__title">${icon('archive')} Cards arquivados (${archived.length})</div>
      ${archived.length ? `<div class="settings-list">${archived.map((c) => `
        <div class="archived-row" data-id="${c.id}">
          <span class="archived-row__title" title="${esc(c.title)}">${esc(c.title)}</span>
          <span class="settings-row__meta">${esc(relativeTime(c.updated_at))}</span>
          <button type="button" class="btn btn--sm" data-restore="${c.id}">${icon('archive-restore', 'ico--sm')} Restaurar</button>
          <button type="button" class="btn btn--ghost btn--icon btn--sm" data-delcard="${c.id}" title="Excluir definitivamente">${icon('trash-2')}</button>
        </div>`).join('')}</div>`
      : '<p class="hint">Nenhum card arquivado. Cards arquivados saem do kanban mas podem ser restaurados aqui.</p>'}
    </div>
    <div class="danger-zone">
      <h4>Zona de perigo</h4>
      <p class="muted">Excluir o board apaga colunas, campos, tags e todos os ${state.cards.length} cards. Não dá para desfazer.</p>
      <div><button type="button" class="btn btn--danger" id="bDelete">${icon('trash-2')} Excluir board</button></div>
    </div>`;

  const nameInp = body.querySelector('#bName');
  const saveName = () => {
    const name = nameInp.value.trim();
    const b = getBoard();
    if (!b) return;
    if (!name) { nameInp.value = b.name; return; }
    if (name !== b.name) updateBoard(b.id, { name }).catch(toastError);
  };
  nameInp.addEventListener('change', saveName);
  nameInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameInp.blur(); } });

  const colorHost = body.querySelector('#bColor');
  const wireColor = () => bindColorGrid(colorHost, (hex) => {
    updateBoard(board.id, { color: hex }).catch(toastError);
    colorHost.innerHTML = colorGridHtml(hex);
    refreshIcons();
    wireColor();
  });
  wireColor();
  body.querySelector('#bIcon').addEventListener('click', (e) => {
    openIconPicker(e.currentTarget, getBoard()?.icon || 'kanban', (name) => {
      updateBoard(board.id, { icon: name }).catch(toastError);
    }, { allowDefault: false });
  });

  body.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
    try { await archiveCard(b.dataset.restore, false); toastSuccess('Card restaurado.'); } catch (e) { toastError(e); }
  }));
  body.querySelectorAll('[data-delcard]').forEach((b) => b.addEventListener('click', async () => {
    const c = state.cards.find((x) => x.id === b.dataset.delcard);
    const ok = await confirmDialog({ title: 'Excluir card', message: `Excluir definitivamente "<b>${esc(c?.title || '')}</b>"?`, confirmText: 'Excluir' });
    if (!ok) return;
    try { await deleteCard(b.dataset.delcard); } catch (e) { toastError(e); }
  }));

  body.querySelector('#bDelete').addEventListener('click', async () => {
    const b = getBoard();
    const ok = await confirmDialog({
      title: 'Excluir board',
      message: `Isso apaga o board "<b>${esc(b.name)}</b>" com todas as colunas, campos, tags e cards.`,
      confirmText: 'Excluir board',
      requireText: b.name,
    });
    if (!ok) return;
    try {
      closeBoardSettings();
      await deleteBoard(b.id);
      toastSuccess('Board excluído.');
    } catch (e) { toastError(e); }
  });
}
