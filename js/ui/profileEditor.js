// Editor de perfil: foto (upload para o bucket "avatars") e nome.
// Fonte única: menu do usuário na sidebar -> "Editar perfil" (o próprio) e
// Configurações → Usuários -> "Editar" (admin editando outro, via RPC).
import { icon, refreshIcons } from './icons.js';
import { esc, initials } from '../utils.js';
import { state, on } from '../state.js';
import { updateProfile, uploadAvatar, removeAvatar } from '../auth.js';
import { openDialog, confirmDialog } from './dialog.js';
import { toastError, toastSuccess } from './toast.js';
import { cropImage } from './imageCropper.js';

const MAX_BYTES = 2 * 1024 * 1024;

/** profileId = outro usuário (só admin); email = e-mail dele, se conhecido. */
export function openProfileEditor(profileId = state.user?.id, { email = null } = {}) {
  const isMe = profileId === state.user?.id;
  const current = () => state.profiles[profileId] || (isMe ? state.profile : null);
  if (!current()) return;
  const shownEmail = isMe ? (state.user?.email || '') : (email || '');
  const dlg = openDialog({
    title: isMe ? 'Editar perfil' : `Editar ${current().name}`,
    size: 'md',
    body: `
      <div class="profile-editor">
        <div class="profile-editor__avatar-wrap">
          <button type="button" class="profile-editor__avatar" id="peAvatar" title="Trocar foto"></button>
          <input type="file" id="peFile" accept="image/*" hidden />
          <div class="profile-editor__actions">
            <button type="button" class="btn btn--sm" id="peUpload">${icon('image-plus', 'ico--sm')} Trocar foto</button>
            <button type="button" class="btn btn--ghost btn--sm" id="peRemove">${icon('trash', 'ico--sm')} Remover foto</button>
          </div>
          <p class="hint">JPG, PNG, GIF ou WebP até 2&nbsp;MB.</p>
        </div>
        <div class="form-field">
          <label for="peName">Nome</label>
          <input class="input" id="peName" value="${esc(current().name)}" autocomplete="${isMe ? 'name' : 'off'}" />
          <p class="hint">O nome é salvo automaticamente ao sair do campo.</p>
        </div>
        ${shownEmail ? `<div class="form-field">
          <label>E-mail</label>
          <input class="input" value="${esc(shownEmail)}" disabled />
        </div>` : ''}
      </div>`,
    actions: [{ label: 'Fechar', cls: '', value: 'close' }],
  });

  const root = dlg.root;
  const avatarBtn = root.querySelector('#peAvatar');
  const file = root.querySelector('#peFile');
  const upload = root.querySelector('#peUpload');
  const remove = root.querySelector('#peRemove');
  const name = root.querySelector('#peName');

  const paintAvatar = () => {
    const p = current();
    if (!p) { avatarBtn.innerHTML = ''; return; }
    if (p.avatar_url) {
      avatarBtn.className = 'profile-editor__avatar has-img';
      avatarBtn.innerHTML = `<img src="${esc(p.avatar_url)}" alt="" /><span class="profile-editor__avatar-edit">${icon('camera', 'ico--sm')}</span>`;
    } else {
      avatarBtn.className = 'profile-editor__avatar';
      avatarBtn.innerHTML = `<span class="profile-editor__initial">${esc(initials(p.name))}</span><span class="profile-editor__avatar-edit">${icon('camera', 'ico--sm')}</span>`;
    }
    remove.disabled = !p.avatar_url;
    refreshIcons();
  };

  const setBusy = (busy) => {
    [avatarBtn, upload, remove, file].forEach((n) => { n.disabled = busy; });
    upload.innerHTML = busy ? `${icon('loader-circle', 'ico--sm spin')} Enviando…` : `${icon('image-plus', 'ico--sm')} Trocar foto`;
    refreshIcons();
  };

  avatarBtn.addEventListener('click', () => file.click());
  upload.addEventListener('click', () => file.click());

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = ''; // permite reescolher o mesmo arquivo
    if (!f) return;
    if (!f.type.startsWith('image/') || f.type === 'image/svg+xml') { toastError(new Error('Envie uma imagem (PNG, JPG, GIF, WebP).')); return; }
    let cropped;
    try { cropped = await cropImage(f, { shape: 'circle' }); } catch (e) { toastError(e); return; }
    if (!cropped) return; // cancelou: não sobe nada
    if (cropped.size > MAX_BYTES) { toastError(new Error('A imagem precisa ter até 2 MB.')); return; }
    setBusy(true);
    try {
      await uploadAvatar(cropped, profileId);
      toastSuccess('Foto atualizada.');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  });

  remove.addEventListener('click', async () => {
    if (!current()?.avatar_url) return;
    const ok = await confirmDialog({ title: 'Remover foto?', message: 'A foto será apagada do servidor e o avatar volta para a inicial colorida.', confirmText: 'Remover' });
    if (!ok) return;
    setBusy(true);
    try {
      await removeAvatar(profileId);
      toastSuccess('Foto removida.');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  });

  const saveName = async () => {
    const v = name.value.trim();
    if (!v || v === current()?.name) { if (!v) name.value = current()?.name || ''; return; }
    try {
      await updateProfile({ name: v }, profileId);
      toastSuccess('Nome atualizado.');
    } catch (e) { toastError(e); name.value = current()?.name || ''; }
  };
  name.addEventListener('blur', saveName);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });

  // Realtime: se o perfil muda (foto subida/removida, ou mudança por outra aba),
  // repinta o avatar e o nome (sem sobrescrever digitação em andamento).
  const off = on('profiles', () => {
    paintAvatar();
    if (document.activeElement !== name) name.value = current()?.name || '';
  });
  dlg.result.then(() => off());

  paintAvatar();
  setTimeout(() => name.focus(), 30);
}
