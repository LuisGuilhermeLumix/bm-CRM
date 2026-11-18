// Dashboard, Distribuição de Lucro e Relatórios: RPCs da migration 015, itens
// considerados no mês, cálculo da divisão entre sócios e registro da distribuição.
import { sb, run } from '../supabase.js';
import { state } from '../state.js';
import { fetchAll, withMigrationHint } from './db.js';

const MIGRATION_REPORTS = '015_fin_reports.sql';
const num = (v) => Number(v) || 0;
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

async function rpc(name, args) {
  try {
    return await run(sb.rpc(name, args));
  } catch (e) {
    throw withMigrationHint(e, MIGRATION_REPORTS);
  }
}

/** Receita, despesa e lucro pagos por mês: `months` meses terminando em endMonth ("YYYY-MM-01"). */
export async function fetchMonthlySeries(endMonth, months = 6) {
  const rows = await rpc('fin_monthly_series', { p_end_month: endMonth, p_months: months });
  return (rows || []).map((r) => ({ month: String(r.month_start).slice(0, 10), revenue: num(r.revenue_paid), expense: num(r.expense_paid), profit: num(r.profit) }));
}

/** Realizado (pago) por categoria no período: { revenue: [...], expense: [...] }, maior primeiro. */
export async function fetchByCategory({ from = null, to = null } = {}) {
  const rows = await rpc('fin_by_category', { p_from: from, p_to: to });
  const pick = (kind) => (rows || []).filter((r) => r.kind === kind)
    .map((r) => ({ id: r.category_id, label: r.category_name, value: num(r.total), count: num(r.entries) }))
    .sort((a, b) => b.value - a.value);
  return { revenue: pick('revenue'), expense: pick('expense') };
}

/**
 * Lucro do mês por tipo de operação (RPC fin_profit_by_operation). month = "YYYY-MM-01".
 * Uma linha por tipo + a linha "Sem tipo" (typeId null) quando houver.
 */
export async function fetchProfitByOperation(month) {
  const rows = await rpc('fin_profit_by_operation', { p_month: month });
  return (rows || []).map((r) => ({
    typeId: r.operation_type_id || null, name: r.name, slug: r.slug || null, color: r.color || '#6b7280', active: r.active !== false,
    revenue: num(r.revenue_paid), direct: num(r.expense_direct), shared: num(r.expense_shared), profit: num(r.profit),
  }));
}

/** Lançamentos pagos com Data dentro de [from, to], receitas e despesas juntos, mais recentes primeiro. */
export async function fetchPaidItems(from, to) {
  const get = (table, kind) => fetchAll(() => sb.from(table)
    .select('id, description, client_id, value, due_date')
    .eq('status', 'Pago').gte('due_date', from).lte('due_date', to)
    .order('due_date', { ascending: false }).order('id'))
    .then((rows) => rows.map((r) => ({ ...r, kind, value: num(r.value) })));
  const [rev, exp] = await Promise.all([get('fin_revenues', 'revenue'), get('fin_expenses', 'expense')]);
  return [...rev, ...exp].sort((a, b) => (a.due_date < b.due_date ? 1 : a.due_date > b.due_date ? -1 : 0));
}

/**
 * Divide o lucro de cada tipo entre os sócios.
 *  rows      linhas de fetchProfitByOperation (a linha "Sem tipo" não é distribuída)
 *  rules     { "<typeId>:<partnerId>": pct }
 *  partners  fin_partners
 *  settings  { reinvest_pct, reserve_pct } — abatidos do lucro antes de dividir
 * Lucro negativo entra como está: o prejuízo de um tipo abate o que o sócio recebe nos outros.
 * Os centavos do arredondamento ficam com o sócio de maior percentual do tipo.
 * Devolve { factor, byType: [{ ...row, distributable, rulesPct, shares: [{ partnerId, pct, amount }] }],
 *           partners: [{ partner, amount, share, byType: [{ typeId, name, amount }] }], total }.
 */
export function computeDistribution(rows, rules, partners, settings) {
  const factor = Math.max(0, 1 - (num(settings?.reinvest_pct) + num(settings?.reserve_pct)) / 100);
  const byType = rows.filter((r) => r.typeId).map((r) => {
    const distributable = round2(r.profit * factor);
    const shares = partners
      .map((p) => ({ partnerId: p.id, pct: num(rules[`${r.typeId}:${p.id}`]) }))
      .filter((s) => s.pct > 0)
      .map((s) => ({ ...s, amount: round2((distributable * s.pct) / 100) }));
    const rulesPct = round2(shares.reduce((sum, s) => sum + s.pct, 0));
    if (shares.length && Math.abs(rulesPct - 100) < 0.005) {
      const diff = round2(distributable - shares.reduce((sum, s) => sum + s.amount, 0));
      if (diff) { const top = shares.reduce((a, b) => (b.pct > a.pct ? b : a)); top.amount = round2(top.amount + diff); }
    }
    return { ...r, distributable, rulesPct, shares };
  });
  const total = round2(byType.reduce((sum, t) => sum + t.shares.reduce((x, s) => x + s.amount, 0), 0));
  const perPartner = partners.map((p) => {
    const parts = byType.map((t) => ({ typeId: t.typeId, name: t.name, amount: t.shares.find((s) => s.partnerId === p.id)?.amount || 0 })).filter((x) => x.amount);
    const amount = round2(parts.reduce((sum, x) => sum + x.amount, 0));
    return { partner: p, amount, share: total ? amount / total : 0, byType: parts };
  }).filter((x) => x.partner.active || x.amount);
  return { factor, byType, partners: perPartner, total };
}

// --- Registro da distribuição (fin_profit_distributions + _partners) -----------

/** Registros do mês ("YYYY-MM"), um por tipo de operação. */
export async function fetchDistributions(monthKey) {
  return run(sb.from('fin_profit_distributions').select('*').eq('month', monthKey));
}

/**
 * Grava (ou regrava) a distribuição do mês para os tipos informados.
 * types: itens de computeDistribution().byType. Uma linha por mês + tipo
 * (unique da migration 015), status 'registrado', com as fatias de cada sócio.
 */
export async function registerDistribution(monthKey, types) {
  try {
    const now = new Date().toISOString();
    const saved = await run(sb.from('fin_profit_distributions').upsert(types.map((t) => ({
      month: monthKey,
      operation_type_id: t.typeId,
      total_revenue: t.revenue,
      total_expense: round2(t.direct + t.shared),
      net_amount: t.profit,
      status: 'registrado',
      registered_at: now,
      registered_by: state.user?.id || null,
    })), { onConflict: 'month,operation_type_id' }).select());
    const ids = saved.map((d) => d.id);
    // refaz as fatias: apaga as antigas desses registros e grava as atuais
    await run(sb.from('fin_profit_distribution_partners').delete().in('distribution_id', ids));
    const shares = saved.flatMap((d) => (types.find((t) => t.typeId === d.operation_type_id)?.shares || [])
      .map((s) => ({ distribution_id: d.id, partner_id: s.partnerId, pct: s.pct, amount: s.amount })));
    if (shares.length) await run(sb.from('fin_profit_distribution_partners').insert(shares));
    return saved;
  } catch (e) {
    throw withMigrationHint(e, MIGRATION_REPORTS);
  }
}
