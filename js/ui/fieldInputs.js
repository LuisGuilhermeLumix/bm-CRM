// Renderização dos campos personalizados: resumo no card do kanban e
// controles de edição no modal, um para cada tipo.
import { icon, refreshIcons } from './icons.js';
import { chipHtml } from './common.js';
import {
  esc, el, formatCurrency, formatNumber, parseNumber, formatDateBR, dateDistance,
  whatsappLink, normalizeUrl, hostnameOf, autoResize, uid, randomPaletteColor,
} from '../utils.js';
import { fieldTypeInfo, updateField, isEmptyValue } from '../fields.js';
import { getField } from '../state.js';
import { openPopover, closePopover } from './dialog.js';
import { toastError } from './toast.js';

export const fieldIcon = (type) => fieldTypeInfo(type).icon;

export function optionById(field, id) {
  return (field?.options || []).find((o) => o.id === id) || null;
}

const PLACEHOLDERS = {
  text: 'Digite…', email: 'nome@exemplo.com', phone: '(11) 99999-9999', url: 'https://…',
  textarea: 'Digite…', number: '0', currency: 'R$ 0,00',
};

// ----------------------------------------------------------------------------
// Resumo compacto para o card no kanban. Retorna '' quando vazio.
// ----------------------------------------------------------------------------
export function fieldSummaryHtml(field, value) {
  if (isEmptyValue(value)) return '';
  const ic = icon(fieldIcon(field.type));
  const wrap = (inner, cls = '') => `<div class="card__field ${cls}" title="${esc(field.name)}">${ic}${inner}</div>`;
  switch (field.type) {
    case 'select': {
      const o = optionById(field, value);
      return o ? wrap(`<span class="chips">${chipHtml(o.label, o.color, { small: true })}</span>`) : '';
    }
    case 'multiselect': {
      const os = (Array.isArray(value) ? value : []).map((id) => optionById(field, id)).filter(Boolean);
      return os.length ? wrap(`<span class="chips">${os.map((o) => chipHtml(o.label, o.color, { small: true })).join('')}</span>`) : '';
    }
    case 'checkbox':
      return value ? `<div class="card__field" title="${esc(field.name)}">${icon('square-check')}<span>${esc(field.name)}</span></div>` : '';
    case 'currency': return wrap(`<span>${esc(formatCurrency(value))}</span>`);
    case 'number': return wrap(`<span>${esc(formatNumber(value))}</span>`);
    case 'date': {
      const d = dateDistance(value);
      return wrap(`<span>${esc(formatDateBR(value))}${d ? ` · ${esc(d.label)}` : ''}</span>`, d?.overdue ? 'is-overdue' : '');
    }
    case 'url': return wrap(`<span>${esc(hostnameOf(value))}</span>`);
    case 'textarea': return wrap(`<span>${esc(String(value).split('\n')[0])}</span>`);
    default: return wrap(`<span>${esc(String(value))}</span>`);
  }
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
    const d = dateDistance(input.value);
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
    if (clear) { closePopover(); onClear?.(); return; }
    const create = e.target.closest('[data-create]');
    if (create) {
      const label = search.value.trim();
      const opt = { id: uid(), label, color: randomPaletteColor() };
      try {
        await updateField(f.id, { options: [...(getField(f.id)?.options || f.options || []), opt] });
      } catch (err) { toastError(err); return; }
      if (multi) { sel.push(opt.id); onToggle?.(opt.id); search.value = ''; paint(); }
      else { closePopover(); onPick?.(opt.id); }
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
      closePopover();
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
