// CRUD de boards + abertura de board (carrega colunas, campos, tags e cards)
import { sb, run } from './supabase.js';
import { state, emit, upsertBoard, removeBoard, sortedBoards } from './state.js';
import { storage } from './utils.js';
import { fetchColumns } from './columns.js';
import { fetchFields } from './fields.js';
import { fetchTags } from './tags.js';
import { fetchCards } from './cards.js';
import { subscribeBoard, unsubscribeBoard } from './realtime.js';

export const LAST_BOARD_KEY = 'lumix.lastBoard';

export const DEFAULT_COLUMNS = [
  { name: 'Lead',          color: '#6b7280' },
  { name: 'Contato feito', color: '#3b82f6' },
  { name: 'Proposta',      color: '#f59e0b' },
  { name: 'Ativo',         color: '#22c55e' },
  { name: 'Perdido',       color: '#ef4444' },
];

export const DEFAULT_FIELDS = [
  { name: 'E-mail',          type: 'email',    show_on_card: false },
  { name: 'Telefone',        type: 'phone',    show_on_card: true },
  { name: 'Empresa',         type: 'text',     show_on_card: true },
  { name: 'Nicho',           type: 'select',   show_on_card: true, options: [] },
  { name: 'Valor',           type: 'currency', show_on_card: true },
  { name: 'Próximo contato', type: 'date',     show_on_card: true, is_deadline: true },
];

export async function loadBoards() {
  state.boards = await run(sb.from('boards').select('*').order('position').order('created_at'));
  emit('boards');
  return state.boards;
}

export async function createBoard({ name, color = '#6366f1', icon = 'kanban', withDefaultColumns = true, withDefaultFields = false }) {
  const position = state.boards.reduce((m, b) => Math.max(m, b.position), -1) + 1;
  const board = await run(
    sb.from('boards').insert({ name, color, icon, position, created_by: state.user.id }).select().single(),
  );
  if (withDefaultColumns) {
    await run(sb.from('columns').insert(DEFAULT_COLUMNS.map((c, i) => ({ ...c, board_id: board.id, position: i }))));
  }
  if (withDefaultFields) {
    await run(sb.from('fields').insert(DEFAULT_FIELDS.map((f, i) => ({ ...f, board_id: board.id, position: i, options: f.options || [], is_deadline: !!f.is_deadline }))));
  }
  upsertBoard(board);
  emit('boards');
  return board;
}

/** Primeiro acesso: board "Clientes" com colunas e campos padrão. */
export function createFirstBoard() {
  return createBoard({ name: 'Clientes', color: '#6366f1', icon: 'users', withDefaultColumns: true, withDefaultFields: true });
}

export async function updateBoard(id, patch) {
  const board = state.boards.find((b) => b.id === id);
  const before = { ...board };
  Object.assign(board, patch);
  emit('boards');
  try {
    const row = await run(sb.from('boards').update(patch).eq('id', id).select().single());
    upsertBoard(row);
    emit('boards');
    return row;
  } catch (e) {
    Object.assign(board, before);
    emit('boards');
    throw e;
  }
}

export async function deleteBoard(id) {
  await run(sb.from('boards').delete().eq('id', id));
  removeBoard(id);
  emit('boards');
  if (state.boardId === id) {
    const next = sortedBoards()[0];
    if (next) await openBoard(next.id);
    else closeBoard();
  }
}

/**
 * Duplica o board (RPC duplicate_board) logo abaixo do original.
 * withCards = false copia só colunas, campos e tags. Recarrega a lista.
 */
export async function duplicateBoard(id, withCards) {
  const row = await run(sb.rpc('duplicate_board', { p_board_id: id, p_with_cards: !!withCards }));
  await loadBoards();
  return row;
}

export async function reorderBoards(ids) {
  ids.forEach((id, i) => { const b = state.boards.find((x) => x.id === id); if (b) b.position = i; });
  emit('boards');
  await run(sb.rpc('reorder_positions', { p_table: 'boards', p_ids: ids }));
}

let openSeq = 0;
export async function openBoard(id) {
  const seq = ++openSeq;
  unsubscribeBoard();
  state.boardId = id;
  state.loadingBoard = true;
  state.columns = []; state.fields = []; state.tags = []; state.cards = [];
  state.filters = { q: '', tagIds: [], statusKeys: [] };
  state.movedAway.clear();
  storage.set(LAST_BOARD_KEY, id);
  emit('board');
  try {
    const [columns, fields, tags, cards] = await Promise.all([
      fetchColumns(id), fetchFields(id), fetchTags(id), fetchCards(id),
    ]);
    if (seq !== openSeq) return; // usuário trocou de board no meio do load
    state.columns = columns;
    state.fields = fields;
    state.tags = tags;
    state.cards = cards;
    state.loadingBoard = false;
    emit('board');
    subscribeBoard(id);
  } catch (e) {
    if (seq !== openSeq) return;
    state.loadingBoard = false;
    emit('board');
    throw e;
  }
}

export function closeBoard() {
  unsubscribeBoard();
  state.boardId = null;
  state.columns = []; state.fields = []; state.tags = []; state.cards = [];
  storage.remove(LAST_BOARD_KEY);
  emit('board');
}
