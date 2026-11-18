// Lançamentos do Financeiro: receitas (fin_revenues) e despesas (fin_expenses).
// Lista paginada no banco, totais por RPC (fin_totals) e realtime.
import { sb, run, friendlyError, AppError } from '../supabase.js';
import { withMigrationHint } from './db.js';
import { fetchClients } from './clients.js';
import { fetchCategories } from './refs.js';

export const MIGRATION_FIN = '013_fin_recurring.sql';
export const PAGE_SIZE = 50;

export const KINDS = {
  revenue: { table: 'fin_revenues', sub: 'receitas', title: 'Receitas', one: 'receita', newLabel: 'Nova receita', icon: 'trending-up' },
  expense: { table: 'fin_expenses', sub: 'despesas', title: 'Despesas', one: 'despesa', newLabel: 'Nova despesa', icon: 'trending-down' },
};

/** A tela só oferece estes dois; Atrasado/Cancelado só existem em dado antigo. */
export const STATUSES = ['Pendente', 'Pago'];
const STATUS_COLOR = { Pago: '#22c55e', Pendente: '#f59e0b', Atrasado: '#f59e0b', Cancelado: '#6b7280' };
export const statusColor = (s) => STATUS_COLOR[s] || '#6b7280';
/** Atrasado aparece como Pendente: não há cálculo de atraso. */
export const statusLabel = (s) => (s === 'Atrasado' ? 'Pendente' : (s || 'Pendente'));
export const isOpen = (s) => s === 'Pendente' || s === 'Atrasado';

/**
 * Página de lançamentos do período, do mais recente para o mais antigo.
 * O período filtra pela Data (due_date).
 * Devolve { rows, count }. Página além do fim devolve { rows: [], count: null }.
 */
export async function fetchEntries(kind, { from = null, to = null, page = 0 } = {}) {
  let q = sb.from(KINDS[kind].table).select('*', { count: 'exact' });
  if (from) q = q.gte('due_date', from);
  if (to) q = q.lte('due_date', to);
  const start = page * PAGE_SIZE;
  const { data, count, error } = await q
    .order('due_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .order('id')
    .range(start, start + PAGE_SIZE - 1);
  if (error) {
    if (error.code === 'PGRST103') return { rows: [], count: null }; // página não existe mais
    throw new AppError(friendlyError(error), error);
  }
  return { rows: data || [], count: count ?? 0 };
}

/** Totais e contagens do período, somados no banco (RPC fin_totals). */
export async function fetchTotals({ from = null, to = null } = {}) {
  try {
    const rows = await run(sb.rpc('fin_totals', { p_from: from, p_to: to, p_tags: null }));
    const r = (Array.isArray(rows) ? rows[0] : rows) || {};
    const n = (k) => Number(r[k]) || 0;
    return {
      revenuePaid: n('revenue_paid'), revenuePending: n('revenue_pending'), revenueCount: n('revenue_count'),
      expensePaid: n('expense_paid'), expensePending: n('expense_pending'), expenseCount: n('expense_count'),
    };
  } catch (e) {
    throw withMigrationHint(e, MIGRATION_FIN);
  }
}

/**
 * O que já foi usado nos lançamentos (RPC fin_filter_options): formas de
 * pagamento das despesas e as descrições mais frequentes de cada tipo
 * ([{ text, n }], migration 016). Sem a RPC, devolve listas vazias.
 */
export async function fetchFilterOptions() {
  try {
    const o = await run(sb.rpc('fin_filter_options'));
    return {
      suppliers: o?.suppliers || [],
      revenueDescriptions: o?.revenue_descriptions || [],
      expenseDescriptions: o?.expense_descriptions || [],
    };
  } catch {
    return { suppliers: [], revenueDescriptions: [], expenseDescriptions: [] };
  }
}

/** Cadastros que as tabelas e os modais precisam: clientes, categorias e centros de custo. */
export async function loadEntryRefs() {
  const [clients, revenueCats, expenseCats, costCenters] = await Promise.all([
    fetchClients(), fetchCategories('revenue'), fetchCategories('expense'), fetchCategories('cost'),
  ]);
  return { clients, revenueCats, expenseCats, costCenters };
}

export async function createEntry(kind, data) {
  try {
    return await run(sb.from(KINDS[kind].table).insert(data).select().single());
  } catch (e) { throw withMigrationHint(e, MIGRATION_FIN); }
}

export async function updateEntry(kind, id, patch) {
  try {
    return await run(sb.from(KINDS[kind].table).update(patch).eq('id', id).select().single());
  } catch (e) { throw withMigrationHint(e, MIGRATION_FIN); }
}

export function deleteEntry(kind, id) {
  return run(sb.from(KINDS[kind].table).delete().eq('id', id));
}

/** "Marcar pago": só muda o status. A Data (due_date) fica como está e paid_date não é usada. */
export function markPaid(kind, id) {
  return updateEntry(kind, id, { status: 'Pago' });
}

/** Realtime de receitas e despesas. Devolve a função que desinscreve. */
export function subscribeEntries(onChange) {
  const channel = sb.channel('fin-entries')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fin_revenues' }, (p) => onChange('revenue', p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fin_expenses' }, (p) => onChange('expense', p))
    .subscribe();
  return () => { sb.removeChannel(channel); };
}
