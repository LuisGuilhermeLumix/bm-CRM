// Clientes e entidades internas (fin_clients): CRUD, vínculos, logo e realtime.
// is_internal = true são as entidades da própria empresa (Lumix, Lumix REC):
// ficam fora da tela Clientes e são editadas em Configurações → Empresa.
import { sb, run, friendlyError, AppError } from '../supabase.js';
import { fetchAll, countRows, withMigrationHint } from './db.js';

const MIGRATION_ADJUST = '014_fin_adjustments.sql';
const LOGO_BUCKET = 'client-logos';
const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_ACCEPT = Object.keys(LOGO_TYPES).join(',');

export const isInternal = (c) => c?.is_internal === true;
const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
/** Só clientes de verdade, por nome. */
export const externalClients = (clients) => clients.filter((c) => !isInternal(c)).sort(byName);
/** Só as entidades da própria empresa, por nome. */
export const internalEntities = (clients) => clients.filter(isInternal).sort(byName);

/**
 * Todas as linhas de fin_clients (clientes + entidades internas), na ordem de
 * cadastro (só para a paginação ser estável). Cada tela ordena como precisa.
 */
export function fetchClients() {
  return fetchAll(() => sb.from('fin_clients').select('*').order('created_at').order('id'));
}

export function createClient(data) {
  return run(sb.from('fin_clients').insert(data).select().single());
}

export function updateClient(id, patch) {
  return run(sb.from('fin_clients').update(patch).eq('id', id).select().single());
}

export async function deleteClient(id) {
  await run(sb.from('fin_clients').delete().eq('id', id));
  await clearLogoFolder(id).catch(() => {}); // a linha já foi; sobra no bucket não impede nada
}

/** Lançamentos que apontam para o cliente: { revenues, expenses }. */
export async function clientLinks(id) {
  const [revenues, expenses] = await Promise.all([
    countRows('fin_revenues', 'client_id', id),
    countRows('fin_expenses', 'client_id', id),
  ]);
  return { revenues, expenses };
}

// --- Logo (bucket "client-logos", path <client_id>/logo.<ext>) ---------------

/** Apaga os arquivos da pasta do cliente, menos `keep` (nome do arquivo). */
async function clearLogoFolder(clientId, keep = null) {
  const { data, error } = await sb.storage.from(LOGO_BUCKET).list(clientId);
  if (error) throw new AppError(friendlyError(error), error);
  const stale = (data || []).filter((f) => f.name !== keep).map((f) => `${clientId}/${f.name}`);
  if (stale.length) await sb.storage.from(LOGO_BUCKET).remove(stale);
}

async function setLogoUrl(clientId, url) {
  try {
    return await updateClient(clientId, { logo_url: url });
  } catch (e) {
    throw withMigrationHint(e, MIGRATION_ADJUST);
  }
}

/**
 * Sobe a logo (png/jpg/webp/svg, até 2 MB) e grava a URL pública em
 * fin_clients.logo_url. Devolve a linha atualizada.
 */
export async function uploadClientLogo(clientId, file) {
  const ext = LOGO_TYPES[file.type];
  if (!ext) throw new AppError('Envie uma imagem PNG, JPG, WebP ou SVG.');
  if (file.size > LOGO_MAX_BYTES) throw new AppError('A imagem precisa ter até 2 MB.');
  const name = `logo.${ext}`;
  const path = `${clientId}/${name}`;

  const { error } = await sb.storage.from(LOGO_BUCKET).upload(path, file, {
    upsert: true, contentType: file.type, cacheControl: '3600',
  });
  if (error) throw new AppError(friendlyError(error), error);
  // logo antiga com outra extensão (ex.: tinha .png, subiu .svg)
  await clearLogoFolder(clientId, name).catch(() => {});

  const { data } = sb.storage.from(LOGO_BUCKET).getPublicUrl(path);
  // mesmo path a cada troca: o ?v= evita o navegador mostrar a imagem antiga
  return setLogoUrl(clientId, `${data.publicUrl}?v=${Date.now()}`);
}

/** Apaga a logo do bucket e zera fin_clients.logo_url. Devolve a linha atualizada. */
export async function removeClientLogo(clientId) {
  await clearLogoFolder(clientId);
  return setLogoUrl(clientId, null);
}

/** Realtime de fin_clients. Devolve a função que desinscreve. */
export function subscribeClients(onChange) {
  const channel = sb.channel('fin-clients')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fin_clients' }, onChange)
    .subscribe();
  return () => { sb.removeChannel(channel); };
}
