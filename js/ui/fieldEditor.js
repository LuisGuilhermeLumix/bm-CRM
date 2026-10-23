// Editor de definição de campo (popover). Fonte única da UI de campo: usado
// pelo modal do card (lápis / "+ Adicionar campo") e pelo painel Configurar
// board → Campos. Inclui o editor de opções (select/multiselect e status).
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/modular/sortable.esm.js';
import { icon, refreshIcons, fieldIconName } from './icons.js';
import { esc, uid, randomPaletteColor } from '../utils.js';
import { state, getField } from '../state.js';
import {
  FIELD_TYPES, createField, updateField, deleteField, fieldUsage, optionUsage, statusOptionUsage,
  purgeOptionValues, purgeStatusOptionValues,
} from '../fields.js';
import { toggleHtml } from './common.js';
import { openPopover, closePopover, confirmDialog } from './dialog.js';
import { openColorPopover } from './colorPicker.js';
import { openIconPicker } from './iconPicker.js';
import { toast, toastError, toastSuccess } from './toast.js';

// ============================================================================
// Editor de opções (componente): lista arrastável de { id, label, color }
// ============================================================================

export function optionsEditorHtml(options, key, { placeholder = 'Nome da opção' } = {}) {
  return `
  <div class="options-editor" data-oe="${key}">
    ${options.map((o) => `
      <div class="option-row" data-opt-id="${esc(o.id)}">
        <span class="handle" title="Arrastar para reordenar">${icon('grip-vertical')}</span>
        <button type="button" class="color-btn color-btn--sm" data-opt-color style="--c:${esc(o.color)}" title="Cor"></button>
        <input class="input input--sm" value="${esc(o.label)}" placeholder="${esc(placeholder)}" autocomplete="off" />
        <button type="button" class="btn btn--ghost btn--icon btn--sm" data-opt-rm title="Remover">${icon('x')}</button>
      </div>`).join('')}
    ${!options.length ? '<p class="hint">Nenhuma opção ainda.</p>' : ''}
    <div><button type="button" class="btn btn--sm" data-opt-add>${icon('plus', 'ico--sm')} Adicionar opção</button></div>
  </div>`;
}

/** Copia labels e ordem dos inputs para o array `options` (mutado no lugar). */
export function readOptionsEditor(container, options) {
  const rows = [...container.querySelectorAll('[data-opt-id]')];
  rows.forEach((row) => {
    const o = options.find((x) => x.id === row.dataset.optId);
    if (o) o.label = row.querySelector('input').value;
  });
  const order = rows.map((r) => r.dataset.optId);
  options.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/**
 * bindOptionsEditor(container, options, { onStructureChange, sortables })
 * `options` é mutado no lugar. onStructureChange() é chamado quando precisa
 * re-renderizar (adicionar/remover). Cores são trocadas sem re-render.
 */
export function bindOptionsEditor(container, options, { onStructureChange, sortables = [] }) {
  sortables.push(new Sortable(container, {
    handle: '.handle', draggable: '.option-row', animation: 150, ghostClass: 'sortable-ghost',
    onEnd: () => readOptionsEditor(container, options),
  }));
  container.querySelector('[data-opt-add]').addEventListener('click', () => {
    readOptionsEditor(container, options);
    options.push({ id: uid(), label: '', color: randomPaletteColor() });
    onStructureChange({ focusLast: true });
  });
  container.querySelectorAll('[data-opt-rm]').forEach((b) => b.addEventListener('click', () => {
    readOptionsEditor(container, options);
    const id = b.closest('[data-opt-id]').dataset.optId;
    options.splice(0, options.length, ...options.filter((o) => o.id !== id));
    onStructureChange();
  }));
  container.querySelectorAll('[data-opt-color]').forEach((b) => b.addEventListener('click', () => {
    const id = b.closest('[data-opt-id]').dataset.optId;
    const o = options.find((x) => x.id === id);
    openColorPopover(b, o?.color, (hex) => { if (o) o.color = hex; b.style.setProperty('--c', hex); }, { nested: true });
  }));
  container.querySelectorAll('[data-opt-id] input').forEach((inp) => inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); container.querySelector('[data-opt-add]').click(); }
  }));
}

// ============================================================================
// Popover de edição / criação de campo
// ============================================================================

function emptyDraft() {
  return {
    name: '', type: 'text', icon: null, show_on_card: true, required: false, options: [],
    status_enabled: false, status_label: 'Status', status_options: [],
  };
}

function draftFrom(f) {
  return {
    name: f.name, type: f.type, icon: f.icon || null, show_on_card: !!f.show_on_card, required: !!f.required,
    options: (f.options || []).map((o) => ({ ...o })),
    status_enabled: !!f.status_enabled, status_label: f.status_label || 'Status',
    status_options: (f.status_options || []).map((o) => ({ ...o })),
  };
}

/**
 * openFieldEditor(anchor, { fieldId, onSaved, onDeleted, nested })
 * fieldId null = novo campo. Retorna o elemento do popover.
 */
export function openFieldEditor(anchor, { fieldId = null, onSaved, onDeleted, nested = false } = {}) {
  const field = fieldId ? getField(fieldId) : null;
  if (fieldId && !field) return null;
  const d = field ? draftFrom(field) : emptyDraft();
  let sortables = [];

  const pop = openPopover(anchor, '', { cls: 'popover--editor', nested });

  const read = () => {
    const q = (s) => pop.querySelector(s);
    if (q('#feName')) d.name = q('#feName').value;
    if (q('#feType') && !q('#feType').disabled) d.type = q('#feType').value;
    if (q('#feShow')) d.show_on_card = q('#feShow').checked;
    if (q('#feReq')) d.required = q('#feReq').checked;
    if (q('#feStatus')) d.status_enabled = q('#feStatus').checked;
    if (q('#feStatusLabel')) d.status_label = q('#feStatusLabel').value;
    const oe = q('[data-oe="options"]'); if (oe) readOptionsEditor(oe, d.options);
    const se = q('[data-oe="status_options"]'); if (se) readOptionsEditor(se, d.status_options);
  };

  const paint = ({ focus = null } = {}) => {
    sortables.forEach((s) => { try { s.destroy(); } catch { /* ignore */ } });
    sortables = [];
    const usage = fieldId ? fieldUsage(fieldId) : 0;
    const locked = usage > 0;
    const isSel = d.type === 'select' || d.type === 'multiselect';
    const iconName = d.icon || fieldIconName({ type: d.type });

    pop.innerHTML = `
      <div class="field-editor">
        <div class="field-editor__head">
          <div class="field-editor__title">${icon(fieldId ? 'pencil' : 'plus')} ${fieldId ? 'Editar campo' : 'Novo campo'}</div>
          <div class="hint">Alterações valem para todos os cards deste board</div>
        </div>

        <div class="form-field">
          <label>Nome</label>
          <input class="input" id="feName" value="${esc(d.name)}" placeholder="Ex.: Empresa" autocomplete="off" />
        </div>
        <div class="form-row">
          <div class="form-field">
            <label>Ícone</label>
            <button type="button" class="btn icon-btn" id="feIcon" title="Escolher ícone">
              ${icon(iconName)}<span class="truncate">${d.icon ? esc(d.icon) : 'Padrão do tipo'}</span>${icon('chevron-down', 'ico--sm')}
            </button>
          </div>
          <div class="form-field">
            <label>Tipo</label>
            <select class="select" id="feType" ${locked ? 'disabled' : ''}>
              ${FIELD_TYPES.map((t) => `<option value="${t.value}" ${t.value === d.type ? 'selected' : ''}>${t.label}</option>`).join('')}
            </select>
          </div>
        </div>
        ${locked ? `<div class="info-box info-box--warn">${icon('info')}<span>Este campo já tem valor em ${usage} ${usage === 1 ? 'card' : 'cards'}, por isso o tipo não pode ser alterado. Se precisar de outro tipo, crie um campo novo.</span></div>` : ''}
        <div class="row" style="gap:20px;flex-wrap:wrap">
          ${toggleHtml({ id: 'feShow', label: 'Mostrar no card do kanban', checked: d.show_on_card })}
          ${toggleHtml({ id: 'feReq', label: 'Obrigatório', checked: d.required })}
        </div>
        ${isSel ? `
          <div class="form-field">
            <label>Opções</label>
            ${optionsEditorHtml(d.options, 'options')}
          </div>` : ''}

        <div class="field-editor__section">
          <div class="section__title">${icon('circle-dot')} Status</div>
          ${toggleHtml({ id: 'feStatus', label: 'Vincular status a este campo', checked: d.status_enabled })}
          ${d.status_enabled ? `
            <div class="form-field">
              <label>Rótulo</label>
              <input class="input input--sm" id="feStatusLabel" value="${esc(d.status_label)}" placeholder="Status" autocomplete="off" />
            </div>
            <div class="form-field">
              <label>Opções de status</label>
              ${optionsEditorHtml(d.status_options, 'status_options', { placeholder: 'Ex.: Ativa' })}
            </div>` : '<p class="hint">Ex.: Empresa com Ativa / Cancelada / Pausada; Telefone com Válido / Inválido.</p>'}
        </div>

        <div class="field-editor__foot">
          ${fieldId ? `<button type="button" class="btn btn--danger-ghost btn--sm" id="feDelete">${icon('trash-2')} Excluir campo</button>` : '<span></span>'}
          <span class="row">
            <button type="button" class="btn btn--ghost btn--sm" id="feCancel">Cancelar</button>
            <button type="button" class="btn btn--primary btn--sm" id="feSave">${fieldId ? 'Salvar' : 'Criar campo'}</button>
          </span>
        </div>
      </div>`;
    refreshIcons();
    bind();
    if (focus === 'name') pop.querySelector('#feName')?.focus();
    else if (focus?.startsWith?.('lastopt:')) {
      const inputs = pop.querySelectorAll(`[data-oe="${focus.slice(8)}"] [data-opt-id] input`);
      inputs[inputs.length - 1]?.focus();
    } else if (focus) pop.querySelector(focus)?.focus();
  };

  const rerender = (focus) => { read(); paint({ focus }); };

  const bind = () => {
    const q = (s) => pop.querySelector(s);
    q('#feName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); q('#feSave').click(); } });
    q('#feIcon').addEventListener('click', (e) => {
      openIconPicker(e.currentTarget, d.icon, (name) => { read(); d.icon = name; paint(); }, { nested: true, allowDefault: true });
    });
    q('#feType').addEventListener('change', () => rerender('#feType'));
    q('#feStatus').addEventListener('change', () => rerender(q('#feStatus').checked ? '#feStatusLabel' : '#feStatus'));
    const oe = q('[data-oe="options"]');
    if (oe) bindOptionsEditor(oe, d.options, { sortables, onStructureChange: (o) => rerender(o?.focusLast ? 'lastopt:options' : null) });
    const se = q('[data-oe="status_options"]');
    if (se) bindOptionsEditor(se, d.status_options, { sortables, onStructureChange: (o) => rerender(o?.focusLast ? 'lastopt:status_options' : null) });
    q('#feCancel').addEventListener('click', () => closePopover(pop));
    q('#feSave').addEventListener('click', save);
    q('#feDelete')?.addEventListener('click', remove);
  };

  const save = async () => {
    read();
    const name = d.name.trim();
    if (!name) { pop.querySelector('#feName').focus(); toast('Dê um nome ao campo.', { type: 'warning' }); return; }
    const isSel = d.type === 'select' || d.type === 'multiselect';
    const clean = (list) => list.map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label);
    const payload = {
      name,
      type: d.type,
      icon: d.icon || null,
      show_on_card: d.show_on_card,
      required: d.required,
      options: isSel ? clean(d.options) : [],
      status_enabled: d.status_enabled,
      status_label: (d.status_label || '').trim() || 'Status',
      status_options: d.status_enabled ? clean(d.status_options) : (field?.status_options || []),
    };
    const btn = pop.querySelector('#feSave');
    btn.disabled = true;
    try {
      let saved;
      if (!fieldId) {
        saved = await createField(state.boardId, payload);
        toastSuccess('Campo criado.');
      } else {
        const f = getField(fieldId);
        if (fieldUsage(fieldId) > 0) payload.type = f.type; // tipo travado

        // opções (select) removidas que estão em uso
        const removedOpts = (f.options || []).filter((o) => !payload.options.some((x) => x.id === o.id));
        const optsInUse = isSel ? removedOpts.map((o) => ({ o, n: optionUsage(fieldId, o.id) })).filter((x) => x.n > 0) : [];
        // opções de status removidas que estão em uso
        const removedStatus = (f.status_options || []).filter((o) => !payload.status_options.some((x) => x.id === o.id));
        const statusInUse = removedStatus.map((o) => ({ o, n: statusOptionUsage(fieldId, o.id) })).filter((x) => x.n > 0);

        if (optsInUse.length || statusInUse.length) {
          const lines = [
            ...optsInUse.map((x) => `"<b>${esc(x.o.label)}</b>" é usada em ${x.n} ${x.n === 1 ? 'card' : 'cards'}`),
            ...statusInUse.map((x) => `status "<b>${esc(x.o.label)}</b>" é usado em ${x.n} ${x.n === 1 ? 'card' : 'cards'}`),
          ];
          const ok = await confirmDialog({
            title: 'Remover opções em uso?',
            message: lines.join('. ') + '. O valor será removido desses cards.',
            confirmText: 'Remover e salvar',
          });
          if (!ok) { btn.disabled = false; return; }
          for (const x of optsInUse) await purgeOptionValues(fieldId, x.o.id);
          for (const x of statusInUse) await purgeStatusOptionValues(fieldId, x.o.id);
        }
        saved = await updateField(fieldId, payload);
        toastSuccess('Campo salvo.');
      }
      closePopover(pop);
      onSaved?.(saved);
    } catch (e) {
      toastError(e);
      if (pop.isConnected) btn.disabled = false;
    }
  };

  const remove = async () => {
    const f = getField(fieldId);
    if (!f) return;
    const usage = fieldUsage(fieldId);
    const ok = await confirmDialog({
      title: 'Excluir campo',
      message: `Excluir o campo "<b>${esc(f.name)}</b>" de todos os cards deste board?${usage ? ` O valor preenchido em <b>${usage} ${usage === 1 ? 'card' : 'cards'}</b> será apagado.` : ''}`,
      confirmText: 'Excluir',
    });
    if (!ok) return;
    try {
      await deleteField(fieldId);
      closePopover(pop);
      toastSuccess('Campo excluído.');
      onDeleted?.(fieldId);
    } catch (e) { toastError(e); }
  };

  paint({ focus: 'name' });
  return pop;
}
