// Ícones Lucide. Renderizamos <i data-lucide="nome"> no HTML e depois chamamos
// refreshIcons(), que troca os <i> por <svg>. Removemos o atributo data-lucide
// dos svgs gerados para o próximo refresh não re-renderizar o que já existe.

export function icon(name, cls = '') {
  return `<i data-lucide="${name}" class="ico ${cls}"></i>`;
}

export function refreshIcons() {
  if (!window.lucide?.createIcons) return;
  if (!document.querySelector('i[data-lucide]')) return;
  try {
    window.lucide.createIcons({ attrs: { 'stroke-width': 1.75 } });
  } catch (e) {
    console.warn('lucide', e);
  }
  document.querySelectorAll('svg[data-lucide]').forEach((s) => s.removeAttribute('data-lucide'));
}

/** Ícone padrão de cada tipo de campo (usado quando fields.icon é null). */
export const FIELD_TYPE_ICONS = {
  text: 'type',
  textarea: 'align-left',
  number: 'hash',
  currency: 'banknote',
  date: 'calendar',
  select: 'list',
  multiselect: 'list-checks',
  checkbox: 'check-square',
  url: 'link',
  email: 'mail',
  phone: 'phone',
};

/** Nome do ícone efetivo de um campo: o escolhido pelo usuário ou o padrão do tipo. */
export function fieldIconName(field) {
  return field?.icon || FIELD_TYPE_ICONS[field?.type] || 'type';
}
