// Renderização dos campos personalizados: resumo no card do kanban e
// controles de edição no modal (um para cada tipo), mais os chips de status
// (um por grupo de status do campo; valor em "<field_id>:status:<group_id>").
import { icon, refreshIcons, fieldIconName, FIELD_TYPE_ICONS } from './icons.js';
import { chipHtml } from './common.js';
import {
  esc, el, formatCurrency, formatNumber, parseNumber, formatDateBR, dateDistance,
  whatsappLink, normalizeUrl, hostnameOf, autoResize, uid, randomPaletteColor,
} from '../utils.js';
import { updateField, isEmptyValue, fieldStatuses, statusKeyOf, statusValueIds } from '../fields.js';
import { getField, on } from '../state.js';
import { openPopover, closePopover } from './dialog.js';
import { toastError } from './toast.js';

export const fieldIcon = (type) => FIELD_TYPE_ICONS[type] || 'type';
export const statusKey = statusKeyOf;

export function optionById(field, id) {
  return (field?.options || []).find((o) => o.id === id) || null;
}
/** Opções selecionadas de um grupo, na ordem do grupo (aceita string ou array). */
export function selectedStatusOptions(group, value) {
  const ids = statusValueIds(value);
  return (group?.options || []).filter((o) => ids.includes(o.id));
}
/** HTML dos chips de status de um campo (todos os grupos com algo selecionado). */
export function statusChipsHtml(field, values, { small = false } = {}) {
  return fieldStatuses(field).map((g) => {
    const sel = selectedStatusOptions(g, values?.[statusKeyOf(field.id, g.id)]);
    return sel.map((o) => chipHtml(o.label, o.color, { small, title: `${g.label || 'Status'}: ${o.label}` })).join('');
  }).join('');
}

const PLACEHOLDERS = {
  text: 'Digite…', email: 'nome@exemplo.com', phone: '(11) 99999-9999', url: 'https://…',
  textarea: 'Digite…', number: '0', currency: 'R$ 0,00',
};

// ----------------------------------------------------------------------------
// Resumo compacto para o card no kanban.
// fieldSummaryHtml(field, values) — `values` é o jsonb inteiro do card, porque
// os status moram em "<field_id>:status:<group_id>". Retorna '' quando não há nada.
// ----------------------------------------------------------------------------
function summaryValue(field, value) {
  if (isEmptyValue(value)) return null;
  switch (field.type) {
    case 'select': {
      const o = optionById(field, value);
      return o ? { html: `<span class="chips">${chipHtml(o.label, o.color, { small: true })}</span>` } : null;
    }
    case 'multiselect': {
      const os = (Array.isArray(value) ? value : []).map((id) => optionById(field, id)).filter(Boolean);
      return os.length ? { html: `<span class="chips">${os.map((o) => chipHtml(o.label, o.color, { small: true })).join('')}</span>` } : null;
    }
    case 'checkbox': return value ? { html: `<span>${esc(field.name)}</span>` } : null;
    case 'currency': return { html: `<span>${esc(formatCurrency(value))}</span>` };
    case 'number': return { html: `<span>${esc(formatNumber(value))}</span>` };
    case 'date': {
      // texto relativo e vermelho de atrasado só quando o campo é um prazo
      const d = field.is_deadline ? dateDistance(value) : null;
      return { html: `<span>${esc(formatDateBR(value))}${d ? ` · ${esc(d.label)}` : ''}</span>`, cls: d?.overdue ? 'is-overdue' : '' };
    }
    case 'url': return { html: `<span>${esc(hostnameOf(value))}</span>` };
    case 'textarea': return { html: `<span>${esc(String(value).split('\n')[0])}</span>` };
    default: return { html: `<span>${esc(String(value))}</span>` };
  }
}

export function fieldSummaryHtml(field, values) {
  const v = summaryValue(field, values?.[field.id]);
  const chips = statusChipsHtml(field, values, { small: true });
  if (!v && !chips) return '';
  return `<div class="card__field ${v?.cls || ''}" title="${esc(field.name)}">
    ${icon(fieldIconName(field))}
    ${v ? v.html : `<span class="muted">${esc(field.name)}</span>`}
    ${chips ? `<span class="status-chips">${chips}</span>` : ''}
  </div>`;
}

// ----------------------------------------------------------------------------
// Controles do modal. renderFieldControl(field, value, onChange) -> Element
// onChange(valor) é chamado a cada mudança; null significa "limpar".
// ----------------------------------------------------------------------------
export function renderFieldControl(field, value, onChange) {
  switch (field.type) {
    case 'textarea':    return textareaControl(field, value, onChange);
    case 'number':
    case 'currency':    return numberControl(field, value, onChange);
    case 'date':        return dateControl(field, value, onChange);
    case 'select':      return selectControl(field, value, onChange);
    case 'multiselect': return multiControl(field, value, onChange);
    case 'checkbox':    return checkboxControl(field, value, onChange);
    case 'url':         return urlControl(field, value, onChange);
    default:            return textControl(field, value, onChange);
  }
}

function wrapper() { return el('<div class="field-row__control"></div>'); }

function textControl(field, value, onChange) {
  const root = wrapper();
  const row = el('<div class="phone-row"></div>');
  const type = field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text';
  const input = el(`<input class="input input--invisible" type="${type}" value="${esc(value ?? '')}" placeholder="${esc(PLACEHOLDERS[field.type] || '')}" autocomplete="off" />`);
  row.appendChild(input);
  const actionWrap = el('<span></span>');
  row.appendChild(actionWrap);

  const refreshAction = () => {
    const v = input.value.trim();
    actionWrap.innerHTML = '';
    if (!v) return;
    if (field.type === 'phone') {
      const link = whatsappLink(v);
      if (link) actionWrap.innerHTML = `<a class="btn btn--ghost btn--icon btn--sm" href="${esc(link)}" target="_blank" rel="noopener" title="Abrir no WhatsApp">${icon('message-circle')}</a>`;
    } else if (field.type === 'email') {
      actionWrap.innerHTML = `<a class="btn btn--ghost btn--icon btn--sm" href="mailto:${esc(v)}" title="Enviar e-mail">${icon('send')}</a>`;
    }
    refreshIcons();
  };
  input.addEventListener('input', () => onChange(input.value.trim() || null));
  input.addEventListener('blur', refreshAction);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  refreshAction();
  root.appendChild(row);
  return root;
}

function urlControl(field, value, onChange) {
  const root = wrapper();
  const input = el(`<input class="input input--invisible" type="url" value="${esc(value ?? '')}" placeholder="https://…" autocomplete="off" />`);
  const view = el(`<div class="field-link hidden">
    <a target="_blank" rel="noopener"></a>
    <button type="button" class="btn btn--ghost btn--icon btn--sm" title="Editar">${icon('pencil')}</button>
  </div>`);
  // Fora de foco o link é clicável; o lápis volta para edição.
  const sync = () => {
    const v = input.value.trim();
    if (v) {
      const a = view.querySelector('a');
      a.href = normalizeUrl(v);
      a.textContent = v;
      view.classList.remove('hidden');
      input.classList.add('hidden');
    } else {
      view.classList.add('hidden');
      input.classList.remove('hidden');
    }
  };
  view.querySelector('button').addEventListener('click', () => {
    view.classList.add('hidden');
    input.classList.remove('hidden');
    input.focus();
  });
  input.addEventListener('input', () => onChange(input.value.trim() || null));
  input.addEventListener('blur', sync);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  root.append(view, input);
  sync();
  refreshIcons();
  return root;
}

function textareaControl(field, value, onChange) {
  const root = wrapper();
  const ta = el(`<textarea class="textarea input--invisible" rows="2" placeholder="Digite…">${esc(value ?? '')}</textarea>`);
  ta.addEventListener('input', () => { autoResize(ta); onChange(ta.value.trim() ? ta.value : null); });
  root.appendChild(ta);
  requestAnimationFrame(() => autoResize(ta));
  return root;
}

function numberControl(field, value, onChange) {
  const root = wrapper();
  const isCurrency = field.type === 'currency';
  const display = (n) => (n == null ? '' : isCurrency ? formatCurrency(n) : String(n).replace('.', ','));
  const raw = (n) => (n == null ? '' : String(n).replace('.', ','));
  let current = value == null || value === '' ? null : Number(value);
  const input = el(`<input class="input input--invisible" type="text" inputmode="decimal" value="${esc(display(current))}" placeholder="${esc(PLACEHOLDERS[field.type])}" autocomplete="off" />`);
  input.addEventListener('focus', () => { input.value = raw(current); input.select(); });
  input.addEventListener('input', () => { current = parseNumber(input.value); onChange(current); });
  input.addEventListener('blur', () => { input.value = display(current); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  root.appendChild(input);
  return root;
}

function dateControl(field, value, onChange) {
  const root = wrapper();
  const input = el(`<input class="input input--invisible" type="date" value="${esc(value ? String(value).slice(0, 10) : '')}" />`);
  const hint = el('<div class="date-hint"></div>');
  const paint = () => {
    const d = field.is_deadline ? dateDistance(input.value) : null;
    hint.textContent = d ? d.label : '';
    hint.classList.toggle('is-overdue', !!d?.overdue);
  };
  input.addEventListener('change', () => { onChange(input.value || null); paint(); });
  input.addEventListener('input', paint);
  root.append(input, hint);
  paint();
  return root;
}

function checkboxControl(field, value, onChange) {
  const root = wrapper();
  const row = el(`<div class="checkbox-row"><label class="toggle"><input type="checkbox" ${value ? 'checked' : ''} /><span class="toggle__track"></span><span class="muted">${value ? 'Sim' : 'Não'}</span></label></div>`);
  const cb = row.querySelector('input');
  cb.addEventListener('change', () => {
    row.querySelector('.muted').textContent = cb.checked ? 'Sim' : 'Não';
    onChange(cb.checked ? true : null);
  });
  root.appendChild(row);
  return root;
}

function selectControl(field, value, onChange) {
  const root = wrapper();
  const btn = el('<button type="button" class="select-btn"></button>');
  let current = value || null;
  const live = () => getField(field.id) || field;
  const paint = () => {
    const o = optionById(live(), current);
    btn.innerHTML = (o ? chipHtml(o.label, o.color) : '<span class="placeholder">Selecionar…</span>') + icon('chevron-down', 'ico--chev ico--sm');
    refreshIcons();
  };
  btn.addEventListener('click', () => openOptionPicker(btn, live(), {
    selected: current ? [current] : [],
    multi: false,
    onPick: (id) => { current = id; paint(); onChange(id); },
    onClear: () => { current = null; paint(); onChange(null); },
  }));
  paint();
  root.appendChild(btn);
  return root;
}

function multiControl(field, value, onChange) {
  const root = wrapper();
  const wrap = el('<div class="multi-wrap"></div>');
  let current = Array.isArray(value) ? [...value] : [];
  const live = () => getField(field.id) || field;
  const paint = () => {
    const f = live();
    const chips = current.map((id) => optionById(f, id)).filter(Boolean)
      .map((o) => chipHtml(o.label, o.color, { removable: true, id: o.id })).join('');
    wrap.innerHTML = `${chips}<button type="button" class="chip chip--btn" data-add>${icon('plus', 'ico--sm')} Adicionar</button>`;
    refreshIcons();
  };
  const commit = () => onChange(current.length ? current : null);
  wrap.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { current = current.filter((id) => id !== rm.dataset.remove); paint(); commit(); return; }
    const add = e.target.closest('[data-add]');
    if (add) openOptionPicker(add, live(), {
      selected: current, multi: true,
      onToggle: (id) => {
        current = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
        paint(); commit();
      },
    });
  });
  paint();
  root.appendChild(wrap);
  return root;
}

// ----------------------------------------------------------------------------
// Chip de status de UM grupo do campo (valor em "<field_id>:status:<group_id>").
// Grupo único: dropdown com as opções + "Sem status" (valor = id ou null).
// Grupo múltiplo: dropdown com checkboxes (valor = array de ids ou null).
// O chip mostra até 2 opções, depois "+N". Lê a definição ao vivo (getField),
// então mudanças via realtime repintam o chip e o popover aberto.
// ----------------------------------------------------------------------------
export function renderStatusControl(field, group, value, onChange) {
  const btn = el('<button type="button" class="status-chip chip"></button>');
  let current = Array.isArray(value) ? [...value] : (value || null);
  const liveGroup = () => fieldStatuses(getField(field.id) || field).find((g) => g.id === group.id) || group;

  const paint = () => {
    const g = liveGroup();
    const sel = selectedStatusOptions(g, current);
    btn.title = g.label || 'Status';
    if (sel.length) {
      btn.className = 'status-chip chip';
      btn.style.setProperty('--c', sel[0].color);
      const shown = sel.slice(0, 2);
      btn.innerHTML = `
        ${shown.map((o) => `<span class="dot" style="--c:${esc(o.color)}"></span>`).join('')}
        <span class="truncate">${esc(shown.map((o) => o.label).join(', '))}${sel.length > 2 ? ` +${sel.length - 2}` : ''}</span>
        ${icon('chevron-down', 'ico--sm')}`;
    } else {
      btn.className = 'status-chip chip chip--btn';
      btn.style.removeProperty('--c');
      btn.innerHTML = `<span class="truncate">${esc(g.label || 'Status')}</span>${icon('chevron-down', 'ico--sm')}`;
    }
    refreshIcons();
  };

  btn.addEventListener('click', () => {
    openStatusPicker(btn, field, group.id, current, (v) => {
      current = v;
      paint();
      onChange(current);
    });
  });
  paint();
  return btn;
}

/**
 * Popover de escolha de status de um grupo. Fica aberto enquanto o grupo for
 * múltiplo (checkboxes); fecha ao escolher quando é único. Repinta se a
 * definição do campo mudar (realtime) enquanto está aberto.
 */
export function openStatusPicker(anchor, field, groupId, value, onChange) {
  let current = Array.isArray(value) ? [...value] : (value || null);
  const liveGroup = () => fieldStatuses(getField(field.id) || field).find((g) => g.id === groupId);
  let off = null;
  const pop = openPopover(anchor, '<div class="menu"></div>', { onClose: () => off?.() });
  const menu = pop.querySelector('.menu');

  const paint = () => {
    const g = liveGroup();
    if (!g) { closePopover(pop); return; }
    const ids = statusValueIds(current);
    const opts = g.options || [];
    menu.innerHTML = `
      <div class="menu__label">${esc(g.label || 'Status')}${g.multiple ? ' · várias' : ''}</div>
      ${opts.length ? opts.map((o) => {
        const on = ids.includes(o.id);
        return `<button type="button" class="menu__item ${on ? 'is-selected' : ''}" data-opt="${esc(o.id)}">
          ${g.multiple ? icon(on ? 'square-check' : 'square', 'ico--sm') : `<span class="dot" style="--c:${esc(o.color)}"></span>`}
          ${g.multiple ? `<span class="dot" style="--c:${esc(o.color)}"></span>` : ''}
          <span class="grow truncate">${esc(o.label)}</span>
          ${!g.multiple && on ? icon('check', 'check ico--sm') : ''}
        </button>`;
      }).join('') : '<div class="popover__empty">Nenhuma opção. Edite o campo para adicionar.</div>'}
      <div class="menu__sep"></div>
      <button type="button" class="menu__item" data-clear>${icon('x')}<span class="grow">${g.multiple ? 'Limpar' : 'Sem status'}</span></button>`;
    refreshIcons();
  };

  menu.addEventListener('click', (e) => {
    const g = liveGroup();
    if (!g) return;
    if (e.target.closest('[data-clear]')) {
      current = null;
      onChange(null);
      if (g.multiple) paint(); else closePopover(pop);
      return;
    }
    const b = e.target.closest('[data-opt]');
    if (!b) return;
    const id = b.dataset.opt;
    if (g.multiple) {
      const ids = statusValueIds(current);
      current = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      if (!current.length) current = null;
      onChange(current);
      paint();
    } else {
      current = id;
      onChange(current);
      closePopover(pop);
    }
  });

  off = on('fields', paint);
  paint();
  return pop;
}

// ----------------------------------------------------------------------------
// Popover de opções (select/multiselect) com busca e "criar opção"
// ----------------------------------------------------------------------------
export function openOptionPicker(anchor, field, { selected = [], multi = false, onPick, onToggle, onClear }) {
  let f = getField(field.id) || field;
  let sel = [...selected];
  const pop = openPopover(anchor, `
    <input class="input input--sm popover__search" placeholder="Buscar ou criar…" autocomplete="off" />
    <div class="menu popover__list"></div>`, { cls: 'popover--wide' });
  const search = pop.querySelector('input');
  const list = pop.querySelector('.popover__list');

  const paint = () => {
    f = getField(field.id) || f;
    const q = search.value.trim().toLowerCase();
    const opts = (f.options || []).filter((o) => !q || o.label.toLowerCase().includes(q));
    const exact = (f.options || []).some((o) => o.label.toLowerCase() === q);
    list.innerHTML = `
      ${!multi && sel.length ? `<button type="button" class="menu__item" data-clear>${icon('x')}<span class="grow">Limpar</span></button>` : ''}
      ${opts.map((o) => `
        <button type="button" class="menu__item ${sel.includes(o.id) ? 'is-selected' : ''}" data-opt="${esc(o.id)}">
          ${chipHtml(o.label, o.color)}
          ${sel.includes(o.id) ? icon('check', 'check ico--sm') : ''}
        </button>`).join('')}
      ${!opts.length && !q ? '<div class="popover__empty">Nenhuma opção ainda. Digite para criar.</div>' : ''}
      ${q && !exact ? `<button type="button" class="menu__item" data-create>${icon('plus')}<span class="grow">Criar "${esc(search.value.trim())}"</span></button>` : ''}`;
    refreshIcons();
  };

  list.addEventListener('click', async (e) => {
    const clear = e.target.closest('[data-clear]');
    if (clear) { closePopover(pop); onClear?.(); return; }
    const create = e.target.closest('[data-create]');
    if (create) {
      const label = search.value.trim();
      const opt = { id: uid(), label, color: randomPaletteColor() };
      const next = [...(getField(f.id)?.options || f.options || []), opt];
      // Seleciona ANTES de persistir: o valor entra no autosave pendente e,
      // quando o update do campo re-renderizar a linha, já aparece escolhido.
      if (multi) { sel.push(opt.id); onToggle?.(opt.id); }
      else { closePopover(pop); onPick?.(opt.id); }
      try {
        await updateField(f.id, { options: next });
      } catch (err) { toastError(err); return; }
      if (multi) { search.value = ''; paint(); }
      return;
    }
    const btn = e.target.closest('[data-opt]');
    if (!btn) return;
    const id = btn.dataset.opt;
    if (multi) {
      sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
      onToggle?.(id);
      paint();
    } else {
      closePopover(pop);
      onPick?.(id);
    }
  });
  search.addEventListener('input', paint);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = list.querySelector('[data-opt], [data-create]');
      first?.click();
    }
  });
  paint();
  return pop;
}
