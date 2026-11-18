// Campo de tags livres (text[]): chips removíveis + digitação.
// Enter ou vírgula adiciona; Backspace no campo vazio remove a última.
import { PALETTE, esc, el, uid } from '../utils.js';
import { refreshIcons } from './icons.js';
import { chipHtml } from './common.js';

/** Cor estável por nome: a mesma tag tem sempre a mesma cor, em qualquer tela. */
export function tagColor(name) {
  let h = 0;
  for (const ch of String(name).toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length].hex;
}

/** Chips (só leitura) de uma lista de tags. */
export function tagChipsHtml(tags, { small = true } = {}) {
  return (tags || []).map((t) => chipHtml(t, tagColor(t), { small })).join('');
}

/**
 * tagsInput({ value, suggestions, placeholder, onChange }) → { el, get() }
 * `suggestions` vira um <datalist> (tags já usadas em outros registros).
 */
export function tagsInput({ value = [], suggestions = [], placeholder = 'Adicionar tag…', onChange } = {}) {
  let tags = [...new Set((value || []).map((t) => String(t).trim()).filter(Boolean))];
  const listId = `tags-${uid().slice(0, 8)}`;
  const root = el(`
    <div class="tags-input">
      <span class="tags-input__chips"></span>
      <input class="tags-input__field" list="${listId}" placeholder="${esc(placeholder)}" autocomplete="off" aria-label="Adicionar tag" />
      <datalist id="${listId}">${[...new Set(suggestions)].sort((a, b) => a.localeCompare(b, 'pt-BR')).map((s) => `<option value="${esc(s)}"></option>`).join('')}</datalist>
    </div>`);
  const chips = root.querySelector('.tags-input__chips');
  const field = root.querySelector('.tags-input__field');

  const paint = () => {
    chips.innerHTML = tags.map((t) => chipHtml(t, tagColor(t), { removable: true, id: t })).join('');
    refreshIcons();
  };
  const changed = () => { paint(); onChange?.([...tags]); };
  const add = (raw) => {
    const parts = String(raw).split(',').map((t) => t.trim()).filter(Boolean);
    const before = tags.length;
    parts.forEach((t) => { if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t); });
    field.value = '';
    if (tags.length !== before) changed();
  };

  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      if (field.value.trim()) { e.preventDefault(); e.stopPropagation(); add(field.value); }
      else if (e.key === ',') e.preventDefault();
    } else if (e.key === 'Backspace' && !field.value && tags.length) {
      tags.pop();
      changed();
    }
  });
  // escolher uma sugestão do datalist ou colar "a, b"
  field.addEventListener('input', () => { if (field.value.includes(',')) add(field.value); });
  field.addEventListener('change', () => { if (field.value.trim()) add(field.value); });
  root.addEventListener('click', (e) => {
    const x = e.target.closest('[data-remove]');
    if (x) { tags = tags.filter((t) => t !== x.dataset.remove); changed(); return; }
    if (e.target === root || e.target === chips) field.focus();
  });

  paint();
  return {
    el: root,
    get() { if (field.value.trim()) add(field.value); return [...tags]; },
  };
}
