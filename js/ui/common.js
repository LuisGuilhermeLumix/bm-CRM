// Pedaços de HTML reutilizados em vários lugares
import { icon } from './icons.js';
import { esc, initials } from '../utils.js';

/** Logo completa da Lumix: as duas versões vão no HTML e o CSS mostra a do tema atual. */
export function brandLogoHtml(cls = '') {
  return `<img class="brand__full brand__full--dark ${cls}" src="assets/lumix-logo-full.png" alt="Lumix" /><img class="brand__full brand__full--light ${cls}" src="assets/lumix-logo-full-light.png" alt="Lumix" />`;
}

export function chipHtml(label, color, { removable = false, id = '', small = false, title = '' } = {}) {
  return `<span class="chip ${small ? 'chip--sm' : ''}" style="--c:${esc(color || '#6b7280')}" ${id ? `data-id="${esc(id)}"` : ''} ${title ? `title="${esc(title)}"` : ''}>
    <span class="truncate">${esc(label)}</span>
    ${removable ? `<button type="button" class="chip__x" data-remove="${esc(id)}" aria-label="Remover ${esc(label)}">${icon('x')}</button>` : ''}
  </span>`;
}

export function avatarHtml(profile, size = '') {
  const cls = `avatar ${size ? 'avatar--' + size : ''}`;
  if (!profile) return `<span class="${cls} avatar--unknown" title="Usuário removido">?</span>`;
  if (profile.avatar_url) {
    return `<span class="${cls} avatar--img" title="${esc(profile.name)}"><img src="${esc(profile.avatar_url)}" alt="" /></span>`;
  }
  // avatar_color continua no banco, mas o fundo vem do degradê Lumix (CSS)
  return `<span class="${cls}" title="${esc(profile.name)}">${esc(initials(profile.name))}</span>`;
}

/**
 * Logo de um cliente ou entidade interna: a imagem (logo_url) ou, sem ela, a
 * inicial do nome sobre logo_bg. size: '' (28px) | 'lg' (36px) | 'xl' (56px).
 */
export function clientAvatarHtml(client, size = '') {
  const cls = `client-logo ${size ? 'client-logo--' + size : ''}`;
  const bg = esc(client?.logo_bg || '#8b6cf6');
  if (client?.logo_url) {
    return `<span class="${cls} client-logo--img" style="--c:${bg}"><img src="${esc(client.logo_url)}" alt="" loading="lazy" /></span>`;
  }
  return `<span class="${cls}" style="--c:${bg}">${esc(initials(client?.name || '?').slice(0, 1))}</span>`;
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
