// Utilitários puros (sem dependência de DOM/estado)

export const PALETTE = [
  { name: 'Vermelho',  hex: '#ef4444' },
  { name: 'Laranja',   hex: '#f97316' },
  { name: 'Âmbar',     hex: '#f59e0b' },
  { name: 'Verde',     hex: '#22c55e' },
  { name: 'Esmeralda', hex: '#10b981' },
  { name: 'Ciano',     hex: '#06b6d4' },
  { name: 'Azul',      hex: '#3b82f6' },
  { name: 'Índigo',    hex: '#6366f1' },
  { name: 'Violeta',   hex: '#8b5cf6' },
  { name: 'Rosa',      hex: '#ec4899' },
  { name: 'Cinza',     hex: '#6b7280' },
  { name: 'Marrom',    hex: '#9c6644' },
];

export const BOARD_ICONS = [
  'users', 'briefcase', 'building-2', 'handshake', 'target', 'rocket', 'star', 'heart',
  'flag', 'bookmark', 'folder', 'inbox', 'mail', 'phone', 'calendar', 'banknote',
  'credit-card', 'shopping-cart', 'package', 'truck', 'home', 'globe', 'map-pin', 'layers',
  'layout-grid', 'kanban', 'trending-up', 'zap', 'sparkles', 'megaphone', 'graduation-cap', 'stethoscope',
  'dumbbell', 'utensils', 'car', 'wrench', 'scissors', 'camera', 'music', 'gift',
];

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
export const esc = escapeHtml;

export function escapeAttr(s) {
  return escapeHtml(s);
}

export function debounce(fn, ms = 300) {
  let t;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.cancel = () => clearTimeout(t);
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  return d;
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1);
  return (parts[0][0] + parts[parts.length - 1][0]).slice(0, 2);
}

export function randomPaletteColor() {
  return PALETTE[Math.floor(Math.random() * 10)].hex;
}

export function isHex(s) {
  return typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
}

export function normalizeHex(s) {
  if (!s) return null;
  let v = String(s).trim().toLowerCase();
  if (!v.startsWith('#')) v = '#' + v;
  if (/^#[0-9a-f]{3}$/.test(v)) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  return isHex(v) ? v : null;
}

// --- Datas -------------------------------------------------------------------

const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

/** "agora", "há 5 min", "há 3 dias"… a partir de um ISO timestamp. */
export function relativeTime(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return 'agora';
  const m = Math.round(diff / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(diff / 3600);
  if (h < 24) return `há ${plural(h, 'hora', 'horas')}`;
  const d = Math.round(diff / 86400);
  if (d < 30) return `há ${plural(d, 'dia', 'dias')}`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `há ${plural(mo, 'mês', 'meses')}`;
  const y = Math.round(mo / 12);
  return `há ${plural(y, 'ano', 'anos')}`;
}

/** Para datas de campo (YYYY-MM-DD): { label, overdue } */
export function dateDistance(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return null;
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((target - today) / 86400000);
  if (days === 0) return { label: 'hoje', overdue: false, today: true };
  if (days === 1) return { label: 'amanhã', overdue: false };
  if (days === -1) return { label: 'atrasado há 1 dia', overdue: true };
  if (days > 0) return { label: `em ${days} dias`, overdue: false };
  return { label: `atrasado há ${-days} dias`, overdue: true };
}

export function formatDateBR(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return '';
  const [y, m, d] = ymd.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateTimeBR(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  return dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// --- Moeda / números ---------------------------------------------------------

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 });

export function formatCurrency(n) {
  if (n == null || n === '' || isNaN(Number(n))) return '';
  return brl.format(Number(n));
}

export function formatNumber(n) {
  if (n == null || n === '' || isNaN(Number(n))) return '';
  return num.format(Number(n));
}

/** Aceita "R$ 1.234,56", "1234.56", "1.234" etc. Retorna number ou null. */
export function parseNumber(str) {
  if (str == null) return null;
  let s = String(str).trim().replace(/[^\d,.\-]/g, '');
  if (!s || s === '-' || s === '.' || s === ',') return null;
  if (s.includes(',')) {
    // formato brasileiro: ponto é milhar, vírgula é decimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    // "1.234.567" sem vírgula => pontos são milhar
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function onlyDigits(s) {
  return String(s || '').replace(/\D/g, '');
}

/** Link do WhatsApp a partir de um telefone brasileiro (ou já com DDI). */
export function whatsappLink(phone) {
  let digits = onlyDigits(phone);
  if (!digits) return null;
  if (!digits.startsWith('55') || digits.length <= 11) digits = '55' + digits;
  return `https://wa.me/${digits}`;
}

export function normalizeUrl(u) {
  if (!u) return '';
  const s = String(u).trim();
  if (!s) return '';
  return /^[a-z]+:\/\//i.test(s) ? s : `https://${s}`;
}

export function hostnameOf(u) {
  try { return new URL(normalizeUrl(u)).hostname.replace(/^www\./, ''); } catch { return u; }
}

// --- Storage -----------------------------------------------------------------

export const storage = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

// --- DOM helpers -------------------------------------------------------------

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function autoResize(textarea) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 2 + 'px';
}

export function isTyping() {
  const a = document.activeElement;
  if (!a) return false;
  const tag = a.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable;
}

export function isMobile() {
  return window.matchMedia('(max-width: 768px)').matches;
}

export function sortByPosition(list) {
  return [...list].sort((a, b) => (a.position - b.position) || (a.created_at > b.created_at ? 1 : -1));
}
