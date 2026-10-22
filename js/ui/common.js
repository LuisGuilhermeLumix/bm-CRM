// Pedaços de HTML reutilizados em vários lugares
import { icon } from './icons.js';
import { esc, initials } from '../utils.js';

export function chipHtml(label, color, { removable = false, id = '', small = false, title = '' } = {}) {
  return `<span class="chip ${small ? 'chip--sm' : ''}" style="--c:${esc(color || '#6b7280')}" ${id ? `data-id="${esc(id)}"` : ''} ${title ? `title="${esc(title)}"` : ''}>
    <span class="truncate">${esc(label)}</span>
    ${removable ? `<button type="button" class="chip__x" data-remove="${esc(id)}" aria-label="Remover ${esc(label)}">${icon('x')}</button>` : ''}
  </span>`;
}

export function avatarHtml(profile, size = '') {
  if (!profile) return `<span class="avatar ${size ? 'avatar--' + size : ''}" style="--c:#6b7280" title="Usuário removido">?</span>`;
  return `<span class="avatar ${size ? 'avatar--' + size : ''}" style="--c:${esc(profile.avatar_color || '#6366f1')}" title="${esc(profile.name)}">${esc(initials(profile.name))}</span>`;
}

export function emptyHtml({ icon: ic = 'inbox', title = '', text = '', action = '', small = false }) {
  return `<div class="empty ${small ? 'empty--sm' : ''}">
    ${icon(ic)}
    ${title ? `<h3>${esc(title)}</h3>` : ''}
    ${text ? `<p>${esc(text)}</p>` : ''}
    ${action}
  </div>`;
}

export function toggleHtml({ id, label, checked = false, name = '' }) {
  return `<label class="toggle">
    <input type="checkbox" ${id ? `id="${id}"` : ''} ${name ? `name="${name}"` : ''} ${checked ? 'checked' : ''} />
    <span class="toggle__track"></span>
    <span>${esc(label)}</span>
  </label>`;
}
