// Formulário de board (criar) + grid de ícones reutilizado nas configurações
import { icon, refreshIcons } from './icons.js';
import { BOARD_ICONS } from '../utils.js';
import { colorGridHtml, bindColorGrid } from './colorPicker.js';
import { openDialog } from './dialog.js';
import { toggleHtml } from './common.js';
import { createBoard } from '../boards.js';
import { toastError } from './toast.js';

export function iconGridHtml(current) {
  return `<div class="icon-grid">${BOARD_ICONS.map((n) => `
    <button type="button" data-icon="${n}" class="${n === current ? 'is-selected' : ''}" title="${n}">${icon(n)}</button>`).join('')}
  </div>`;
}

export function bindIconGrid(root, onPick) {
  root.querySelectorAll('[data-icon]').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll('[data-icon]').forEach((x) => x.classList.toggle('is-selected', x === b));
    onPick(b.dataset.icon);
  }));
}

/** Diálogo "Novo board". Resolve com o board criado ou null. */
export async function openNewBoardDialog() {
  const draft = { name: '', color: '#6366f1', icon: 'kanban', withDefaultColumns: true };
  const dlg = openDialog({
    title: 'Novo board',
    size: 'md',
    body: `
      <div class="form-field">
        <label>Nome</label>
        <input class="input" id="nbName" placeholder="Ex.: Leads Imobiliária" autocomplete="off" />
      </div>
      <div class="form-field">
        <label>Cor</label>
        <div id="nbColor">${colorGridHtml(draft.color, { custom: true })}</div>
      </div>
      <div class="form-field">
        <label>Ícone</label>
        ${iconGridHtml(draft.icon)}
      </div>
      ${toggleHtml({ id: 'nbDefaults', label: 'Começar com as colunas padrão (Lead, Contato feito, Proposta, Ativo, Perdido)', checked: true })}`,
    actions: [
      { label: 'Cancelar', cls: 'btn--ghost', value: null },
      {
        label: 'Criar board', cls: 'btn--primary', value: 'ok',
        onClick: (root) => {
          const name = root.querySelector('#nbName').value.trim();
          if (!name) { root.querySelector('#nbName').focus(); return false; }
          draft.name = name;
          draft.withDefaultColumns = root.querySelector('#nbDefaults').checked;
          return true;
        },
      },
    ],
  });
  const colorHost = dlg.root.querySelector('#nbColor');
  const wireColor = () => bindColorGrid(colorHost, (hex) => {
    draft.color = hex;
    colorHost.innerHTML = colorGridHtml(hex, { custom: true });
    refreshIcons();
    wireColor();
  });
  wireColor();
  bindIconGrid(dlg.root, (n) => { draft.icon = n; });
  dlg.root.querySelector('#nbName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); dlg.root.querySelector('[data-action="1"]').click(); }
  });

  const r = await dlg.result;
  if (r !== 'ok') return null;
  try {
    return await createBoard(draft);
  } catch (e) {
    toastError(e);
    return null;
  }
}

