// Estado em memória + pub/sub simples.
// Eventos: 'boards', 'board' (board aberto/trocado), 'columns', 'fields',
// 'tags', 'cards', 'filters', 'profiles', 'auth'
import { sortByPosition } from './utils.js';

export const state = {
  session: null,
  user: null,
  profile: null,
  profiles: {},          // id -> profile
  boards: [],
  boardId: null,
  columns: [],
  fields: [],
  tags: [],
  cards: [],             // cada card tem tag_ids: []
  filters: { q: '', tagIds: [], statusKeys: [] }, // statusKeys: "<fieldId>:<optionId>"
  loadingBoard: false,
  dragging: false,       // true durante drag; renders ficam pendentes
  movedAway: new Set(),  // ids de cards que saíram do board aberto por "mover para outro board"
  pendingRender: new Set(),
};

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export function emit(event, payload) {
  // Durante um drag, segura os re-renders do kanban para não quebrar o Sortable.
  if (state.dragging && ['cards', 'columns', 'fields', 'tags'].includes(event)) {
    state.pendingRender.add(event);
    return;
  }
  listeners.get(event)?.forEach((fn) => {
    try { fn(payload); } catch (e) { console.error(`listener ${event}`, e); }
  });
}

export function flushPendingRenders() {
  const pend = [...state.pendingRender];
  state.pendingRender.clear();
  pend.forEach((ev) => emit(ev));
}

// --- Getters ----------------------------------------------------------------

export const getBoard = () => state.boards.find((b) => b.id === state.boardId) || null;
export const getColumn = (id) => state.columns.find((c) => c.id === id) || null;
export const getField = (id) => state.fields.find((f) => f.id === id) || null;
export const getTag = (id) => state.tags.find((t) => t.id === id) || null;
export const getCard = (id) => state.cards.find((c) => c.id === id) || null;
export const profileOf = (id) => (id && state.profiles[id]) || null;

export function cardsInColumn(columnId) {
  return sortByPosition(state.cards.filter((c) => c.column_id === columnId && !c.archived));
}

export function sortedColumns() { return sortByPosition(state.columns); }
export function sortedFields() { return sortByPosition(state.fields); }
export function sortedBoards() { return sortByPosition(state.boards); }
export function sortedTags() { return [...state.tags].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); }

// --- Mutations (retornam true se algo mudou) ---------------------------------

// Serialização com chaves ordenadas: o jsonb do Postgres reordena as chaves de
// `values`, então um stringify simples acusaria mudança onde não há.
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function sameRow(a, b, keys) {
  return keys.every((k) => stable(a[k]) === stable(b[k]));
}

const CARD_KEYS = ['title', 'description', 'column_id', 'position', 'values', 'archived', 'updated_at', 'tag_ids', 'field_ids'];
const COLUMN_KEYS = ['name', 'color', 'position', 'wip_limit'];
const FIELD_KEYS = ['name', 'type', 'options', 'position', 'show_on_card', 'required', 'icon', 'statuses', 'default_on_new_cards'];
const TAG_KEYS = ['name', 'color'];
const BOARD_KEYS = ['name', 'color', 'icon', 'position'];

function upsertIn(list, row, keys) {
  const i = list.findIndex((x) => x.id === row.id);
  if (i === -1) { list.push(row); return true; }
  if (sameRow(list[i], row, keys)) return false;
  list[i] = { ...list[i], ...row };
  return true;
}

function removeFrom(list, id) {
  const i = list.findIndex((x) => x.id === id);
  if (i === -1) return false;
  list.splice(i, 1);
  return true;
}

export function upsertCard(row) {
  // preserva tag_ids se o row não trouxer (eventos realtime da tabela cards não trazem)
  const existing = getCard(row.id);
  const merged = { ...row, tag_ids: row.tag_ids ?? existing?.tag_ids ?? [] };
  return upsertIn(state.cards, merged, CARD_KEYS);
}
export const removeCard = (id) => removeFrom(state.cards, id);

export const upsertColumn = (row) => upsertIn(state.columns, row, COLUMN_KEYS);
export const removeColumn = (id) => removeFrom(state.columns, id);

export const upsertField = (row) => upsertIn(state.fields, row, FIELD_KEYS);
export const removeField = (id) => removeFrom(state.fields, id);

export const upsertTag = (row) => upsertIn(state.tags, row, TAG_KEYS);
export const removeTag = (id) => removeFrom(state.tags, id);

export const upsertBoard = (row) => upsertIn(state.boards, row, BOARD_KEYS);
export const removeBoard = (id) => removeFrom(state.boards, id);

/** Reindexa `position` localmente (0..n-1) para a lista de uma coluna. */
export function reindexColumnLocally(columnId) {
  cardsInColumn(columnId).forEach((c, i) => { c.position = i; });
}

export function setFilters(patch) {
  state.filters = { ...state.filters, ...patch };
  emit('filters');
}

export function hasActiveFilters() {
  return !!state.filters.q || state.filters.tagIds.length > 0;
}
