// Modal de receita / despesa (criar, editar, excluir). Usado no Financeiro e,
// depois, nos atalhos do Dashboard.
import { icon, refreshIcons } from './icons.js';
import { esc, autoResize, uid } from '../utils.js';
import { openDialog, confirmDialog } from './dialog.js';
import { tagsInput } from './tagsInput.js';
import { moneyInputHtml, bindMoneyInput, moneyValue } from './moneyInput.js';
import { toastError, toastSuccess } from './toast.js';
import { todayYmd } from '../fin/format.js';
import { KINDS, STATUSES, createEntry, updateEntry, deleteEntry } from '../fin/entries.js';

const dayOf = (ymd) => Number(String(ymd || '').slice(8, 10)) || null;

/**
 * openEntryForm({ kind, entry, refs, options, onSaved, onDeleted })
 * kind: 'revenue' | 'expense'. entry = null cria um novo.
 * refs: { clients, revenueCats, expenseCats, costCenters }; options: { tags, suppliers }.
 */
export function openEntryForm({ kind, entry = null, refs, options = { tags: [], suppliers: [] }, onSaved, onDeleted } = {}) {
  const def = KINDS[kind];
  const isRevenue = kind === 'revenue';
  const isNew = !entry;
  const e = entry || { status: 'Pendente', due_date: todayYmd(), tags: [], value: 0, recurring: false };
  const isGenerated = isRevenue && !!e.recurring_parent_id; // cobrança criada pela recorrência

  const opt = (value, label, selected) => `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;
  const clients = [...refs.clients].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const cats = isRevenue ? refs.revenueCats : refs.expenseCats;
  // status antigo (Atrasado/Cancelado) continua escolhível só no lançamento que já o tem
  const statuses = STATUSES.includes(e.status) ? STATUSES : [...STATUSES, e.status];
  const listId = `sup-${uid().slice(0, 8)}`;
  const select = (id, label, items, current, emptyLabel) => `
    <div class="form-field">
      <label for="${id}">${label}</label>
      <select class="select" id="${id}">${opt('', emptyLabel, current == null)}${items.map((x) => opt(x.id, x.name, String(x.id) === String(current))).join('')}</select>
    </div>`;

  const dlg = openDialog({
    title: isNew ? def.newLabel : `Editar ${def.one}`,
    size: 'lg',
    body: `
      <div class="form-field">
        <label for="efDesc">Descrição</label>
        <input class="input" id="efDesc" value="${esc(e.description || '')}" placeholder="${isRevenue ? 'Ex.: Mensalidade de novembro' : 'Ex.: Assinatura da ferramenta'}" autocomplete="off" />
      </div>
      <div class="form-row">
        ${select('efClient', isRevenue ? 'Cliente' : 'Empresa', clients, e.client_id, isRevenue ? 'Sem cliente' : 'Sem empresa')}
        ${isRevenue ? select('efCat', 'Categoria', cats, e.category_id, 'Sem categoria') : `
        <div class="form-field">
          <label for="efSupplier">Fornecedor</label>
          <input class="input" id="efSupplier" list="${listId}" value="${esc(e.supplier || '')}" autocomplete="off" />
          <datalist id="${listId}">${(options.suppliers || []).map((s) => `<option value="${esc(s)}"></option>`).join('')}</datalist>
        </div>`}
      </div>
      ${isRevenue ? '' : `
      <div class="form-row">
        ${select('efCat', 'Categoria', cats, e.category_id, 'Sem categoria')}
        ${select('efCost', 'Centro de custo', refs.costCenters, e.cost_center_id, 'Sem centro de custo')}
      </div>`}
      <div class="form-row">
        <div class="form-field"><label for="efValue">Valor</label>${moneyInputHtml({ id: 'efValue', value: e.value })}</div>
        <div class="form-field">
          <label for="efStatus">Status</label>
          <select class="select" id="efStatus">${statuses.map((s) => opt(s, s, s === e.status)).join('')}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field"><label for="efDate">Data</label><input class="input" id="efDate" type="date" value="${esc(e.due_date || '')}" /></div>
        <div class="form-field"><label for="efPaid">Pagamento</label><input class="input" id="efPaid" type="date" value="${esc(e.paid_date || '')}" /></div>
      </div>
      ${!isRevenue ? '' : isGenerated ? `
      <div class="info-box">${icon('repeat')}<span>Cobrança gerada automaticamente por uma receita recorrente. Para parar as próximas, desligue "Recorrente" na receita original.</span></div>` : `
      <div class="form-field">
        <div class="recurring">
          <label class="toggle"><input type="checkbox" id="efRecurring" ${e.recurring ? 'checked' : ''} /><span class="toggle__track"></span><span>Recorrente</span></label>
          <span class="recurring__day ${e.recurring ? '' : 'hidden'}" id="efDayWrap">todo dia <input class="input input--sm" id="efDay" inputmode="numeric" maxlength="2" value="${esc(e.recurring_day ?? dayOf(e.due_date) ?? '')}" aria-label="Dia do mês" /></span>
        </div>
        <span class="hint">Recorrente cria sozinha a cobrança de cada mês seguinte, como Pendente, com o mesmo valor, cliente, categoria e tags.</span>
      </div>`}
      <div class="form-field"><label>Tags</label><div id="efTags"></div></div>
      <div class="form-field"><label for="efNote">Nota</label><textarea class="textarea" id="efNote" rows="2">${esc(e.note || '')}</textarea></div>`,
    actions: [
      ...(isNew ? [] : [{ label: `${icon('trash-2')} Excluir`, cls: 'btn--danger-ghost dialog__left', onClick: () => { remove(); return false; } }]),
      { label: 'Cancelar', cls: 'btn--ghost', value: null },
      { label: 'Salvar', cls: 'btn--primary', onClick: () => { save(); return false; } },
    ],
  });

  const root = dlg.root;
  const $ = (id) => root.querySelector('#' + id);
  const saveBtn = root.querySelector('.dialog__actions .btn--primary');
  const tags = tagsInput({ value: e.tags, suggestions: options.tags || [] });
  $('efTags').appendChild(tags.el);
  bindMoneyInput($('efValue'));
  const note = $('efNote');
  note.addEventListener('input', () => autoResize(note));
  setTimeout(() => autoResize(note), 0);

  // Pago sem data de pagamento: sugere hoje
  $('efStatus').addEventListener('change', () => {
    if ($('efStatus').value === 'Pago' && !$('efPaid').value) $('efPaid').value = todayYmd();
  });
  const recurring = $('efRecurring');
  if (recurring) {
    recurring.addEventListener('change', () => {
      $('efDayWrap').classList.toggle('hidden', !recurring.checked);
      if (recurring.checked && !$('efDay').value) $('efDay').value = dayOf($('efDate').value) || dayOf(todayYmd());
    });
  }
  root.querySelectorAll('input:not(.tags-input__field):not([type="checkbox"])').forEach((inp) => inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); save(); }
  }));

  let busy = false;
  const setBusy = (b) => {
    busy = b;
    root.querySelectorAll('.dialog__actions .btn').forEach((btn) => { btn.disabled = b; });
    saveBtn.innerHTML = b ? `${icon('loader-circle', 'spin')} Salvando…` : 'Salvar';
    refreshIcons();
  };
  const intOrNull = (v) => (v === '' || v == null ? null : Number(v));

  async function save() {
    if (busy) return;
    const description = $('efDesc').value.trim();
    if (!description) { $('efDesc').focus(); return; }
    const value = moneyValue($('efValue'));
    if (!(value > 0)) { toastError('Informe um valor maior que zero.'); $('efValue').focus(); return; }
    const dueDate = $('efDate').value;
    if (!dueDate) { toastError('Informe a data do lançamento.'); $('efDate').focus(); return; }
    const status = $('efStatus').value;
    const data = {
      description,
      client_id: $('efClient').value || null,
      category_id: intOrNull($('efCat').value),
      value,
      due_date: dueDate,
      paid_date: $('efPaid').value || (status === 'Pago' ? todayYmd() : null),
      status,
      tags: tags.get(),
      note: note.value.trim() || null,
    };
    if (isRevenue) {
      if (recurring) {
        data.recurring = recurring.checked;
        const day = Math.round(Number($('efDay').value));
        if (recurring.checked && !(day >= 1 && day <= 31)) { toastError('O dia da recorrência precisa estar entre 1 e 31.'); $('efDay').focus(); return; }
        // só manda a coluna nova (migration 013) quando ela é necessária
        if (recurring.checked || e.recurring_day != null) data.recurring_day = recurring.checked ? day : null;
      }
    } else {
      data.supplier = $('efSupplier').value.trim() || null;
      data.cost_center_id = intOrNull($('efCost').value);
    }
    setBusy(true);
    try {
      const row = isNew ? await createEntry(kind, data) : await updateEntry(kind, e.id, data);
      dlg.close('saved');
      toastSuccess(isNew ? `${def.title.slice(0, -1)} criada.` : `${def.title.slice(0, -1)} salva.`);
      onSaved?.(row);
    } catch (err) {
      setBusy(false);
      toastError(err);
    }
  }

  async function remove() {
    if (busy) return;
    const ok = await confirmDialog({
      title: `Excluir ${def.one}`,
      message: `Excluir "<b>${esc(e.description)}</b>" definitivamente?${isRevenue && e.recurring ? ' As cobranças que ela já gerou continuam; só param de ser criadas novas.' : ''}`,
      confirmText: 'Excluir',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteEntry(kind, e.id);
      dlg.close('deleted');
      toastSuccess(`${def.title.slice(0, -1)} excluída.`);
      onDeleted?.(e.id);
    } catch (err) {
      setBusy(false);
      toastError(err);
    }
  }

  return dlg;
}
