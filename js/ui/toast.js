import { icon, refreshIcons } from './icons.js';
import { esc, el } from '../utils.js';

const ICONS = { success: 'circle-check', error: 'circle-alert', info: 'info', warning: 'triangle-alert' };

export function toast(message, { type = 'info', duration = 3500 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = el(`
    <div class="toast toast--${type}" role="status">
      ${icon(ICONS[type] || 'info')}
      <div class="grow">${esc(message)}</div>
      <button class="toast__close" aria-label="Fechar">${icon('x', 'ico--sm')}</button>
    </div>`);
  host.appendChild(node);
  refreshIcons();
  const remove = () => {
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 200);
  };
  node.querySelector('.toast__close').addEventListener('click', remove);
  if (duration > 0) setTimeout(remove, duration);
  return remove;
}

export const toastSuccess = (m) => toast(m, { type: 'success' });
export const toastError = (e) => toast(typeof e === 'string' ? e : (e?.message || 'Algo deu errado.'), { type: 'error', duration: 5000 });
