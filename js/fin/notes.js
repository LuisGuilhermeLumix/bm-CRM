// Anotações (fin_notes): CRUD, realtime e a conversão das notas antigas, que
// vieram com HTML (<div>, <br>, &nbsp;), para texto puro.
import { sb, run } from '../supabase.js';
import { state } from '../state.js';
import { fetchAll } from './db.js';

export function fetchNotes() {
  return fetchAll(() => sb.from('fin_notes').select('*').order('updated_at', { ascending: false }).order('id'));
}

export function createNote({ title, body = '', favorite = false }) {
  return run(sb.from('fin_notes').insert({ title, body, favorite, author_id: state.user?.id || null }).select().single());
}

export function updateNote(id, patch) {
  return run(sb.from('fin_notes').update(patch).eq('id', id).select().single());
}

export function deleteNote(id) {
  return run(sb.from('fin_notes').delete().eq('id', id));
}

/** Realtime de fin_notes. Devolve a função que desinscreve. */
export function subscribeNotes(onChange) {
  const channel = sb.channel('fin-notes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fin_notes' }, onChange)
    .subscribe();
  return () => { sb.removeChannel(channel); };
}

/** O texto tem marcação HTML ou entidades? (só usado quando o banco ainda não tem body_format) */
function looksLikeHtml(text) {
  return /<\/?[a-z][^>]*>|&(nbsp|amp|lt|gt|quot|#\d+);/i.test(String(text || ''));
}

/**
 * A nota ainda está no HTML do sistema antigo? Vale a marca do banco
 * (body_format, migration 017): 'html' só nas importadas, e vira 'text' quando
 * a tela grava a versão limpa. Sem a coluna (017 não aplicada), olha o texto.
 */
export function isLegacyHtml(note) {
  return 'body_format' in note ? note.body_format === 'html' : looksLikeHtml(note.body);
}

const NBSP = String.fromCharCode(160); // espaço não separável, escrito pelo código para não haver caractere invisível no fonte
const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * HTML → texto puro. <br> e o fim de blocos (<div>, <p>, <li>…) viram quebra de
 * linha; o resto das tags some; entidades são decodificadas. Tudo por texto
 * (regex): o conteúdo nunca é entregue ao navegador como HTML.
 */
export function htmlToText(html) {
  return String(html || '')
    .replace(/\r\n?/g, '\n')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\/\s*(div|p|li|h[1-6]|tr|blockquote|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .split(NBSP).join(' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Texto da nota para mostrar/editar: converte só as que ainda estão em HTML antigo. */
export const noteText = (note) => (isLegacyHtml(note) ? htmlToText(note.body) : String(note.body || ''));
