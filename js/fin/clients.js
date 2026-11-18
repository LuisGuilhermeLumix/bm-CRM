// Clientes (fin_clients): CRUD, vínculos e realtime
import { sb, run } from '../supabase.js';
import { fetchAll, countRows } from './db.js';

export function fetchClients() {
  return fetchAll(() => sb.from('fin_clients').select('*').order('name').order('id'));
}

export function createClient(data) {
  return run(sb.from('fin_clients').insert(data).select().single());
}

export function updateClient(id, patch) {
  return run(sb.from('fin_clients').update(patch).eq('id', id).select().single());
}

export function deleteClient(id) {
  return run(sb.from('fin_clients').delete().eq('id', id));
}

/** Lançamentos que apontam para o cliente: { revenues, expenses }. */
export async function clientLinks(id) {
  const [revenues, expenses] = await Promise.all([
    countRows('fin_revenues', 'client_id', id),
    countRows('fin_expenses', 'client_id', id),
  ]);
  return { revenues, expenses };
}

/** Realtime de fin_clients. Devolve a função que desinscreve. */
export function subscribeClients(onChange) {
  const channel = sb.channel('fin-clients')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fin_clients' }, onChange)
    .subscribe();
  return () => { sb.removeChannel(channel); };
}
