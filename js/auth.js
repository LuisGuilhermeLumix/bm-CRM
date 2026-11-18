// Login / logout / sessão / perfis
import { sb, run, friendlyError, AppError } from './supabase.js';
import { state, emit } from './state.js';

export async function getSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw new AppError(friendlyError(error), error);
  return data.session;
}

export function onAuthChange(cb) {
  const { data } = sb.auth.onAuthStateChange((event, session) => cb(event, session));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new AppError(friendlyError(error), error);
  return data.session;
}

export async function signOut() {
  const { error } = await sb.auth.signOut();
  if (error) throw new AppError(friendlyError(error), error);
}

/** Envia o e-mail de recuperação. O link volta para esta mesma página. */
export async function resetPassword(email) {
  const redirectTo = location.origin + location.pathname;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw new AppError(friendlyError(error), error);
}

export async function updatePassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw new AppError(friendlyError(error), error);
}

export async function loadProfiles() {
  const rows = await run(sb.from('profiles').select('*'));
  state.profiles = Object.fromEntries(rows.map((r) => [r.id, r]));
  state.profile = state.profiles[state.user?.id] || null;
  // Se por algum motivo o profile ainda não existe (trigger não rodou), cria um.
  if (state.user && !state.profile) {
    const name = state.user.user_metadata?.name || state.user.email.split('@')[0];
    const row = await run(sb.from('profiles').upsert({ id: state.user.id, name }).select().single());
    state.profiles[row.id] = row;
    state.profile = row;
  }
  emit('profiles');
}

/**
 * Atualiza nome/foto de um perfil. O próprio: update direto em profiles.
 * Outro usuário (só admin): RPC crm_admin_update_profile (migration 019).
 * patch aceita { name } e/ou { avatar_url } (null = remover a foto).
 */
export async function updateProfile(patch, profileId = state.user.id) {
  let row;
  if (profileId === state.user.id) {
    row = await run(sb.from('profiles').update(patch).eq('id', profileId).select().single());
  } else {
    row = await run(sb.rpc('crm_admin_update_profile', {
      p_id: profileId,
      p_name: 'name' in patch ? patch.name : null,
      p_avatar_url: patch.avatar_url ?? null,
      p_clear_avatar: 'avatar_url' in patch && patch.avatar_url === null,
    }));
  }
  state.profiles[row.id] = row;
  if (row.id === state.user?.id) state.profile = row;
  emit('profiles');
  return row;
}

/**
 * Faz upload da foto de um usuário (o logado, ou outro se for admin) para o
 * bucket "avatars" em <user_id>/avatar.<ext>. Antes, apaga tudo que já tinha na pasta (evita
 * sobras com extensão diferente). Devolve a publicUrl com cache-buster.
 */
export async function uploadAvatar(file, profileId = state.user?.id) {
  if (!state.user) throw new AppError('Faça login antes de trocar a foto.');
  if (!file.type.startsWith('image/')) throw new AppError('Envie uma imagem (PNG, JPG, GIF, WebP).');
  if (file.size > 2 * 1024 * 1024) throw new AppError('A imagem precisa ter até 2 MB.');
  const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || file.type.split('/')[1] || 'png').toLowerCase();
  const folder = profileId;
  const path = `${folder}/avatar.${ext}`;

  // apaga qualquer arquivo antigo na pasta (pode ter extensão diferente)
  try {
    const { data: existing } = await sb.storage.from('avatars').list(folder);
    const stale = (existing || []).filter((f) => f.name !== `avatar.${ext}`).map((f) => `${folder}/${f.name}`);
    if (stale.length) await sb.storage.from('avatars').remove(stale);
  } catch { /* lista pode falhar se o bucket não existir; o upload abaixo dá erro claro */ }

  const { error } = await sb.storage.from('avatars').upload(path, file, {
    upsert: true,
    contentType: file.type,
    cacheControl: '3600',
  });
  if (error) throw new AppError(friendlyError(error), error);

  const { data } = sb.storage.from('avatars').getPublicUrl(path);
  const url = `${data.publicUrl}?v=${Date.now()}`;
  return updateProfile({ avatar_url: url }, profileId);
}

/** Remove a foto do bucket e zera profiles.avatar_url. */
export async function removeAvatar(profileId = state.user?.id) {
  if (!state.user) return;
  const folder = profileId;
  try {
    const { data: existing } = await sb.storage.from('avatars').list(folder);
    const paths = (existing || []).map((f) => `${folder}/${f.name}`);
    if (paths.length) await sb.storage.from('avatars').remove(paths);
  } catch { /* o perfil ainda assim é limpo abaixo */ }
  return updateProfile({ avatar_url: null }, profileId);
}
