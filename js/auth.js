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

export async function updateProfile(patch) {
  const row = await run(sb.from('profiles').update(patch).eq('id', state.user.id).select().single());
  state.profiles[row.id] = row;
  state.profile = row;
  emit('profiles');
  return row;
}
