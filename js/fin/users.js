// Gestão de usuários (só admin): papéis e permissões (crm_access, migration
// 018) e criação de usuário pela Edge Function admin-create-user.
import { sb, run, friendlyError, AppError } from '../supabase.js';
import { withMigrationHint } from './db.js';

const MIGRATION = '018_permissions.sql';

/** { <profile_id>: { sections: [], boards: [], operation_types: [] } } de todos os perfis. */
export async function fetchAllAccess() {
  try {
    const rows = await run(sb.from('crm_access').select('profile_id, kind, ref_key, ref_id'));
    const out = {};
    for (const r of rows || []) {
      const a = out[r.profile_id] ||= { sections: [], boards: [], operation_types: [] };
      if (r.kind === 'section') a.sections.push(r.ref_key);
      else if (r.kind === 'board') a.boards.push(r.ref_id);
      else if (r.kind === 'operation_type') a.operation_types.push(r.ref_id);
    }
    return out;
  } catch (e) {
    throw withMigrationHint(e, MIGRATION);
  }
}

/** Troca o papel e todas as permissões de um perfil. */
export async function setAccess(profileId, role, access) {
  try {
    await run(sb.rpc('crm_set_access', { p_profile_id: profileId, p_role: role, p_access: access }));
  } catch (e) {
    throw withMigrationHint(e, MIGRATION);
  }
}

/** Cria o usuário (já liberado) com papel e permissões. Devolve { id, email }. */
export async function createUser({ email, password, name, role, access }) {
  const { data, error } = await sb.functions.invoke('admin-create-user', { body: { email, password, name, role, access } });
  if (error) {
    // a função devolve { error: "mensagem" } com status 4xx/5xx
    let msg = '';
    try { msg = (await error.context?.json?.())?.error || ''; } catch { /* sem corpo */ }
    if (!msg && /Failed to send|not found|404/i.test(error.message || '')) msg = 'A Edge Function admin-create-user ainda não foi publicada.';
    throw new AppError(msg || friendlyError(error), error);
  }
  if (data?.error) throw new AppError(data.error);
  return data;
}

/** Senha aleatória legível (sem caracteres parecidos), 14 caracteres. */
export function randomPassword(len = 14) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%*';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}
