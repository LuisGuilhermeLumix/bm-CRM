// CRUD de colunas (status do kanban)
import { sb, run } from './supabase.js';
import { state, emit, upsertColumn, removeColumn, sortedColumns, getColumn } from './state.js';

export async function fetchColumns(boardId) {
  return run(sb.from('columns').select('*').eq('board_id', boardId).order('position').order('created_at'));
}

export async function createColumn(boardId, { name, color, wip_limit = null }) {
  const position = state.columns.reduce((m, c) => Math.max(m, c.position), -1) + 1;
  const row = await run(sb.from('columns').insert({ board_id: boardId, name, color, wip_limit, position }).select().single());
  upsertColumn(row);
  emit('columns');
  return row;
}

export async function updateColumn(id, patch) {
  const col = getColumn(id);
  if (!col) return;
  const before = { ...col };
  Object.assign(col, patch);
  emit('columns');
  try {
    const row = await run(sb.from('columns').update(patch).eq('id', id).select().single());
    upsertColumn(row);
    emit('columns');
    return row;
  } catch (e) {
    Object.assign(col, before);
    emit('columns');
    throw e;
  }
}

/**
 * Exclui a coluna. Se tiver cards, `moveToColumnId` é obrigatório: os cards são
 * movidos (anexados ao final) antes da exclusão.
 */
export async function deleteColumn(id, moveToColumnId = null) {
  const cards = state.cards.filter((c) => c.column_id === id);
  if (cards.length) {
    if (!moveToColumnId) throw new Error('Escolha para onde mover os cards.');
    const base = state.cards.filter((c) => c.column_id === moveToColumnId && !c.archived).length;
    // posições sequenciais após os cards já existentes no destino
    const sorted = [...cards].sort((a, b) => a.position - b.position);
    await Promise.all(sorted.map((c, i) =>
      run(sb.from('cards').update({ column_id: moveToColumnId, position: base + i }).eq('id', c.id)),
    ));
    sorted.forEach((c, i) => { c.column_id = moveToColumnId; c.position = base + i; });
  }
  await run(sb.from('columns').delete().eq('id', id));
  removeColumn(id);
  emit('columns');
  emit('cards');
}

export async function reorderColumns(ids) {
  ids.forEach((id, i) => { const c = getColumn(id); if (c) c.position = i; });
  emit('columns');
  await run(sb.rpc('reorder_positions', { p_table: 'columns', p_ids: ids }));
}

/** Move uma coluna uma posição para a esquerda (-1) ou direita (+1). */
export async function moveColumn(id, dir) {
  const cols = sortedColumns();
  const i = cols.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= cols.length) return;
  const ids = cols.map((c) => c.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await reorderColumns(ids);
}
