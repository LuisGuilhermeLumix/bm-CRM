// Modal de usuário (Configurações → Usuários): "Adicionar usuário" (com senha
// inicial, via Edge Function) e "Permissões" (papel + seções, boards e tipos
// de operação, via crm_set_access).
import { icon, refreshIcons } from './icons.js';
import { esc } from '../utils.js';
import { state, sortedBoards } from '../state.js';
import { SECTIONS } from '../router.js';
import { openDialog } from './dialog.js';
import { toastError, toastSuccess } from './toast.js';
import { ADMIN_ONLY_SECTIONS } from '../access.js';
import { createUser, setAccess, randomPassword } from '../fin/users.js';

/** Seções que um member pode receber (as só-admin ficam de fora). */
const MEMBER_SECTIONS = SECTIONS.filter((s) => !ADMIN_ONLY_SECTIONS.includes(s.id));

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/**
 * openUserForm({ profile, access, types, onSaved })
 * profile = null → criar usuário. access = { sections, boards, operation_types } atual.
 */
export function openUserForm({ profile = null, access = null, types = [], onSaved } = {}) {
  const isNew = !profile;
  const isMe = profile?.id === state.user?.id;
  const a = access || { sections: [], boards: [], operation_types: [] };
  const role = profile?.role || 'member';
  const boards = sortedBoards();
  const check = (name, value, label, checked, extra = '') => `
    <label class="check-row"><input type="checkbox" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''} ${extra} /><span>${label}</span></label>`;

  const dlg = openDialog({
    title: isNew ? 'Adicionar usuário' : `Permissões de ${profile.name}`,
    size: 'lg',
    body: `
      ${isNew ? `
      <div class="form-row">
        <div class="form-field"><label for="ufName">Nome</label><input class="input" id="ufName" autocomplete="off" /></div>
        <div class="form-field"><label for="ufEmail">E-mail</label><input class="input" id="ufEmail" type="email" autocomplete="off" /></div>
      </div>
      <div class="form-field">
        <label for="ufPass">Senha inicial</label>
        <div class="secret-input">
          <input class="input" id="ufPass" type="text" autocomplete="new-password" spellcheck="false" placeholder="Mínimo 8 caracteres" />
          <button type="button" class="btn" id="ufGen" title="Gerar senha aleatória">${icon('refresh-cw', 'ico--sm')}<span>Gerar</span></button>
          <button type="button" class="btn btn--icon" id="ufCopy" title="Copiar a senha" aria-label="Copiar a senha">${icon('copy')}</button>
        </div>
        <span class="hint">Passe a senha para a pessoa; ela pode trocar depois pelo "Esqueci a senha".</span>
      </div>` : ''}
      <div class="form-field">
        <label>Papel</label>
        <div class="segmented" role="radiogroup" aria-label="Papel">
          <label class="seg-radio"><input type="radio" name="ufRole" value="admin" ${role === 'admin' ? 'checked' : ''} ${isMe ? 'disabled' : ''} /><span>Administrador</span></label>
          <label class="seg-radio"><input type="radio" name="ufRole" value="member" ${role === 'member' ? 'checked' : ''} ${isMe ? 'disabled' : ''} /><span>Membro</span></label>
        </div>
        <span class="hint">${isMe ? 'Você não pode mudar o seu próprio papel.' : 'Administrador vê e faz tudo. Membro vê só o que for marcado abaixo; em finanças, só lê.'}</span>
      </div>
      <div class="perm-grid" id="ufPerms">
        <fieldset class="perm-box">
          <legend>Seções</legend>
          ${MEMBER_SECTIONS.map((s) => check('section', s.id, esc(s.label), a.sections.includes(s.id))).join('')}
          <p class="hint">Credenciais, Anotações e Configurações são só de administradores.</p>
        </fieldset>
        <fieldset class="perm-box">
          <legend>Boards</legend>
          ${boards.length ? boards.map((b) => check('board', b.id, `<span class="dot" style="--c:${esc(b.color)}"></span>${esc(b.name)}`, a.boards.includes(b.id))).join('') : '<p class="hint">Nenhum board.</p>'}
          <p class="hint">Liberar um board já libera a seção Boards.</p>
        </fieldset>
        <fieldset class="perm-box">
          <legend>Tipos de operação (finanças)</legend>
          ${types.length ? types.map((t) => check('type', t.id, `<span class="dot" style="--c:${esc(t.color)}"></span>${esc(t.name)}`, a.operation_types.includes(t.id))).join('') : '<p class="hint">Nenhum tipo cadastrado.</p>'}
          <p class="hint">Nas seções de finanças, o membro vê só clientes e lançamentos destes tipos. Sem nenhum, não vê nada.</p>
        </fieldset>
      </div>`,
    actions: [
      { label: 'Cancelar', cls: 'btn--ghost', value: null },
      { label: isNew ? 'Criar usuário' : 'Salvar', cls: 'btn--primary', onClick: () => { save(); return false; } },
    ],
  });

  const root = dlg.root;
  const $ = (id) => root.querySelector('#' + id);
  const saveBtn = root.querySelector('.dialog__actions .btn--primary');
  const currentRole = () => root.querySelector('input[name="ufRole"]:checked')?.value || role;
  const syncPerms = () => { $('ufPerms').classList.toggle('is-disabled', currentRole() === 'admin'); };
  root.querySelectorAll('input[name="ufRole"]').forEach((r) => r.addEventListener('change', syncPerms));
  syncPerms();

  if (isNew) {
    $('ufGen').addEventListener('click', () => { $('ufPass').value = randomPassword(); });
    $('ufCopy').addEventListener('click', async () => {
      if (!$('ufPass').value) return;
      if (await copyText($('ufPass').value)) toastSuccess('Senha copiada.'); else toastError('O navegador não deixou copiar.');
    });
    $('ufPass').value = randomPassword();
  }

  const values = (name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
  let busy = false;
  async function save() {
    if (busy) return;
    const r = currentRole();
    const acc = r === 'admin' ? { sections: [], boards: [], operation_types: [] }
      : { sections: values('section'), boards: values('board'), operation_types: values('type') };
    let payload;
    if (isNew) {
      payload = { name: $('ufName').value.trim(), email: $('ufEmail').value.trim(), password: $('ufPass').value };
      if (!payload.name) { $('ufName').focus(); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) { toastError('Informe um e-mail válido.'); $('ufEmail').focus(); return; }
      if (payload.password.length < 8) { toastError('A senha precisa ter pelo menos 8 caracteres.'); $('ufPass').focus(); return; }
    }
    busy = true;
    root.querySelectorAll('.dialog__actions .btn').forEach((b) => { b.disabled = true; });
    saveBtn.innerHTML = `${icon('loader-circle', 'spin')} ${isNew ? 'Criando…' : 'Salvando…'}`;
    refreshIcons();
    try {
      if (isNew) {
        await createUser({ ...payload, role: r, access: acc });
        toastSuccess(`Usuário ${payload.email} criado.`);
      } else {
        await setAccess(profile.id, r, acc);
        toastSuccess('Permissões salvas.');
      }
      dlg.close('saved');
      onSaved?.();
    } catch (e) {
      busy = false;
      root.querySelectorAll('.dialog__actions .btn').forEach((b) => { b.disabled = false; });
      saveBtn.textContent = isNew ? 'Criar usuário' : 'Salvar';
      toastError(e);
    }
  }
  return dlg;
}
