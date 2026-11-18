// Placeholder das seções que ainda não foram construídas ("Em breve").
import { refreshIcons } from '../icons.js';
import { emptyHtml } from '../common.js';
import { getSection } from '../../router.js';

export function mountPlaceholder(container, sectionId, text) {
  container.innerHTML = `<div class="page-placeholder">${emptyHtml({
    icon: getSection(sectionId)?.icon || 'hourglass',
    title: 'Em breve',
    text,
  })}</div>`;
  refreshIcons();
}
