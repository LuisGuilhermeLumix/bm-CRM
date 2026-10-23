// CRUD de campos personalizados (+ ícone próprio e status vinculado)
import { sb, run } from './supabase.js';
import { state, emit, upsertField, removeField, getField } from './state.js';
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

/** Chave em cards.values onde fica o status vinculado ao campo. */
export const statusKeyOf = (fieldId) => `${fieldId}:status`;

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

export async function deleteField(id) {
  // limpa os valores (e o status) desse campo em todos os cards antes de apagar a definição
  await run(sb.rpc('strip_field_values', { p_field_id: id }));
  await run(sb.from('fields').delete().eq('id', id));
  const skey = statusKeyOf(id);
  state.cards.forEach((c) => {
    if (!c.values) return;
    if (id in c.values) delete c.values[id];
    if (skey in c.values) delete c.values[skey];
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

/** Quantos cards usam uma opção de select/multiselect. */
export function optionUsage(fieldId, optionId) {
  return state.cards.filter((c) => {
    const v = c.values?.[fieldId];
    return Array.isArray(v) ? v.includes(optionId) : v === optionId;
  }).length;
}

/** Quantos cards usam uma opção de status do campo. */
export function statusOptionUsage(fieldId, optionId) {
  const skey = statusKeyOf(fieldId);
  return state.cards.filter((c) => c.values?.[skey] === optionId).length;
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

/** Tira uma opção de status dos cards que a usam (servidor + estado local). */
export async function purgeStatusOptionValues(fieldId, optionId) {
  await run(sb.rpc('remove_field_status_option', { p_field_id: fieldId, p_option_id: optionId }));
  const skey = statusKeyOf(fieldId);
  state.cards.forEach((c) => {
    if (c.values?.[skey] === optionId) delete c.values[skey];
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
