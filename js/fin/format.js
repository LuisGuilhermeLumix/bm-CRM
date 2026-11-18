// Formatação e rótulos do Financeiro / Clientes
import { formatCurrency } from '../utils.js';

/** Estágios de cliente, na ordem do funil. `done` existe por causa dos dados antigos. */
export const STAGES = [
  { id: 'lead',     label: 'Lead',          color: '#6b7280' },
  { id: 'deal',     label: 'Em negociação', color: '#f59e0b' },
  { id: 'active',   label: 'Cliente ativo', color: '#22c55e' },
  { id: 'paused',   label: 'Pausado',       color: '#3b82f6' },
  { id: 'canceled', label: 'Cancelado',     color: '#ef4444' },
  { id: 'done',     label: 'Encerrado',     color: '#8b5cf6' },
];
export const stageOf = (id) => STAGES.find((s) => s.id === id) || { id, label: id || '—', color: '#6b7280' };

/** "R$ 1.234,56" (null/vazio vira R$ 0,00). */
export const brl = (n) => formatCurrency(n == null || n === '' ? 0 : n);

/** Coluna `date` do banco ("YYYY-MM-DD") → "dd/mm/aa". Sem Date(): não há fuso envolvido. */
export function dateShort(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '');
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : '';
}

/** Hoje no fuso do navegador, como "YYYY-MM-DD". */
export function todayYmd() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Texto para busca: minúsculo e sem acento. */
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "Agentes/Ecossistemas" → "agentes-ecossistemas" */
export function slugify(s) {
  return fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tipo';
}
