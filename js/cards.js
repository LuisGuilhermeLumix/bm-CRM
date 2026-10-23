// CRUD de cards, mover/reordenar, atividade, filtros
import { sb, run } from './supabase.js';
import {
  state, emit, upsertCard, removeCard, getCard, getTag, getField, cardsInColumn, reindexColumnLocally, sortedFields,
} from './state.js';
import { formatCurrency, formatNumber, formatDateBR } from './utils.js';

/** Busca todos os cards do board (inclusive arquivados) com os ids das tags. */
export async function fetchCards(boardId) {
  const rows = await run(
    sb.from('cards').select('*, card_tags(tag_id)').eq('board_id', boardId).order('position').order('created_at'),
  );
  return rows.map(normalizeCard);
}

/**
 * Normaliza uma linha de `cards`: garante `values` e converte o embed
 * card_tags em `tag_ids`. Se a linha não trouxer card_tags (RPCs, realtime),
 * NÃO define tag_ids, para o upsertCard preservar os ids já conhecidos.
 */
export function normalizeCard(row) {
  const { card_tags, ...card } = row;
  const out = { ...card, values: card.values || {}, field_ids: Array.isArray(card.field_ids) ? card.field_ids : [] };
  if (Array.isArray(card_tags)) out.tag_ids = card_tags.map((x) => x.tag_id);
  return out;
}

// --- Campos do card ----------------------------------------------------------
// Cada card tem seu próprio conjunto/ordem de campos em field_ids; o board é só
// o catálogo de definições.

/** Definições dos campos deste card, na ordem de card.field_ids (ignora ids órfãos). */
export function cardFields(card) {
  return (card?.field_ids || []).map(getField).filter(Boolean);
}

/** Ids dos campos que entram em um card novo (default_on_new_cards), na ordem do board. */
export function defaultFieldIds() {
  return sortedFields().filter((f) => f.default_on_new_cards !== false).map((f) => f.id);
}

/** Quantos cards do board têm o campo (no field_ids). */
export function fieldCardUsage(fieldId) {
  return state.cards.filter((c) => c.field_ids?.includes(fieldId)).length;
}

export async function addFieldToCard(cardId, fieldId) {
  const card = getCard(cardId);
  if (!card || card.field_ids.includes(fieldId)) return card;
  return updateCard(cardId, { field_ids: [...card.field_ids, fieldId] });
}

export async function reorderCardFields(cardId, ids) {
  const card = getCard(cardId);
  if (!card) return;
  // mantém ids que a lista não conhece (ex.: adicionados por outra pessoa) no fim
  const extra = card.field_ids.filter((id) => !ids.includes(id));
  return updateCard(cardId, { field_ids: [...ids, ...extra] });
}

/** Remove o campo SÓ deste card (array + valores), via RPC. Otimista. */
export async function removeFieldFromCard(cardId, fieldId) {
  const card = getCard(cardId);
  if (!card) return;
  const before = { field_ids: card.field_ids, values: { ...card.values } };
  card.field_ids = card.field_ids.filter((id) => id !== fieldId);
  delete card.values[fieldId];
  delete card.values[`${fieldId}:status`];
  emit('cards');
  try {
    const row = await run(sb.rpc('remove_field_from_card', { p_card_id: cardId, p_field_id: fieldId }));
    upsertCard(normalizeCard(row));
    emit('cards');
    return getCard(cardId);
  } catch (e) {
    Object.assign(card, before);
    emit('cards');
    throw e;
  }
}

export async function createCard(boardId, columnId, title, extra = {}) {
  const position = cardsInColumn(columnId).length;
  const row = await run(
    sb.from('cards')
      .insert({ board_id: boardId, column_id: columnId, title, position, created_by: state.user.id, values: {}, field_ids: defaultFieldIds(), ...extra })
      .select('*, card_tags(tag_id)').single(),
  );
  const card = normalizeCard(row);
  upsertCard(card);
  emit('cards');
  // histórico (não bloqueia a UI)
  run(sb.from('card_activity').insert({ card_id: card.id, user_id: state.user.id, type: 'created', payload: {} })).catch(() => {});
  return card;
}

/** Atualização otimista de title / description / archived. */
export async function updateCard(id, patch) {
  const card = getCard(id);
  if (!card) return;
  const before = { ...card };
  Object.assign(card, patch);
  emit('cards');
  try {
    const row = await run(sb.from('cards').update(patch).eq('id', id).select('*, card_tags(tag_id)').single());
    upsertCard(normalizeCard(row));
    emit('cards');
    return getCard(id);
  } catch (e) {
    Object.assign(card, before);
    emit('cards');
    throw e;
  }
}

/** Mescla valores de campos personalizados (server-side, via RPC). */
export async function patchValues(id, patch) {
  const card = getCard(id);
  if (!card) return;
  const before = { ...card.values };
  const next = { ...card.values };
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) delete next[k]; else next[k] = v;
  }
  card.values = next;
  emit('cards');
  try {
    const row = await run(sb.rpc('patch_card_values', { p_card_id: id, p_patch: patch }));
    upsertCard(normalizeCard(row));
    emit('cards');
    return getCard(id);
  } catch (e) {
    card.values = before;
    emit('cards');
    throw e;
  }
}

export async function archiveCard(id, archived = true) {
  await updateCard(id, { archived });
  run(sb.from('card_activity').insert({
    card_id: id, user_id: state.user.id, type: archived ? 'archived' : 'restored', payload: {},
  })).catch(() => {});
}

export async function deleteCard(id) {
  const card = getCard(id);
  await run(sb.from('cards').delete().eq('id', id));
  removeCard(id);
  if (card) reindexColumnLocally(card.column_id);
  emit('cards');
}

/**
 * Move o card para (coluna, posição) de forma otimista: atualiza o estado local
 * (replicando a lógica do move_card no SQL), chama a RPC e, se falhar, volta ao
 * snapshot anterior.
 */
export async function moveCard(cardId, newColumnId, newPosition) {
  const card = getCard(cardId);
  if (!card) return;
  const oldColumnId = card.column_id;
  const snapshot = state.cards
    .filter((c) => c.column_id === oldColumnId || c.column_id === newColumnId)
    .map((c) => ({ id: c.id, column_id: c.column_id, position: c.position }));

  // --- otimista ---
  const others = cardsInColumn(newColumnId).filter((c) => c.id !== cardId);
  const pos = Math.max(0, Math.min(newPosition, others.length));
  others.forEach((c, i) => { c.position = i >= pos ? i + 1 : i; });
  card.column_id = newColumnId;
  card.position = pos;
  if (oldColumnId !== newColumnId) reindexColumnLocally(oldColumnId);
  emit('cards');

  try {
    const row = await run(sb.rpc('move_card', { p_card_id: cardId, p_new_column_id: newColumnId, p_new_position: pos }));
    upsertCard(normalizeCard(row));
    emit('cards');
  } catch (e) {
    snapshot.forEach((s) => { const c = getCard(s.id); if (c) { c.column_id = s.column_id; c.position = s.position; } });
    emit('cards');
    throw e;
  }
}

// --- Atividade ---------------------------------------------------------------

export async function fetchActivity(cardId) {
  return run(sb.from('card_activity').select('*').eq('card_id', cardId).order('created_at', { ascending: false }).limit(100));
}

export async function addComment(cardId, text) {
  return run(sb.from('card_activity')
    .insert({ card_id: cardId, user_id: state.user.id, type: 'comment', payload: { text } })
    .select().single());
}

/**
 * Registra "atualizou: Campo A, Campo B". Para não encher o histórico com o
 * autosave, mescla com a última atividade se ela for 'updated' do mesmo
 * usuário nos últimos 10 minutos.
 */
export async function logUpdated(cardId, fieldNames) {
  if (!fieldNames?.length) return;
  const last = await run(sb.from('card_activity').select('*').eq('card_id', cardId).order('created_at', { ascending: false }).limit(1));
  const prev = last?.[0];
  const recent = prev && prev.type === 'updated' && prev.user_id === state.user.id &&
    Date.now() - new Date(prev.created_at).getTime() < 10 * 60 * 1000;
  if (recent) {
    const fields = Array.from(new Set([...(prev.payload?.fields || []), ...fieldNames]));
    return run(sb.from('card_activity').update({ payload: { fields } }).eq('id', prev.id).select().single());
  }
  return run(sb.from('card_activity')
    .insert({ card_id: cardId, user_id: state.user.id, type: 'updated', payload: { fields: fieldNames } })
    .select().single());
}

// --- Filtros / busca ---------------------------------------------------------

/** Texto pesquisável de um valor, resolvendo ids de opções para labels. */
export function valueToSearchText(field, value) {
  if (value == null || value === '') return '';
  switch (field.type) {
    case 'select': return field.options?.find((o) => o.id === value)?.label || '';
    case 'multiselect': return (Array.isArray(value) ? value : [])
      .map((id) => field.options?.find((o) => o.id === id)?.label || '').join(' ');
    case 'checkbox': return value ? field.name : '';
    case 'currency': return `${formatCurrency(value)} ${value}`;
    case 'number': return `${formatNumber(value)} ${value}`;
    case 'date': return `${formatDateBR(value)} ${value}`;
    default: return String(value);
  }
}

/** Rótulo da opção de status escolhida para o campo (ou ''). */
export function statusLabelOf(field, values) {
  if (!field.status_enabled) return '';
  const id = values?.[`${field.id}:status`];
  return id ? (field.status_options || []).find((o) => o.id === id)?.label || '' : '';
}

export function cardMatchesFilters(card) {
  const { q, tagIds, statusKeys = [] } = state.filters;
  if (tagIds.length && !tagIds.some((t) => card.tag_ids?.includes(t))) return false;
  // statusKeys: "<fieldId>:<optionId>" — basta uma bater (OU), como nas tags
  if (statusKeys.length && !statusKeys.some((k) => {
    const i = k.indexOf(':');
    const fieldId = k.slice(0, i), optionId = k.slice(i + 1);
    return card.values?.[`${fieldId}:status`] === optionId;
  })) return false;
  if (q) {
    const needle = q.trim().toLowerCase();
    if (needle) {
      const parts = [card.title, card.description];
      for (const f of state.fields) {
        parts.push(valueToSearchText(f, card.values?.[f.id]));
        parts.push(statusLabelOf(f, card.values)); // "cancelada" acha cards com esse status
      }
      for (const tid of card.tag_ids || []) parts.push(getTag(tid)?.name);
      const hay = parts.filter(Boolean).join(' \n ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
  }
  return true;
}

