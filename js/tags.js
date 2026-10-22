// CRUD de tags + vínculo tag <-> card
import { sb, run } from './supabase.js';
import { state, emit, upsertTag, removeTag, getTag, getCard } from './state.js';

export async function fetchTags(boardId) {
  return run(sb.from('tags').select('*').eq('board_id', boardId).order('name'));
}

export async function createTag(boardId, { name, color }) {
  const row = await run(sb.from('tags').insert({ board_id: boardId, name, color }).select().single());
  upsertTag(row);
  emit('tags');
  return row;
}

export async function updateTag(id, patch) {
  const t = getTag(id);
  if (!t) return;
  const before = { ...t };
  Object.assign(t, patch);
  emit('tags');
  try {
    const row = await run(sb.from('tags').update(patch).eq('id', id).select().single());
    upsertTag(row);
    emit('tags');
    return row;
  } catch (e) {
    Object.assign(t, before);
    emit('tags');
    throw e;
  }
}

export async function deleteTag(id) {
  await run(sb.from('tags').delete().eq('id', id));
  state.cards.forEach((c) => { c.tag_ids = (c.tag_ids || []).filter((t) => t !== id); });
  removeTag(id);
  emit('tags');
  emit('cards');
}

export function tagUsage(tagId) {
  return state.cards.filter((c) => c.tag_ids?.includes(tagId)).length;
}

export async function addTagToCard(cardId, tagId) {
  const card = getCard(cardId);
  if (!card || card.tag_ids.includes(tagId)) return;
  card.tag_ids = [...card.tag_ids, tagId];
  emit('cards');
  try {
    await run(sb.from('card_tags').upsert({ card_id: cardId, tag_id: tagId }, { onConflict: 'card_id,tag_id' }));
  } catch (e) {
    card.tag_ids = card.tag_ids.filter((t) => t !== tagId);
    emit('cards');
    throw e;
  }
}

export async function removeTagFromCard(cardId, tagId) {
  const card = getCard(cardId);
  if (!card || !card.tag_ids.includes(tagId)) return;
  card.tag_ids = card.tag_ids.filter((t) => t !== tagId);
  emit('cards');
  try {
    await run(sb.from('card_tags').delete().eq('card_id', cardId).eq('tag_id', tagId));
  } catch (e) {
    card.tag_ids = [...card.tag_ids, tagId];
    emit('cards');
    throw e;
  }
}
