// CRUD de campos personalizados (+ ícone próprio e status vinculado)
import { sb, run } from './supabase.js';
import { state, emit, upsertField, removeField, getField, getCard } from './state.js';
import { FIELD_TYPE_ICONS } from './ui/icons.js';

export const FIELD_TYPES = [
  { value: 'text',        label: 'Texto curto' },
  { value: 'textarea',    label: 'Texto longo' },
  { value: 'number',      label: 'Número' },
  { value: 'currency',    label: 'Moeda (R$)' },
  { value: 'date',        label: 'Data' },
  { value: 'select',      label: 'Seleção única' },
  { value: 'multiselect', label: 'Seleção múltipla' },
  { value: 'checkbox',    label: 'Checkbox' },
  { value: 'url',         label: 'Link (URL)' },
  { value: 'email',       label: 'E-mail' },
  { value: 'phone',       label: 'Telefone' },
].map((t) => ({ ...t, icon: FIELD_TYPE_ICONS[t.value] }));

export const fieldTypeInfo = (type) => FIELD_TYPES.find((t) => t.value === type) || FIELD_TYPES[0];

/** Chave em cards.values onde fica o status de um grupo do campo. */
export const statusKeyOf = (fieldId, groupId) => `${fieldId}:status:${groupId}`;
/** Prefixo de todas as chaves de status de um campo (qualquer grupo). */
export const statusPrefixOf = (fieldId) => `${fieldId}:status`;

/** Grupos de status do campo ([] quando não tem). */
export function fieldStatuses(field) {
  return Array.isArray(field?.statuses) ? field.statuses : [];
}

/** Ids de opção selecionados numa chave de status (string → [id], array → ids). */
export function statusValueIds(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  return v ? [v] : [];
}

export async function fetchFields(boardId) {
  return run(sb.from('fields').select('*').eq('board_id', boardId).order('position').order('created_at'));
}

export async function createField(boardId, data) {
  const position = state.fields.reduce((m, f) => Math.max(m, f.position), -1) + 1;
  const row = await run(sb.from('fields').insert({ ...data, board_id: boardId, position }).select().single());
  upsertField(row);
  emit('fields');
  return row;
}

export async function updateField(id, patch) {
  const f = getField(id);
  if (!f) return;
  const before = { ...f };
  Object.assign(f, patch);
  emit('fields');
  try {
    const row = await run(sb.from('fields').update(patch).eq('id', id).select().single());
    upsertField(row);
    emit('fields');
    return row;
  } catch (e) {
    Object.assign(f, before);
    emit('fields');
    throw e;
  }
}

/**
 * Fork: copia a definição do campo com `patch` aplicado para uma linha nova em
 * `fields` e faz SÓ este card apontar para ela (RPC fork_field_for_card).
 * Atualiza o estado local: campo novo no catálogo, field_ids e values do card
 * remapeados. Os outros cards continuam na definição antiga.
 */
export async function forkFieldForCard(cardId, fieldId, patch) {
  const row = await run(sb.rpc('fork_field_for_card', { p_card_id: cardId, p_field_id: fieldId, p_patch: patch || {} }));
  upsertField(row);
  const card = getCard(cardId);
  if (card) {
    card.field_ids = (card.field_ids || []).map((id) => (id === fieldId ? row.id : id));
    card.values = remapValuesLocally(card.values, fieldId, row.id);
  }
  emit('fields');
  emit('cards');
  return row;
}

/** "<old>" → "<new>" e "<old>:status:<g>" → "<new>:status:<g>"; o resto fica igual. */
export function remapValuesLocally(values, oldId, newId) {
  const out = {};
  const prefix = statusPrefixOf(oldId);
  for (const [k, v] of Object.entries(values || {})) {
    if (k === oldId) out[newId] = v;
    else if (k.startsWith(prefix)) out[newId + k.slice(oldId.length)] = v;
    else out[k] = v;
  }
  return out;
}

export async function deleteField(id) {
  // limpa os valores (e o status) desse campo em todos os cards, e tira o id
  // de cards.field_ids, antes de apagar a definição (tudo no strip_field_values)
  await run(sb.rpc('strip_field_values', { p_field_id: id }));
  await run(sb.from('fields').delete().eq('id', id));
  const prefix = statusPrefixOf(id);
  state.cards.forEach((c) => {
    if (Array.isArray(c.field_ids)) c.field_ids = c.field_ids.filter((x) => x !== id);
    if (!c.values) return;
    for (const k of Object.keys(c.values)) if (k === id || k.startsWith(prefix)) delete c.values[k];
  });
  removeField(id);
  emit('fields');
  emit('cards');
}

export async function reorderFields(ids) {
  ids.forEach((id, i) => { const f = getField(id); if (f) f.position = i; });
  emit('fields');
  await run(sb.rpc('reorder_positions', { p_table: 'fields', p_ids: ids }));
}

/** Valor "vazio" para fins de "esse campo já tem valores?" */
export function isEmptyValue(v) {
  return v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0);
}

/** Quantos cards do board têm valor nesse campo (o status não conta). */
export function fieldUsage(fieldId) {
  return state.cards.filter((c) => !isEmptyValue(c.values?.[fieldId])).length;
}

/** Este card tem valor nesse campo? (o status não conta) */
export function cardHasValue(cardId, fieldId) {
  return !isEmptyValue(getCard(cardId)?.values?.[fieldId]);
}

/** Este card usa essa opção de select/multiselect? */
export function cardUsesOption(cardId, fieldId, optionId) {
  const v = getCard(cardId)?.values?.[fieldId];
  return Array.isArray(v) ? v.includes(optionId) : v === optionId;
}

/** Este card usa essa opção de um grupo de status? */
export function cardUsesStatusOption(cardId, fieldId, groupId, optionId) {
  return statusValueIds(getCard(cardId)?.values?.[statusKeyOf(fieldId, groupId)]).includes(optionId);
}

/**
 * Agrupa definições por nome (sem diferenciar maiúsculas/espaços nas pontas)
 * + tipo. Com forks o catálogo tem vários campos de mesmo nome; para o usuário
 * a identidade do campo é o nome. Cada grupo: { key, name, type, variants,
 * main } — `variants` na ordem recebida e `main` a variação mais usada
 * (empate: a primeira). `usage(f)` = nº de cards que têm o campo.
 */
export function groupFieldsByName(fields, usage) {
  const groups = new Map();
  for (const f of fields) {
    const key = `${(f.name || '').trim().toLowerCase()}\u0000${f.type}`;
    if (!groups.has(key)) groups.set(key, { key, name: f.name, type: f.type, variants: [], main: f });
    groups.get(key).variants.push(f);
  }
  for (const g of groups.values()) {
    g.main = g.variants.reduce((best, f) => (usage(f) > usage(best) ? f : best), g.variants[0]);
  }
  return [...groups.values()];
}

/** Resumo curto de uma variação: "3 opções · 2 grupos de status · usado em 4 cards". */
export function fieldVariantSummary(f, inCards) {
  const parts = [];
  if (f.type === 'select' || f.type === 'multiselect') {
    const n = (f.options || []).length;
    parts.push(`${n} ${n === 1 ? 'opção' : 'opções'}`);
  }
  const g = fieldStatuses(f).length;
  if (g) parts.push(`${g} ${g === 1 ? 'grupo de status' : 'grupos de status'}`);
  parts.push(inCards ? `usado em ${inCards} ${inCards === 1 ? 'card' : 'cards'}` : 'sem uso');
  return parts.join(' · ');
}

/** Quantos cards usam uma opção de select/multiselect. */
export function optionUsage(fieldId, optionId) {
  return state.cards.filter((c) => {
    const v = c.values?.[fieldId];
    return Array.isArray(v) ? v.includes(optionId) : v === optionId;
  }).length;
}

/** Quantos cards usam uma opção de um grupo de status do campo. */
export function statusOptionUsage(fieldId, groupId, optionId) {
  const skey = statusKeyOf(fieldId, groupId);
  return state.cards.filter((c) => statusValueIds(c.values?.[skey]).includes(optionId)).length;
}

/** Quantos cards têm algum valor num grupo de status do campo. */
export function statusGroupUsage(fieldId, groupId) {
  const skey = statusKeyOf(fieldId, groupId);
  return state.cards.filter((c) => statusValueIds(c.values?.[skey]).length > 0).length;
}

/** Tira uma opção dos valores de todos os cards (servidor + estado local). */
export async function purgeOptionValues(fieldId, optionId) {
  await run(sb.rpc('remove_field_option', { p_field_id: fieldId, p_option_id: optionId }));
  state.cards.forEach((c) => {
    const v = c.values?.[fieldId];
    if (Array.isArray(v)) c.values[fieldId] = v.filter((x) => x !== optionId);
    else if (v === optionId) delete c.values[fieldId];
  });
  emit('cards');
}

/** Tira uma opção de um grupo de status dos cards que a usam (servidor + estado local). */
export async function purgeStatusOptionValues(fieldId, groupId, optionId) {
  await run(sb.rpc('remove_field_status_option', { p_field_id: fieldId, p_group_id: groupId, p_option_id: optionId }));
  const skey = statusKeyOf(fieldId, groupId);
  state.cards.forEach((c) => {
    const v = c.values?.[skey];
    if (v == null) return;
    if (Array.isArray(v)) c.values[skey] = v.filter((x) => x !== optionId);
    else if (v === optionId) delete c.values[skey];
  });
  emit('cards');
}

/** Remove a opção da definição do campo e dos valores dos cards que a usam. */
export async function removeFieldOption(fieldId, optionId) {
  const f = getField(fieldId);
  if (!f) return;
  const options = (f.options || []).filter((o) => o.id !== optionId);
  await purgeOptionValues(fieldId, optionId);
  await updateField(fieldId, { options });
}
