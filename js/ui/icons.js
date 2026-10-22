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
