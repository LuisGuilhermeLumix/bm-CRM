// Editor de definição de campo (popover). Fonte única da UI de campo: usado
// pelo modal do card (lápis / "+ Adicionar campo") e pelo painel Configurar
// board → Campos. Inclui o editor de opções (select/multiselect e grupos de status).
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/modular/sortable.esm.js';
import { icon, refreshIcons, fieldIconName } from './icons.js';
import { esc, el, uid, nextPaletteColor } from '../utils.js';
import { state, getField } from '../state.js';
import {
  FIELD_TYPES, createField, updateField, deleteField, fieldUsage, optionUsage, statusOptionUsage, statusGroupUsage,
  purgeOptionValues, purgeStatusOptionValues, fieldStatuses,
} from '../fields.js';
import { toggleHtml } from './common.js';
import { fieldCardUsage } from '../cards.js';
import { openPopover, closePopover, confirmDialog } from './dialog.js';
import { openColorPopover } from './colorPicker.js';
import { openIconPicker } from './iconPicker.js';
import { toast, toastError, toastSuccess } from './toast.js';

// ============================================================================
// Editor de opções (componente): lista arrastável de { id, label, color }
// ============================================================================

function optionRowHtml(o, placeholder) {
  return `
      <div class="option-row" data-opt-id="${esc(o.id)}">
        <span class="handle" title="Arrastar para reordenar">${icon('grip-vertical')}</span>
        <button type="button" class="color-btn color-btn--sm" data-opt-color style="--c:${esc(o.color)}" title="Cor"></button>
        <input class="input input--sm" value="${esc(o.label)}" placeholder="${esc(placeholder)}" autocomplete="off" />
        <button type="button" class="btn btn--ghost btn--icon btn--sm" data-opt-rm title="Remover">${icon('x')}</button>
      </div>`;
}

export function optionsEditorHtml(options, key, { placeholder = 'Nome da opção' } = {}) {
  return `
  <div class="options-editor" data-oe="${key}" data-placeholder="${esc(placeholder)}">
    <div class="options-editor__list">${options.map((o) => optionRowHtml(o, placeholder)).join('')}</div>
    <p class="hint options-editor__empty ${options.length ? 'hidden' : ''}">Nenhuma opção ainda.</p>
    <div><button type="button" class="btn btn--sm" data-opt-add title="Enter cria a próxima · Backspace num campo vazio remove · ↑↓ navegam">${icon('plus', 'ico--sm')} Adicionar opção</button></div>
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
 * bindOptionsEditor(container, options, { sortables })
 * `options` é mutado no lugar. Adicionar/remover mexe só nas linhas da lista
 * (sem re-renderizar o popover), então o foco e a rolagem não se perdem.
 * Teclado: Enter cria uma opção logo abaixo (não cria se a atual estiver
 * vazia); Backspace num campo vazio remove e volta para a anterior; ↑/↓
 * navegam. Cor nova = próxima cor da paleta ainda não usada no grupo.
 */
export function bindOptionsEditor(container, options, { sortables = [] } = {}) {
  const list = container.querySelector('.options-editor__list');
  const empty = container.querySelector('.options-editor__empty');
  const placeholder = container.dataset.placeholder || 'Nome da opção';
  const rows = () => [...list.querySelectorAll('.option-row')];
  const inputs = () => rows().map((r) => r.querySelector('input'));
  const syncEmpty = () => empty?.classList.toggle('hidden', options.length > 0);
  const focusInput = (inp) => {
    if (!inp) return;
    inp.focus();
    const n = inp.value.length;
    try { inp.setSelectionRange(n, n); } catch { /* ignore */ }
    inp.scrollIntoView({ block: 'nearest' });
  };

  sortables.push(new Sortable(list, {
    handle: '.handle', draggable: '.option-row', animation: 150, ghostClass: 'sortable-ghost',
    onEnd: () => readOptionsEditor(container, options),
  }));

  const addAfter = (row) => {
    readOptionsEditor(container, options);
    const o = { id: uid(), label: '', color: nextPaletteColor(options.map((x) => x.color)) };
    const at = row ? options.findIndex((x) => x.id === row.dataset.optId) + 1 : options.length;
    options.splice(at > 0 ? at : options.length, 0, o);
    const node = el(optionRowHtml(o, placeholder));
    if (row) row.after(node); else list.appendChild(node);
    refreshIcons();
    syncEmpty();
    focusInput(node.querySelector('input'));
  };

  const removeRow = (row, { focusPrev = false } = {}) => {
    const i = rows().indexOf(row);
    const idx = options.findIndex((x) => x.id === row.dataset.optId);
    if (idx >= 0) options.splice(idx, 1);
    row.remove();
    syncEmpty();
    if (focusPrev) focusInput(inputs()[Math.max(0, i - 1)]);
  };

  container.querySelector('[data-opt-add]').addEventListener('click', () => addAfter(null));

  list.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-opt-rm]');
    if (rm) { removeRow(rm.closest('.option-row')); return; }
    const cb = e.target.closest('[data-opt-color]');
    if (cb) {
      const o = options.find((x) => x.id === cb.closest('.option-row').dataset.optId);
      openColorPopover(cb, o?.color, (hex) => { if (o) o.color = hex; cb.style.setProperty('--c', hex); }, { nested: true });
    }
  });

  list.addEventListener('input', (e) => {
    const row = e.target.closest('.option-row');
    const o = row && options.find((x) => x.id === row.dataset.optId);
    if (o) o.label = e.target.value;
  });

  list.addEventListener('keydown', (e) => {
    const inp = e.target.closest('.option-row input');
    if (!inp || e.isComposing) return;
    const row = inp.closest('.option-row');
    const all = inputs();
    const i = all.indexOf(inp);
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (inp.value.trim()) addAfter(row);
    } else if (e.key === 'Backspace' && inp.value === '' && all.length > 1) {
      e.preventDefault();
      removeRow(row, { focusPrev: true });
    } else if (e.key === 'ArrowUp' && i > 0) {
      e.preventDefault();
      focusInput(all[i - 1]);
    } else if (e.key === 'ArrowDown' && i < all.length - 1) {
      e.preventDefault();
      focusInput(all[i + 1]);
    }
  });
}

// ============================================================================
// Popover de edição / criação de campo
// ============================================================================

function emptyDraft() {
  return {
    name: '', type: 'text', icon: null, show_on_card: true, required: false, options: [],
    statuses: [],
    default_on_new_cards: true,
    is_deadline: false,
  };
}

function draftFrom(f) {
  return {
    name: f.name, type: f.type, icon: f.icon || null, show_on_card: !!f.show_on_card, required: !!f.required,
    options: (f.options || []).map((o) => ({ ...o })),
    statuses: fieldStatuses(f).map((g) => ({
      id: g.id, label: g.label || '', multiple: !!g.multiple, options: (g.options || []).map((o) => ({ ...o })),
    })),
    default_on_new_cards: f.default_on_new_cards !== false,
    is_deadline: !!f.is_deadline,
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
    if (q('#feDefault')) d.default_on_new_cards = q('#feDefault').checked;
    if (q('#feDeadline')) d.is_deadline = q('#feDeadline').checked;
    const oe = q('[data-oe="options"]'); if (oe) readOptionsEditor(oe, d.options);
    // grupos de status: rótulo, modo e opções de cada um, na ordem do DOM
    const rows = [...pop.querySelectorAll('[data-sg-id]')];
    for (const row of rows) {
      const g = d.statuses.find((x) => x.id === row.dataset.sgId);
      if (!g) continue;
      g.label = row.querySelector('[data-sg-label]').value;
      g.multiple = row.querySelector('input[name="sg-multi"]').checked;
      const se = row.querySelector(`[data-oe="sg:${g.id}"]`); if (se) readOptionsEditor(se, g.options);
    }
    if (rows.length) {
      const order = rows.map((r) => r.dataset.sgId);
      d.statuses.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    }
  };

  const paint = ({ focus = null } = {}) => {
    sortables.forEach((s) => { try { s.destroy(); } catch { /* ignore */ } });
    sortables = [];
    const usage = fieldId ? fieldUsage(fieldId) : 0;
    const inCards = fieldId ? fieldCardUsage(fieldId) : 0;
    const locked = usage > 0;
    const isSel = d.type === 'select' || d.type === 'multiselect';
    const iconName = d.icon || fieldIconName({ type: d.type });

    pop.innerHTML = `
      <div class="field-editor">
        <div class="field-editor__head">
          <div class="field-editor__title">${icon(fieldId ? 'pencil' : 'plus')} ${fieldId ? 'Editar campo' : 'Novo campo'}</div>
          <div class="hint">${fieldId ? `Alterações valem para todos os cards que usam esse campo${inCards ? ` (${inCards} ${inCards === 1 ? 'card' : 'cards'})` : ''}` : 'O campo fica disponível para todos os cards deste board'}</div>
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
          ${toggleHtml({ id: 'feDefault', label: 'Padrão em novos cards', checked: d.default_on_new_cards })}
        </div>
        ${d.type === 'date' ? `
          <div class="field-editor__toggle">
            ${toggleHtml({ id: 'feDeadline', label: 'É um prazo', checked: d.is_deadline })}
            <span class="hint">Mostra "em N dias" ou "atrasado" em vermelho</span>
          </div>` : ''}
        ${isSel ? `
          <div class="form-field">
            <label>Opções</label>
            ${optionsEditorHtml(d.options, 'options')}
          </div>` : ''}

        <div class="field-editor__section">
          <div class="section__title">${icon('circle-dot')} Status</div>
          ${d.statuses.length ? `<div class="status-groups" id="feGroups">
            ${d.statuses.map((g) => `
              <div class="status-group" data-sg-id="${esc(g.id)}">
                <div class="status-group__head">
                  <span class="handle" title="Arrastar para reordenar">${icon('grip-vertical')}</span>
                  <input class="input input--sm grow" data-sg-label value="${esc(g.label)}" placeholder="Rótulo (ex.: Situação)" autocomplete="off" />
                  <button type="button" class="btn btn--ghost btn--icon btn--sm" data-sg-rm title="Remover grupo">${icon('x')}</button>
                </div>
                ${toggleHtml({ id: `sgm-${g.id}`, name: 'sg-multi', label: 'Permitir várias', checked: g.multiple })}
                ${optionsEditorHtml(g.options, `sg:${g.id}`, { placeholder: 'Ex.: Ativa' })}
              </div>`).join('')}
          </div>` : '<p class="hint">Sem grupos = sem status. Ex.: Empresa → "Situação" (Ativa/Cancelada), "Prioridade" (Alta/Média/Baixa) e "Pendências" (Contrato/NF, várias).</p>'}
          <div><button type="button" class="btn btn--sm" id="feAddGroup">${icon('plus', 'ico--sm')} Adicionar grupo de status</button></div>
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
    } else if (focus?.startsWith?.('group:')) {
      const inp = pop.querySelector(`[data-sg-id="${focus.slice(6)}"] [data-sg-label]`);
      inp?.focus();
      inp?.scrollIntoView({ block: 'nearest' });
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
    const oe = q('[data-oe="options"]');
    if (oe) bindOptionsEditor(oe, d.options, { sortables });

    // grupos de status
    const groupsHost = q('#feGroups');
    if (groupsHost) {
      sortables.push(new Sortable(groupsHost, {
        handle: '.status-group__head > .handle', draggable: '.status-group', animation: 150, ghostClass: 'sortable-ghost',
        onEnd: () => read(),
      }));
    }
    for (const g of d.statuses) {
      const se = q(`[data-oe="sg:${g.id}"]`);
      if (se) bindOptionsEditor(se, g.options, { sortables });
      const row = q(`[data-sg-id="${g.id}"]`);
      row?.querySelector('[data-sg-label]').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); se?.querySelector('[data-opt-add]')?.click(); }
      });
      row?.querySelector('[data-sg-rm]').addEventListener('click', async () => {
        read();
        const n = fieldId ? statusGroupUsage(fieldId, g.id) : 0;
        if (n) {
          const ok = await confirmDialog({
            title: 'Remover grupo de status?',
            message: `"<b>${esc(g.label || 'Status')}</b>" tem valor em ${n} ${n === 1 ? 'card' : 'cards'}. Ao salvar, esse status será apagado desses cards.`,
            confirmText: 'Remover',
          });
          if (!ok) return;
        }
        d.statuses = d.statuses.filter((x) => x.id !== g.id);
        paint();
      });
    }
    q('#feAddGroup').addEventListener('click', () => {
      read();
      const g = { id: uid(), label: '', multiple: false, options: [] };
      d.statuses.push(g);
      paint({ focus: `group:${g.id}` });
    });
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
      statuses: d.statuses.map((g) => ({
        id: g.id, label: (g.label || '').trim() || 'Status', multiple: !!g.multiple, options: clean(g.options),
      })),
      default_on_new_cards: d.default_on_new_cards,
      is_deadline: d.type === 'date' && d.is_deadline,
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
        // grupos de status removidos (já confirmados ao clicar no X): limpa cada opção em uso
        const oldGroups = fieldStatuses(f);
        const removedGroups = oldGroups.filter((g) => !payload.statuses.some((x) => x.id === g.id));
        const groupPurges = [];
        for (const g of removedGroups) {
          for (const o of g.options || []) if (statusOptionUsage(fieldId, g.id, o.id) > 0) groupPurges.push({ g, o });
        }
        // opções de status removidas de grupos que continuam, em uso → confirmar
        const statusInUse = [];
        for (const g of oldGroups) {
          const kept = payload.statuses.find((x) => x.id === g.id);
          if (!kept) continue;
          for (const o of g.options || []) {
            if (kept.options.some((x) => x.id === o.id)) continue;
            const n = statusOptionUsage(fieldId, g.id, o.id);
            if (n > 0) statusInUse.push({ g, o, n });
          }
        }

        if (optsInUse.length || statusInUse.length) {
          const lines = [
            ...optsInUse.map((x) => `"<b>${esc(x.o.label)}</b>" é usada em ${x.n} ${x.n === 1 ? 'card' : 'cards'}`),
            ...statusInUse.map((x) => `${esc(x.g.label || 'Status')} "<b>${esc(x.o.label)}</b>" é usado em ${x.n} ${x.n === 1 ? 'card' : 'cards'}`),
          ];
          const ok = await confirmDialog({
            title: 'Remover opções em uso?',
            message: lines.join('. ') + '. O valor será removido desses cards.',
            confirmText: 'Remover e salvar',
          });
          if (!ok) { btn.disabled = false; return; }
        }
        for (const x of optsInUse) await purgeOptionValues(fieldId, x.o.id);
        for (const x of statusInUse) await purgeStatusOptionValues(fieldId, x.g.id, x.o.id);
        for (const x of groupPurges) await purgeStatusOptionValues(fieldId, x.g.id, x.o.id);
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
    const inCards = fieldCardUsage(fieldId);
    const ok = await confirmDialog({
      title: 'Excluir campo do board',
      message: `Excluir o campo "<b>${esc(f.name)}</b>" do board?${inCards ? ` Ele está em uso em <b>${inCards} ${inCards === 1 ? 'card' : 'cards'}</b>` : ' Nenhum card usa esse campo'}${usage ? ` e tem valor preenchido em ${usage} ${usage === 1 ? 'card' : 'cards'}, que será apagado.` : '.'} Para tirar o campo de um card só, use a lixeira na linha do campo dentro do card.`,
      confirmText: 'Excluir do board',
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
