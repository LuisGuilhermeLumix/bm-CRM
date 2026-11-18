// Modal de cliente (criar / editar / excluir). Usado na seção Clientes e no
// atalho "Novo cliente" do Dashboard. Entidades internas (Lumix, Lumix REC)
// não passam por aqui: são editadas em Configurações → Empresa.
import { icon, refreshIcons } from './icons.js';
import { esc, autoResize } from '../utils.js';
import { state } from '../state.js';
import { openDialog, confirmDialog } from './dialog.js';
import { openColorPopover } from './colorPicker.js';
import { clientAvatarHtml } from './common.js';
import { logoFileInputHtml, bindLogoUpload } from './logoUpload.js';
import { moneyInputHtml, bindMoneyInput, moneyValue } from './moneyInput.js';
import { toastError, toastSuccess } from './toast.js';
import { STAGES, stageOf } from '../fin/format.js';
import { createClient, updateClient, deleteClient, clientLinks } from '../fin/clients.js';

const DEFAULT_LOGO = '#8b6cf6';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * openClientForm({ client, types, onSaved, onDeleted })
 * client = null cria um novo. types = fin_operation_types já carregados.
 * onSaved também é chamado quando só a logo muda (o modal continua aberto).
 */
export function openClientForm({ client = null, types = [], onSaved, onDeleted } = {}) {
  const isNew = !client;
  // cópia local: a logo e a cor mudam antes do "Salvar"
  const c = { stage: 'lead', logo_bg: DEFAULT_LOGO, mrr: 0, ...(client || {}) };
  c.logo_bg = c.logo_bg || DEFAULT_LOGO;

  // tipos ativos + o tipo atual do cliente, mesmo que esteja oculto
  const typeOptions = types.filter((t) => t.active || t.id === c.operation_type_id);
  // responsáveis: perfis liberados + o atual, mesmo que tenha sido bloqueado
  const owners = Object.values(state.profiles)
    .filter((p) => p.allowed !== false || p.id === c.owner_id)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const opt = (value, label, selected) => `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;

  const dlg = openDialog({
    title: isNew ? 'Novo cliente' : 'Editar cliente',
    size: 'lg',
    body: `
      <div class="form-row form-row--logo">
        <div class="form-field form-field--fit">
          <label>Logo</label>
          <button type="button" class="logo-btn" id="cfLogo" ${isNew ? 'disabled' : ''} title="${isNew ? 'Salve o cliente para adicionar a logo' : 'Enviar logo (PNG, JPG, WebP ou SVG, até 2 MB)'}"></button>
          ${logoFileInputHtml('id="cfLogoFile"')}
        </div>
        <div class="form-field">
          <label for="cfName">Nome</label>
          <input class="input" id="cfName" value="${esc(c.name || '')}" placeholder="Nome do cliente" autocomplete="off" />
        </div>
      </div>
      <div class="logo-actions">
        ${isNew ? `<span class="hint">Salve para adicionar a logo.</span>` : `
          <button type="button" class="btn btn--sm" id="cfLogoPick">${icon('image-plus', 'ico--sm')} <span id="cfLogoPickText"></span></button>
          <button type="button" class="btn btn--ghost btn--sm" id="cfLogoRemove">${icon('trash', 'ico--sm')} Remover logo</button>`}
        <span class="logo-actions__color">
          <button type="button" class="color-btn color-btn--sm" id="cfColor" style="--c:${esc(c.logo_bg)}" title="Cor de fundo da logo"></button>
          <span class="hint">Cor de fundo</span>
        </span>
      </div>
      <div class="form-row">
        <div class="form-field"><label for="cfContact">Contato</label><input class="input" id="cfContact" value="${esc(c.contact || '')}" placeholder="Nome da pessoa" autocomplete="off" /></div>
        <div class="form-field"><label for="cfRole">Cargo</label><input class="input" id="cfRole" value="${esc(c.contact_role || '')}" autocomplete="off" /></div>
      </div>
      <div class="form-row">
        <div class="form-field"><label for="cfPhone">Telefone</label><input class="input" id="cfPhone" type="tel" value="${esc(c.phone || '')}" autocomplete="off" /></div>
        <div class="form-field">
          <label for="cfOwner">Responsável</label>
          <select class="select" id="cfOwner">${opt('', 'Sem responsável', !c.owner_id)}${owners.map((p) => opt(p.id, p.name, p.id === c.owner_id)).join('')}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="cfStage">Estágio</label>
          <select class="select" id="cfStage">${STAGES.map((s) => opt(s.id, s.label, s.id === c.stage)).join('')}</select>
        </div>
        <div class="form-field">
          <label for="cfType">Tipo de operação</label>
          <select class="select" id="cfType">${opt('', 'Sem tipo', !c.operation_type_id)}${typeOptions.map((t) => opt(t.id, t.name, t.id === c.operation_type_id)).join('')}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field"><label for="cfMrr">MRR (receita mensal)</label>${moneyInputHtml({ id: 'cfMrr', value: c.mrr, label: 'MRR em reais' })}</div>
        <div class="form-field"><label for="cfSince">Cliente desde</label><input class="input" id="cfSince" type="date" value="${esc(c.since || '')}" /></div>
      </div>
      <div class="form-field"><label for="cfNotes">Observações</label><textarea class="textarea" id="cfNotes" rows="2">${esc(c.notes || '')}</textarea></div>`,
    actions: [
      ...(isNew ? [] : [{ label: `${icon('trash-2')} Excluir`, cls: 'btn--danger-ghost dialog__left', onClick: () => { remove(); return false; } }]),
      { label: 'Cancelar', cls: 'btn--ghost', value: null },
      { label: 'Salvar', cls: 'btn--primary', onClick: () => { save(); return false; } },
    ],
  });

  const root = dlg.root;
  const $ = (id) => root.querySelector('#' + id);
  const nameInput = $('cfName');
  const logoBtn = $('cfLogo');
  const saveBtn = root.querySelector('.dialog__actions .btn--primary');
  bindMoneyInput($('cfMrr'));
  const notes = $('cfNotes');
  notes.addEventListener('input', () => autoResize(notes));
  setTimeout(() => autoResize(notes), 0);

  const paintLogo = () => {
    logoBtn.innerHTML = clientAvatarHtml({ ...c, name: nameInput.value.trim() || '?' }, 'lg');
    $('cfColor').style.setProperty('--c', c.logo_bg);
    if (!isNew) {
      $('cfLogoPickText').textContent = c.logo_url ? 'Trocar logo' : 'Enviar logo';
      $('cfLogoRemove').classList.toggle('hidden', !c.logo_url);
    }
  };
  paintLogo();
  nameInput.addEventListener('input', paintLogo);
  $('cfColor').addEventListener('click', (e) => openColorPopover(e.currentTarget, c.logo_bg, (hex) => { c.logo_bg = hex; paintLogo(); }));
  root.querySelectorAll('input:not([type="file"])').forEach((inp) => inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
  }));

  let busy = false;
  const setBusy = (b, label = 'Salvando…') => {
    busy = b;
    root.querySelectorAll('.dialog__actions .btn, .logo-actions .btn, #cfLogo').forEach((btn) => { btn.disabled = b || (isNew && btn.id === 'cfLogo'); });
    saveBtn.innerHTML = b ? `${icon('loader-circle', 'spin')} ${label}` : 'Salvar';
    refreshIcons();
  };

  if (!isNew) {
    bindLogoUpload({
      input: $('cfLogoFile'),
      triggers: [logoBtn, $('cfLogoPick')],
      removeBtn: $('cfLogoRemove'),
      getClient: () => c,
      setBusy: (b) => setBusy(b, 'Enviando…'),
      // a logo é gravada na hora; o resto do formulário continua em edição
      onChange: (row) => { c.logo_url = row.logo_url; paintLogo(); onSaved?.(row); },
    });
  }

  async function save() {
    if (busy) return;
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const stage = $('cfStage').value;
    const data = {
      name,
      contact: $('cfContact').value.trim() || null,
      contact_role: $('cfRole').value.trim() || null,
      phone: $('cfPhone').value.trim() || null,
      stage,
      operation_type_id: $('cfType').value || null,
      mrr: moneyValue($('cfMrr')),
      since: $('cfSince').value || null,
      owner_id: $('cfOwner').value || null,
      logo_bg: c.logo_bg,
      notes: notes.value.trim() || null,
    };
    // `status` é o rótulo legado do sistema antigo: acompanha o estágio quando ele muda
    if (isNew || stage !== client.stage) data.status = stageOf(stage).label;
    setBusy(true);
    try {
      const row = isNew ? await createClient(data) : await updateClient(c.id, data);
      dlg.close('saved');
      toastSuccess(isNew ? 'Cliente criado.' : 'Cliente salvo.');
      onSaved?.(row);
    } catch (e) {
      setBusy(false);
      toastError(e);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    let links;
    try {
      links = await clientLinks(c.id);
    } catch (e) {
      setBusy(false);
      toastError(e);
      return;
    }
    setBusy(false);
    if (links.revenues || links.expenses) {
      const parts = [];
      if (links.revenues) parts.push(`<b>${plural(links.revenues, 'receita', 'receitas')}</b>`);
      if (links.expenses) parts.push(`<b>${plural(links.expenses, 'despesa', 'despesas')}</b>`);
      const total = links.revenues + links.expenses;
      openDialog({
        title: 'Não dá para excluir',
        body: `<p>"<b>${esc(c.name)}</b>" tem ${parts.join(' e ')} ${total === 1 ? 'vinculada' : 'vinculadas'}.</p>
               <p>Para tirar o cliente do dia a dia sem perder o histórico, mude o estágio para <b>Encerrado</b> ou <b>Cancelado</b>.</p>`,
        actions: [{ label: 'Entendi', cls: 'btn--primary', value: null }],
      });
      return;
    }
    const ok = await confirmDialog({
      title: 'Excluir cliente',
      message: `Excluir "<b>${esc(c.name)}</b>" definitivamente? Não há receitas nem despesas vinculadas.`,
      confirmText: 'Excluir',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteClient(c.id); // apaga também a logo do bucket
      dlg.close('deleted');
      toastSuccess('Cliente excluído.');
      onDeleted?.(c.id);
    } catch (e) {
      setBusy(false);
      toastError(e);
    }
  }

  return dlg;
}
