// Diálogos (confirmação / prompt / custom) e popovers (menus flutuantes).
// Também mantém a pilha de "coisas fecháveis" usada pelo Esc global.
//
// Camadas: cada diálogo/popover aberto recebe um número de sequência crescente
// (data-layer-seq) e um z-index crescente. Assim um popover aberto de dentro
// de um diálogo fica por cima dele, e um diálogo de confirmação aberto de
// dentro de um popover fica por cima do popover. Um clique numa camada mais
// nova nunca fecha uma camada mais antiga.
import { icon, refreshIcons } from './icons.js';
import { esc, el } from '../utils.js';

const layers = () => document.getElementById('layers');

let layerSeq = 0;
const Z_BASE = 600;
function nextLayer(node) {
  const seq = ++layerSeq;
  node.dataset.layerSeq = String(seq);
  node.style.zIndex = String(Z_BASE + seq);
  return seq;
}
const seqOf = (target) => Number(target?.closest?.('[data-layer-seq]')?.dataset.layerSeq || 0);

// --- Pilha de fecháveis (Esc fecha o topo) ----------------------------------
const closables = [];
export function pushClosable(fn) { closables.push(fn); return () => removeClosable(fn); }
export function removeClosable(fn) {
  const i = closables.lastIndexOf(fn);
  if (i !== -1) closables.splice(i, 1);
}
export function closeTop() {
  const fn = closables[closables.length - 1];
  if (!fn) return false;
  fn();
  return true;
}
export function hasOpenLayers() { return closables.length > 0; }

// --- Dialog genérico ---------------------------------------------------------

/**
 * openDialog({ title, body (html), actions: [{label, cls, value, onClick}], size })
 * Retorna { root, close, result } onde result é uma Promise com o value da ação
 * clicada (ou null se fechado por Esc/backdrop).
 */
export function openDialog({ title, body = '', actions = [], size = '', danger = false, closeOnBackdrop = true }) {
  let resolve;
  const result = new Promise((r) => (resolve = r));
  const backdrop = el(`
    <div class="dialog-backdrop" role="dialog" aria-modal="true">
      <div class="dialog ${size ? 'dialog--' + size : ''}">
        ${title ? `<h2 class="dialog__title">${danger ? icon('triangle-alert') : ''}${esc(title)}</h2>` : ''}
        <div class="dialog__body">${body}</div>
        ${actions.length ? `<div class="dialog__actions">${actions.map((a, i) => `
          <button class="btn ${a.cls || ''}" data-action="${i}">${a.label}</button>`).join('')}</div>` : ''}
      </div>
    </div>`);
  nextLayer(backdrop);
  layers().appendChild(backdrop);
  refreshIcons();

  let closed = false;
  const close = (value = null) => {
    if (closed) return;
    closed = true;
    removeClosable(onEsc);
    backdrop.remove();
    resolve(value);
  };
  const onEsc = () => close(null);
  pushClosable(onEsc);

  backdrop.addEventListener('mousedown', (e) => {
    if (closeOnBackdrop && e.target === backdrop) close(null);
  });
  backdrop.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const a = actions[Number(btn.dataset.action)];
      if (a.onClick) {
        const r = a.onClick(backdrop);
        if (r === false) return;
      }
      close(a.value ?? a.label);
    });
  });

  const first = backdrop.querySelector('input, textarea, select, button.btn--primary, button.btn--danger');
  setTimeout(() => first?.focus(), 30);

  return { root: backdrop, close, result };
}

/** Confirmação destrutiva. requireText => usuário precisa digitar o texto. */
export async function confirmDialog({
  title = 'Confirmar',
  message = '',
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  danger = true,
  requireText = null,
}) {
  const body = `
    ${message ? `<p>${message}</p>` : ''}
    ${requireText ? `
      <div class="form-field">
        <label>Digite <b>${esc(requireText)}</b> para confirmar</label>
        <input class="input" id="dlgConfirmText" autocomplete="off" />
      </div>` : ''}`;
  const dlg = openDialog({
    title, body, danger,
    actions: [
      { label: cancelText, cls: 'btn--ghost', value: false },
      { label: confirmText, cls: danger ? 'btn--danger' : 'btn--primary', value: true },
    ],
  });
  if (requireText) {
    const input = dlg.root.querySelector('#dlgConfirmText');
    const btn = dlg.root.querySelector('[data-action="1"]');
    btn.disabled = true;
    input.addEventListener('input', () => { btn.disabled = input.value.trim() !== requireText; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btn.disabled) btn.click(); });
  } else {
    dlg.root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); dlg.root.querySelector('[data-action="1"]').click(); }
    });
  }
  return (await dlg.result) === true;
}

/** Prompt simples: retorna string ou null. */
export async function promptDialog({ title, label = '', value = '', placeholder = '', type = 'text', confirmText = 'Salvar', hint = '' }) {
  const dlg = openDialog({
    title,
    body: `
      <div class="form-field">
        ${label ? `<label>${esc(label)}</label>` : ''}
        <input class="input" id="dlgPrompt" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" />
        ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
      </div>`,
    actions: [
      { label: 'Cancelar', cls: 'btn--ghost', value: null },
      { label: confirmText, cls: 'btn--primary', value: 'ok' },
    ],
  });
  const input = dlg.root.querySelector('#dlgPrompt');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); dlg.root.querySelector('[data-action="1"]').click(); }
  });
  setTimeout(() => { input.focus(); input.select(); }, 30);
  const r = await dlg.result;
  return r === 'ok' ? input.value : null;
}

// --- Popover -----------------------------------------------------------------
// Pilha: popovers "aninhados" (opts.nested) abrem por cima do anterior sem
// fechá-lo (ex.: seletor de cor dentro do editor de campo). Sem `nested`, abrir
// um popover fecha todos os outros (comportamento de menu).

const popStack = []; // { el, seq, cleanup }

/** Fecha o popover indicado (ou o do topo) e todos os que estiverem acima dele. */
export function closePopover(target = null) {
  if (!popStack.length) return;
  let idx = popStack.length - 1;
  if (target) {
    idx = popStack.findIndex((p) => p.el === target || p.el.contains(target));
    if (idx === -1) return;
  }
  const removed = popStack.splice(idx);
  removed.reverse().forEach((p) => { p.cleanup?.(); p.el.remove(); });
}

export function closeAllPopovers() {
  if (popStack.length) closePopover(popStack[0].el);
}

export function isInsidePopover(node) {
  return popStack.some((p) => p.el.contains(node));
}

/**
 * Abre um popover ancorado em `anchor`. `html` é o conteúdo. Retorna o elemento.
 * opts: align ('start'|'end'), cls, nested, onClose
 */
export function openPopover(anchor, html, opts = {}) {
  if (!opts.nested) closeAllPopovers();
  const pop = el(`<div class="popover ${opts.cls || ''}">${html}</div>`);
  const seq = nextLayer(pop);
  layers().appendChild(pop);
  refreshIcons();
  const entry = { el: pop, seq };
  popStack.push(entry);
  anchor.setAttribute?.('aria-expanded', 'true');

  const position = () => {
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = opts.align === 'end' ? r.right - pw : r.left;
    let top = r.bottom + 6;
    if (left + pw > vw - 8) left = vw - pw - 8;
    if (left < 8) left = 8;
    if (top + ph > vh - 8) {
      const above = r.top - ph - 6;
      top = above >= 8 ? above : Math.max(8, vh - ph - 8);
    }
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  };
  position();

  const onDown = (e) => {
    if (pop.contains(e.target) || anchor.contains?.(e.target)) return;
    if (seqOf(e.target) > seq) return; // clique numa camada mais nova (popover aninhado, diálogo)
    closePopover(pop);
  };
  const onEsc = () => closePopover(pop);
  setTimeout(() => document.addEventListener('mousedown', onDown), 0);
  window.addEventListener('resize', position);
  document.addEventListener('scroll', position, true);
  // Reposiciona quando o conteúdo cresce (ex.: adicionar opções no editor de
  // campo) — senão o popover passa do fim da tela e o scroll interno não entra.
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(position) : null;
  ro?.observe(pop);
  pushClosable(onEsc);
  entry.cleanup = () => {
    document.removeEventListener('mousedown', onDown);
    window.removeEventListener('resize', position);
    document.removeEventListener('scroll', position, true);
    ro?.disconnect();
    removeClosable(onEsc);
    anchor.setAttribute?.('aria-expanded', 'false');
    opts.onClose?.();
  };
  const focusable = pop.querySelector('input, [autofocus]');
  if (focusable) setTimeout(() => focusable.focus(), 20);
  return pop;
}

/** Menu de ações: items [{label, icon, color, value, danger, selected, disabled}, 'sep', {label, header:true}] */
export function openMenu(anchor, items, onSelect, opts = {}) {
  const html = `<div class="menu">${items.map((it, i) => {
    if (it === 'sep') return '<div class="menu__sep"></div>';
    if (it.header) return `<div class="menu__label">${esc(it.label)}</div>`;
    return `<button type="button" class="menu__item ${it.danger ? 'menu__item--danger' : ''} ${it.selected ? 'is-selected' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>
      ${it.icon ? icon(it.icon) : (it.color ? `<span class="dot" style="--c:${esc(it.color)}"></span>` : '')}
      <span class="grow truncate">${esc(it.label)}</span>
      ${it.selected ? icon('check', 'check ico--sm') : ''}
    </button>`;
  }).join('')}</div>`;
  const pop = openPopover(anchor, html, opts);
  pop.querySelectorAll('.menu__item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const it = items[Number(btn.dataset.i)];
      closePopover(pop);
      onSelect(it.value ?? it.label, it);
    });
  });
  return pop;
}
