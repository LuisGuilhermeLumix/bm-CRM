// Helpers de acesso às tabelas fin_* (paginação, contagem, erro de migration)
import { sb, run, friendlyError, AppError } from '../supabase.js';

/**
 * Busca todas as linhas, em páginas (o PostgREST corta em 1000 por resposta).
 * makeQuery() devolve uma query nova a cada chamada, já com filtros e uma
 * ordenação estável (termine com .order('id')).
 */
export async function fetchAll(makeQuery, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const rows = await run(makeQuery().range(from, from + pageSize - 1));
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}

/** Quantas linhas de `table` têm `column` = `value` (count no banco, sem trazer linhas). */
export async function countRows(table, column, value) {
  const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true }).eq(column, value);
  if (error) throw new AppError(friendlyError(error), error);
  return count || 0;
}

/** O erro é de tabela/função que ainda não existe no banco (migration não aplicada)? */
export function isMissingInDb(err) {
  const c = err?.cause || err;
  // PGRST202 função, PGRST204 coluna, PGRST205 tabela (cache do PostgREST); 42P01/42703/42883 direto do Postgres
  return ['PGRST202', 'PGRST204', 'PGRST205', '42P01', '42703', '42883'].includes(c?.code)
    || /Could not find the (function|table|'\w+' column)|does not exist/i.test(c?.message || '');
}

/** Troca o erro cru de "não existe" por um aviso de qual migration aplicar. */
export function withMigrationHint(err, file) {
  return isMissingInDb(err)
    ? new AppError(`Falta aplicar a migration ${file} no banco.`, err)
    : err;
}
