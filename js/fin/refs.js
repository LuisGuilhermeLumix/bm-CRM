// Cadastros de apoio do Financeiro: categorias, centros de custo, tipos de
// operação, sócios, regras de distribuição, parâmetros e liberação de usuários.
import { sb, run } from '../supabase.js';
import { state, emit } from '../state.js';
import { countRows, withMigrationHint } from './db.js';
import { slugify } from './format.js';

const MIGRATION_CONFIG = '011_fin_config.sql';
const MIGRATION_EMAILS = '012_profile_emails.sql';

// --- Categorias / centros de custo -------------------------------------------

export const CATEGORY_KINDS = {
  revenue: { table: 'fin_revenue_categories', title: 'Categorias de receita', usedIn: { table: 'fin_revenues', column: 'category_id', one: 'receita', many: 'receitas' } },
  expense: { table: 'fin_expense_categories', title: 'Categorias de despesa', usedIn: { table: 'fin_expenses', column: 'category_id', one: 'despesa', many: 'despesas' } },
  cost:    { table: 'fin_cost_centers',       title: 'Centros de custo',      usedIn: { table: 'fin_expenses', column: 'cost_center_id', one: 'despesa', many: 'despesas' } },
};

export function fetchCategories(kind) {
  return run(sb.from(CATEGORY_KINDS[kind].table).select('id, name').order('name'));
}
export function createCategory(kind, name) {
  return run(sb.from(CATEGORY_KINDS[kind].table).insert({ name }).select('id, name').single());
}
export function renameCategory(kind, id, name) {
  return run(sb.from(CATEGORY_KINDS[kind].table).update({ name }).eq('id', id).select('id, name').single());
}
export function deleteCategory(kind, id) {
  return run(sb.from(CATEGORY_KINDS[kind].table).delete().eq('id', id));
}
/** Quantos lançamentos usam a categoria / centro. */
export function categoryUsage(kind, id) {
  const u = CATEGORY_KINDS[kind].usedIn;
  return countRows(u.table, u.column, id);
}

// --- Tipos de operação --------------------------------------------------------

export function fetchOperationTypes() {
  return run(sb.from('fin_operation_types').select('*').order('position').order('name'));
}

/** `existing` = tipos já carregados (para slug único e posição no fim). */
export function createOperationType({ name, color }, existing = []) {
  const slugs = new Set(existing.map((t) => t.slug));
  const base = slugify(name);
  let slug = base;
  for (let i = 2; slugs.has(slug); i++) slug = `${base}-${i}`;
  const position = existing.reduce((m, t) => Math.max(m, t.position), -1) + 1;
  return run(sb.from('fin_operation_types').insert({ name, slug, color, position }).select().single());
}

export function updateOperationType(id, patch) {
  return run(sb.from('fin_operation_types').update(patch).eq('id', id).select().single());
}

// --- Sócios --------------------------------------------------------------------

export function fetchPartners() {
  return run(sb.from('fin_partners').select('*').order('position').order('name'));
}

export function createPartner({ name, color }, existing = []) {
  const position = existing.reduce((m, p) => Math.max(m, p.position), -1) + 1;
  return run(sb.from('fin_partners').insert({ name, color, position }).select().single());
}

export function updatePartner(id, patch) {
  return run(sb.from('fin_partners').update(patch).eq('id', id).select().single());
}

// --- Regras de distribuição ----------------------------------------------------

export function fetchRules() {
  return run(sb.from('fin_distribution_rules').select('operation_type_id, partner_id, pct'));
}

/** rows: [{ operation_type_id, partner_id, pct }] — grava a grade inteira de uma vez. */
export function saveRules(rows) {
  const now = new Date().toISOString();
  return run(sb.from('fin_distribution_rules')
    .upsert(rows.map((r) => ({ ...r, updated_at: now })), { onConflict: 'operation_type_id,partner_id' })
    .select('operation_type_id, partner_id, pct'));
}

// --- Parâmetros (fin_settings, migration 011) ----------------------------------

export const SETTING_DEFAULTS = { reinvest_pct: 0, reserve_pct: 0 };

export async function fetchSettings() {
  try {
    const rows = await run(sb.from('fin_settings').select('key, value'));
    const out = { ...SETTING_DEFAULTS };
    rows.forEach((r) => { if (r.key in out) out[r.key] = Number(r.value) || 0; });
    return out;
  } catch (e) {
    throw withMigrationHint(e, MIGRATION_CONFIG);
  }
}

export async function saveSettings(values) {
  try {
    const rows = Object.entries(values).map(([key, value]) => ({ key, value }));
    await run(sb.from('fin_settings').upsert(rows, { onConflict: 'key' }));
  } catch (e) {
    throw withMigrationHint(e, MIGRATION_CONFIG);
  }
}

// --- Usuários ------------------------------------------------------------------

/** { <profile_id>: email } — RPC crm_profile_emails (migration 012), só para quem é liberado. */
export async function fetchProfileEmails() {
  try {
    const rows = await run(sb.rpc('crm_profile_emails'));
    return Object.fromEntries((rows || []).map((r) => [r.id, r.email]));
  } catch (e) {
    throw withMigrationHint(e, MIGRATION_EMAILS);
  }
}

/** Libera/bloqueia o acesso de um perfil (RPC set_profile_allowed, migration 011). */
export async function setProfileAllowed(id, allowed) {
  let row;
  try {
    row = await run(sb.rpc('set_profile_allowed', { p_id: id, p_allowed: allowed }));
  } catch (e) {
    throw withMigrationHint(e, MIGRATION_CONFIG);
  }
  if (row?.id) {
    state.profiles[row.id] = row;
    if (state.user?.id === row.id) state.profile = row;
    emit('profiles');
  }
  return row;
}
