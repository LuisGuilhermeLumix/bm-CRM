// Painel lateral "Configurar board": Colunas / Campos / Tags / Board
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/modular/sortable.esm.js';
import { icon, refreshIcons } from './icons.js';
import { esc, el, uid, randomPaletteColor, isTyping, relativeTime } from '../utils.js';
import { state, on, getBoard, getColumn, getField, getTag, sortedColumns, sortedFields, sortedTags } from '../state.js';
import { updateBoard, deleteBoard } from '../boards.js';
import { createColumn, updateColumn, deleteColumn, reorderColumns } from '../columns.js';
import {
  FIELD_TYPES, fieldTypeInfo, createField, updateField, deleteField, reorderFields, fieldUsage, optionUsage, purgeOptionValues,
} from '../fields.js';
import { createTag, updateTag, deleteTag, tagUsage } from '../tags.js';
import { archiveCard, deleteCard } from '../cards.js';
import { chipHtml, emptyHtml, toggleHtml } from './common.js';
import { colorGridHtml, bindColorGrid, openColorPopover } from './colorPicker.js';
import { iconGridHtml, bindIconGrid } from './boardForm.js';
import { openDialog, confirmDialog, pushClosable, removeClosable } from './dialog.js';
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
  if (ctx) { ctx.tab = tab; ctx.fieldForm = null; renderTabs(); renderBody(); return; }

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
    root, tab, fieldForm: null, stale: false, offs: [], timer: null,
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
    ctx.fieldForm = null;
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
// CAMPOS
// ============================================================================
function renderFields(body) {
  const fields = sortedFields();
  const form = ctx.fieldForm;
  body.innerHTML = `
    ${fields.length ? `<div class="settings-list" id="setFields">
      ${fields.map((f) => {
        const t = fieldTypeInfo(f.type);
        const usage = fieldUsage(f.id);
        const editing = form && form.fieldId === f.id;
        return `
        <div class="settings-row settings-row--col" data-id="${f.id}">
          <div class="settings-row__main">
            <span class="handle" title="Arrastar para reordenar">${icon('grip-vertical')}</span>
            ${icon(t.icon)}
            <span class="settings-row__name">${esc(f.name)}</span>
            <span class="settings-row__icons">
              <button type="button" class="btn btn--ghost btn--icon btn--sm" data-edit="${f.id}" title="Editar">${icon('pencil')}</button>
              <button type="button" class="btn btn--ghost btn--icon btn--sm" data-del="${f.id}" title="Excluir">${icon('trash-2')}</button>
            </span>
          </div>
          <div class="settings-row__sub">
            <span>${t.label}</span>
            ${f.show_on_card ? chipHtml('No card', '#6366f1') : ''}
            ${f.required ? chipHtml('Obrigatório', '#ef4444') : ''}
            ${(f.type === 'select' || f.type === 'multiselect') ? `<span>· ${(f.options || []).length} ${(f.options || []).length === 1 ? 'opção' : 'opções'}</span>` : ''}
            ${usage ? `<span>· com valor em ${usage} ${usage === 1 ? 'card' : 'cards'}</span>` : ''}
          </div>
          ${editing ? `<div style="width:100%;padding-top:6px">${fieldFormHtml()}</div>` : ''}
        </div>`;
      }).join('')}
    </div>` : (form ? '' : emptyHtml({
      icon: 'sliders-horizontal', title: 'Nenhum campo personalizado',
      text: 'Campos aparecem no modal de cada card. Ex.: Telefone, Empresa, Valor, Próximo contato.',
    }))}
    ${form && !form.fieldId ? fieldFormHtml() : `<button type="button" class="btn" id="newFieldBtn">${icon('plus')} Novo campo</button>`}
    <p class="hint">Marque "Mostrar no card" para o valor aparecer resumido no kanban. Arraste pelo ícone para mudar a ordem no modal.</p>`;

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
  body.querySelector('#newFieldBtn')?.addEventListener('click', () => openFieldForm(null));
  body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openFieldForm(b.dataset.edit)));
  body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const f = getField(b.dataset.del);
    if (!f) return;
    const usage = fieldUsage(f.id);
    const ok = await confirmDialog({
      title: 'Excluir campo',
      message: `Excluir o campo "<b>${esc(f.name)}</b>"?${usage ? ` O valor preenchido em <b>${usage} ${usage === 1 ? 'card' : 'cards'}</b> será apagado.` : ''}`,
      confirmText: 'Excluir',
    });
    if (!ok) return;
    try { await deleteField(f.id); toastSuccess('Campo excluído.'); } catch (e) { toastError(e); }
  }));
  if (form) bindFieldForm(body);
}

function openFieldForm(fieldId) {
  const f = fieldId ? getField(fieldId) : null;
  ctx.fieldForm = {
    fieldId,
    draft: f
      ? { name: f.name, type: f.type, show_on_card: f.show_on_card, required: f.required, options: (f.options || []).map((o) => ({ ...o })) }
      : { name: '', type: 'text', show_on_card: true, required: false, options: [] },
  };
  renderBody();
  setTimeout(() => ctx?.root.querySelector('#ffName')?.focus(), 30);
}

function fieldFormHtml() {
  const { fieldId, draft: d } = ctx.fieldForm;
  const usage = fieldId ? fieldUsage(fieldId) : 0;
  const locked = usage > 0; // campo com valores não muda de tipo
  const isSel = d.type === 'select' || d.type === 'multiselect';
  return `
  <div class="field-form" id="fieldForm">
    <div class="field-form__title">${icon(fieldId ? 'pencil' : 'plus')} ${fieldId ? 'Editar campo' : 'Novo campo'}</div>
    <div class="form-row">
      <div class="form-field"><label>Nome</label><input class="input" id="ffName" value="${esc(d.name)}" placeholder="Ex.: Telefone" autocomplete="off" /></div>
      <div class="form-field"><label>Tipo</label>
        <select class="select" id="ffType" ${locked ? 'disabled' : ''}>
          ${FIELD_TYPES.map((t) => `<option value="${t.value}" ${t.value === d.type ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select>
      </div>
    </div>
    ${locked ? `<div class="info-box info-box--warn">${icon('info')}<span>Este campo já tem valor em ${usage} ${usage === 1 ? 'card' : 'cards'}, por isso o tipo não pode ser alterado (os valores ficariam inconsistentes). Se precisar de outro tipo, crie um campo novo.</span></div>` : ''}
    <div class="row" style="gap:20px;flex-wrap:wrap">
      ${toggleHtml({ id: 'ffShow', label: 'Mostrar no card', checked: d.show_on_card })}
      ${toggleHtml({ id: 'ffReq', label: 'Obrigatório', checked: d.required })}
    </div>
    ${isSel ? `
      <div class="form-field">
        <label>Opções</label>
        <div class="options-editor" id="ffOptions">
          ${d.options.map((o) => `
            <div class="option-row" data-opt-id="${esc(o.id)}">
              <span class="handle">${icon('grip-vertical')}</span>
              <button type="button" class="color-btn color-btn--sm" data-opt-color="${esc(o.id)}" style="--c:${esc(o.color)}" title="Cor"></button>
              <input class="input input--sm" value="${esc(o.label)}" placeholder="Nome da opção" autocomplete="off" />
              <button type="button" class="btn btn--ghost btn--icon btn--sm" data-opt-rm="${esc(o.id)}" title="Remover">${icon('x')}</button>
            </div>`).join('')}
          ${!d.options.length ? '<p class="hint">Nenhuma opção ainda.</p>' : ''}
        </div>
        <div><button type="button" class="btn btn--sm" id="ffAddOpt">${icon('plus', 'ico--sm')} Adicionar opção</button></div>
      </div>` : ''}
    <div class="dialog__actions">
      <button type="button" class="btn btn--ghost" id="ffCancel">Cancelar</button>
      <button type="button" class="btn btn--primary" id="ffSave">${fieldId ? 'Salvar' : 'Criar campo'}</button>
    </div>
  </div>`;
}

/** Copia o que está nos inputs do form para o draft (antes de re-renderizar). */
function readFieldForm() {
  const d = ctx.fieldForm.draft;
  const r = ctx.root;
  const name = r.querySelector('#ffName'); if (name) d.name = name.value;
  const type = r.querySelector('#ffType'); if (type) d.type = type.value;
  const show = r.querySelector('#ffShow'); if (show) d.show_on_card = show.checked;
  const req = r.querySelector('#ffReq'); if (req) d.required = req.checked;
  const rows = [...r.querySelectorAll('[data-opt-id]')];
  if (rows.length) {
    rows.forEach((row) => { const o = d.options.find((x) => x.id === row.dataset.optId); if (o) o.label = row.querySelector('input').value; });
    const order = rows.map((x) => x.dataset.optId);
    d.options.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
}

function bindFieldForm(body) {
  const form = body.querySelector('#fieldForm');
  if (!form) return;
  const d = ctx.fieldForm.draft;

  form.querySelector('#ffType').addEventListener('change', () => { readFieldForm(); renderBody(); });
  form.querySelector('#ffCancel').addEventListener('click', () => { ctx.fieldForm = null; renderBody(); });
  form.querySelector('#ffName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); form.querySelector('#ffSave').click(); } });

  const opts = form.querySelector('#ffOptions');
  if (opts) {
    sortables.push(new Sortable(opts, { handle: '.handle', draggable: '.option-row', animation: 150, ghostClass: 'sortable-ghost', onEnd: () => readFieldForm() }));
    form.querySelector('#ffAddOpt').addEventListener('click', () => {
      readFieldForm();
      d.options.push({ id: uid(), label: '', color: randomPaletteColor() });
      renderBody();
      const rows = ctx.root.querySelectorAll('[data-opt-id] input');
      rows[rows.length - 1]?.focus();
    });
    opts.querySelectorAll('[data-opt-rm]').forEach((b) => b.addEventListener('click', () => {
      readFieldForm();
      d.options = d.options.filter((o) => o.id !== b.dataset.optRm);
      renderBody();
    }));
    opts.querySelectorAll('[data-opt-color]').forEach((b) => b.addEventListener('click', () => {
      const o = d.options.find((x) => x.id === b.dataset.optColor);
      openColorPopover(b, o?.color, (hex) => { if (o) o.color = hex; b.style.setProperty('--c', hex); });
    }));
    opts.querySelectorAll('[data-opt-id] input').forEach((inp) => inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); form.querySelector('#ffAddOpt').click(); }
    }));
  }

  form.querySelector('#ffSave').addEventListener('click', async () => {
    readFieldForm();
    const { fieldId } = ctx.fieldForm;
    const name = d.name.trim();
    if (!name) { form.querySelector('#ffName').focus(); toast('Dê um nome ao campo.', { type: 'warning' }); return; }
    const isSel = d.type === 'select' || d.type === 'multiselect';
    const options = isSel ? d.options.map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label) : [];
    const payload = { name, type: d.type, show_on_card: d.show_on_card, required: d.required, options };
    const btn = form.querySelector('#ffSave');
    btn.disabled = true;
    try {
      if (!fieldId) {
        await createField(state.boardId, payload);
        toastSuccess('Campo criado.');
      } else {
        const f = getField(fieldId);
        if (fieldUsage(fieldId) > 0) payload.type = f.type; // tipo travado
        const removed = (f.options || []).filter((o) => !options.some((x) => x.id === o.id));
        const inUse = removed.map((o) => ({ o, n: optionUsage(fieldId, o.id) })).filter((x) => x.n > 0);
        if (inUse.length) {
          const ok = await confirmDialog({
            title: 'Remover opções em uso?',
            message: inUse.map((x) => `"<b>${esc(x.o.label)}</b>" é usada em ${x.n} ${x.n === 1 ? 'card' : 'cards'}`).join('. ') + '. O valor será removido desses cards.',
            confirmText: 'Remover e salvar',
          });
          if (!ok) { btn.disabled = false; return; }
          for (const x of inUse) await purgeOptionValues(fieldId, x.o.id);
        }
        await updateField(fieldId, payload);
        toastSuccess('Campo salvo.');
      }
      ctx.fieldForm = null;
      renderBody();
    } catch (e) {
      toastError(e);
      btn.disabled = false;
    }
  });
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
      ${iconGridHtml(board.icon || 'kanban')}
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
  bindIconGrid(body, (n) => updateBoard(board.id, { icon: n }).catch(toastError));

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
