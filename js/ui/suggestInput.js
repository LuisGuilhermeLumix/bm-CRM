// Sugestões ao digitar num <input>: popover com o que já foi usado, filtrado
// por "contém" (sem acento, sem caixa). ↑/↓ + Enter escolhem, Tab aceita a
// primeira, Esc fecha, clique preenche. Usado no campo Descrição dos lançamentos.
import { esc } from '../utils.js';
import { openPopover, closePopover } from './dialog.js';
import { fold } from '../fin/format.js';

/** Descrição como vai para o banco: espaços normalizados e em MAIÚSCULO. */
export const normalizeDescription = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * bindSuggestions(input, getItems, { max, onPick })
 * getItems() → [{ text, n }] já ordenado por frequência (mais usadas primeiro).
 * Chame ANTES de ligar outros keydown no input: um Enter que escolhe sugestão
 * sai com defaultPrevented, para o formulário não salvar junto.
 */
export function bindSuggestions(input, getItems, { max = 8, onPick } = {}) {
  let pop = null;
  let items = [];
  let active = -1;

  const close = () => {
    active = -1;
    if (!pop) return;
    const p = pop;
    pop = null;
    closePopover(p);
  };

  const matches = () => {
    const q = fold(input.value.trim());
    if (!q) return [];
    // quem digitou exatamente uma descrição existente não precisa de sugestão dela
    return (getItems() || []).filter((it) => { const t = fold(it.text); return t.includes(q) && t !== q; }).slice(0, max);
  };

  const paint = () => {
    pop.querySelector('.menu').innerHTML = items.map((it, i) => `
      <button type="button" class="menu__item ${i === active ? 'is-selected' : ''}" data-i="${i}" tabindex="-1">
        <span class="grow truncate">${esc(it.text)}</span>
        ${it.n > 1 ? `<span class="subtle">${it.n}×</span>` : ''}
      </button>`).join('');
  };

  const pick = (it) => {
    input.value = it.text;
    close();
    onPick?.(it);
  };

  const update = () => {
    items = matches();
    active = -1;
    if (!items.length) { close(); return; }
    if (!pop) {
      pop = openPopover(input, '<div class="menu" role="listbox"></div>', { cls: 'popover--suggest', onClose: () => { pop = null; active = -1; } });
      pop.style.width = `${input.offsetWidth}px`;
      pop.addEventListener('mousedown', (e) => e.preventDefault()); // o clique não tira o foco do campo
      pop.addEventListener('click', (e) => {
        const b = e.target.closest('[data-i]');
        if (b) pick(items[Number(b.dataset.i)]);
      });
    }
    paint();
  };

  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (!pop || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length + (active === -1 && e.key === 'ArrowUp' ? 1 : 0)) % items.length;
      paint();
      pop.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === 'Tab') {
      pick(items[Math.max(0, active)]); // sem preventDefault: o foco segue para o próximo campo
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // fecha só as sugestões, não o modal
      close();
    }
  });
  input.addEventListener('blur', close);

  return { close };
}
