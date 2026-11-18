// Permissões do usuário logado (RPC crm_my_access, migration 018).
// Admin vê e faz tudo. Member vê só as seções liberadas; nos boards liberados
// edita normalmente, mas não cria/renomeia/duplica/exclui board nem move card
// de board; nas seções de finanças só lê. A RLS do banco garante tudo isso;
// aqui é só para a tela não oferecer o que vai ser recusado.
import { sb } from './supabase.js';
import { state } from './state.js';
import { SECTIONS } from './router.js';

/** Seções que só o admin abre, mesmo que estejam marcadas para um member (as tabelas negam). */
export const ADMIN_ONLY_SECTIONS = ['credenciais', 'anotacoes', 'config'];
export const FINANCE_SECTIONS = ['clientes', 'financeiro', 'distribuicao', 'relatorios'];
const ALL = SECTIONS.map((s) => s.id);

const fullAccess = (role = 'admin') => ({ role, allowed: true, sections: [...ALL], boards: [], operation_types: [], legacy: role === 'admin' });

/**
 * Carrega as permissões. Sem a migration 018 (RPC inexistente), vale o modelo
 * antigo: quem está liberado vê tudo.
 */
export async function loadAccess() {
  const { data, error } = await sb.rpc('crm_my_access');
  if (error) {
    const c = error.code || '';
    if (c === 'PGRST202' || c === '42883' || /Could not find the function/i.test(error.message || '')) {
      state.access = fullAccess();
      return state.access;
    }
    throw error;
  }
  const a = data || {};
  state.access = a.role === 'admin'
    ? fullAccess('admin')
    : {
      role: 'member',
      allowed: a.allowed !== false,
      sections: (a.sections || []).filter((s) => ALL.includes(s) && !ADMIN_ONLY_SECTIONS.includes(s)),
      boards: a.boards || [],
      operation_types: a.operation_types || [],
    };
  // ter um board liberado já libera a seção Boards
  if (state.access.role === 'member' && state.access.boards.length && !state.access.sections.includes('boards')) {
    state.access.sections.push('boards');
  }
  return state.access;
}

export const isAdmin = () => !state.access || state.access.role === 'admin';
export const canSection = (id) => isAdmin() || !!state.access?.sections.includes(id);
/** Pode criar, editar e excluir nas seções de finanças e em boards (só admin). */
export const canManage = () => isAdmin();

/** Primeira seção liberada, na ordem do menu (Dashboard primeiro). */
export function firstSection() {
  const order = ['dashboard', 'clientes', 'boards', 'financeiro', 'distribuicao', 'relatorios', 'credenciais', 'anotacoes', 'config'];
  return order.find(canSection) || null;
}
