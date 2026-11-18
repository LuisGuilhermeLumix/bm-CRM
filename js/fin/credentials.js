// Credenciais (fin_credentials). O segredo NÃO fica nesta tabela: mora no
// Supabase Vault e só entra e sai pelas RPCs fin_credential_set_secret /
// fin_credential_get_secret (migration 017), que exigem crm_allowed().
import { sb, run } from '../supabase.js';
import { state } from '../state.js';
import { fetchAll, withMigrationHint } from './db.js';

const MIGRATION_VAULT = '017_fin_vault.sql';

export const ACCESS_LEVELS = [
  { id: 'admin', label: 'Admin', color: '#8b5cf6' },
  { id: 'editor', label: 'Editor', color: '#3b82f6' },
  { id: 'leitura', label: 'Leitura', color: '#6b7280' },
];
export const accessOf = (id) => ACCESS_LEVELS.find((a) => a.id === id) || { id, label: id || '—', color: '#6b7280' };

/**
 * Situação do segredo de uma credencial:
 *  'vault'  está no Vault (dá para mostrar e copiar)
 *  'legacy' veio cifrado do app antigo e não dá para decifrar: precisa recadastrar
 *  'none'   nunca teve segredo
 */
export const secretState = (c) => (c.vault_secret_id ? 'vault' : (c.has_legacy_secret ? 'legacy' : 'none'));

/** Tira da linha o texto cifrado antigo (inútil no navegador); fica só o indicador. */
function clean(row) {
  const { secret_encrypted, secret_iv, ...rest } = row; // eslint-disable-line no-unused-vars
  return { ...rest, has_legacy_secret: !!secret_encrypted };
}

export async function fetchCredentials() {
  const rows = await fetchAll(() => sb.from('fin_credentials').select('*').order('name').order('id'));
  return rows.map(clean);
}

export async function createCredential(data) {
  return clean(await run(sb.from('fin_credentials').insert({ ...data, owner_id: state.user?.id || null }).select().single()));
}

export async function updateCredential(id, patch) {
  return clean(await run(sb.from('fin_credentials').update(patch).eq('id', id).select().single()));
}

/** Excluir a credencial apaga o segredo do Vault (trigger da migration 017). */
export function deleteCredential(id) {
  return run(sb.from('fin_credentials').delete().eq('id', id));
}

/** Grava (ou troca) o segredo no Vault. Texto vazio apaga. */
export async function setCredentialSecret(id, secret) {
  try {
    await run(sb.rpc('fin_credential_set_secret', { p_credential_id: id, p_secret: secret }));
  } catch (e) {
    throw withMigrationHint(e, MIGRATION_VAULT);
  }
}

/** Lê o segredo do Vault na hora. Null se a credencial não tem segredo. Não guarde o retorno. */
export async function getCredentialSecret(id) {
  try {
    return await run(sb.rpc('fin_credential_get_secret', { p_credential_id: id }));
  } catch (e) {
    throw withMigrationHint(e, MIGRATION_VAULT);
  }
}
