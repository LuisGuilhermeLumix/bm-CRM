// Seletor de cor: paleta de 12 cores + hex personalizado
import { icon } from './icons.js';
import { PALETTE, esc, normalizeHex } from '../utils.js';
import { openPopover, closePopover } from './dialog.js';

const same = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

export function colorGridHtml(current, { custom = true } = {}) {
  return `<div class="color-picker">
    <div class="color-grid">
      ${PALETTE.map((p) => `
        <button type="button" class="color-swatch ${same(p.hex, current) ? 'is-selected' : ''}" data-hex="${p.hex}" style="--c:${p.hex}" title="${p.name}">
          ${same(p.hex, current) ? icon('check') : ''}
        </button>`).join('')}
    </div>
    ${custom ? `
      <div class="color-custom">
        <input type="color" value="${esc(normalizeHex(current) || '#6366f1')}" data-custom-color title="Cor personalizada" />
        <input class="input input--sm" data-custom-hex value="${esc(current || '')}" placeholder="#hex" maxlength="7" style="width:96px" />
        <span class="hint">Personalizada</span>
      </div>` : ''}
  </div>`;
}

export function bindColorGrid(root, onPick) {
  root.querySelectorAll('[data-hex]').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.hex)));
  const picker = root.querySelector('[data-custom-color]');
  const hex = root.querySelector('[data-custom-hex]');
  if (picker) {
    picker.addEventListener('input', () => { if (hex) hex.value = picker.value; });
    picker.addEventListener('change', () => onPick(picker.value));
  }
  if (hex) {
    const commit = () => { const v = normalizeHex(hex.value); if (v) onPick(v); };
    hex.addEventListener('change', commit);
    hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  }
}

/** opts.nested = abre por cima de outro popover sem fechá-lo */
export function openColorPopover(anchor, current, onPick, opts = {}) {
  const pop = openPopover(anchor, colorGridHtml(current), { cls: 'popover--wide', nested: !!opts.nested });
  bindColorGrid(pop, (hex) => { closePopover(pop); onPick(hex); });
  return pop;
}
