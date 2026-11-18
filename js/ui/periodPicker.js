// Seletor de período: Tudo / Dia / Semana / Mês / Ano / Personalizado, com
// setas para o período anterior e o seguinte. Fonte única: Financeiro,
// Dashboard, Relatórios e (só o mês) Distribuição de Lucro.
// Tudo em datas locais "YYYY-MM-DD" — nada de UTC.
import { icon, refreshIcons } from './icons.js';
import { dateShort, todayYmd } from '../fin/format.js';

export const PERIOD_MODES = [
  { id: 'all', label: 'Tudo' }, { id: 'day', label: 'Dia' }, { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mês' }, { id: 'year', label: 'Ano' }, { id: 'custom', label: 'Personalizado' },
];
export const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const parse = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };
const fmt = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

/** Período novo, ancorado em hoje. */
export function createPeriod(mode = 'month') {
  return { mode: PERIOD_MODES.some((x) => x.id === mode) ? mode : 'month', anchor: todayYmd(), from: '', to: '' };
}

/** { from, to, label } do período. Semana vai de segunda a domingo; limites inclusivos. */
export function periodRange(p) {
  const a = parse(p.anchor);
  const y = a.getFullYear(), m = a.getMonth(), d = a.getDate();
  switch (p.mode) {
    case 'day':
      return { from: p.anchor, to: p.anchor, label: `${WEEKDAYS[a.getDay()]}, ${dateShort(p.anchor)}` };
    case 'week': {
      const monday = new Date(y, m, d - ((a.getDay() + 6) % 7));
      const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
      return { from: fmt(monday), to: fmt(sunday), label: `${dateShort(fmt(monday)).slice(0, 5)} a ${dateShort(fmt(sunday))}` };
    }
    case 'month':
      return { from: fmt(new Date(y, m, 1)), to: fmt(new Date(y, m + 1, 0)), label: `${MONTHS[m]} ${y}` };
    case 'year':
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
    case 'custom': {
      const from = p.from || null, to = p.to || null;
      const label = from && to ? `${dateShort(from)} a ${dateShort(to)}` : from ? `a partir de ${dateShort(from)}` : to ? `até ${dateShort(to)}` : 'Todo o período';
      return { from, to, label };
    }
    default:
      return { from: null, to: null, label: 'Todo o período' };
  }
}

/** Primeiro dia do mês em que o período termina (ou do mês atual, se ele não tem fim). */
export function periodEndMonth(p) {
  return `${(periodRange(p).to || todayYmd()).slice(0, 7)}-01`;
}

function shiftAnchor(p, dir) {
  const a = parse(p.anchor);
  const y = a.getFullYear(), m = a.getMonth(), d = a.getDate();
  if (p.mode === 'day') return fmt(new Date(y, m, d + dir));
  if (p.mode === 'week') return fmt(new Date(y, m, d + 7 * dir));
  if (p.mode === 'month') return fmt(new Date(y, m + dir, 1));
  if (p.mode === 'year') return fmt(new Date(y + dir, m, 1));
  return p.anchor;
}

/**
 * Monta o seletor dentro de `host` (use um elemento com class="period" numa
 * .toolbar). Altera `period` no lugar e chama onChange() a cada mudança.
 * opts.modes: lista de modos oferecidos; com um só, somem os botões de modo.
 * Devolve { refresh() } para repintar depois de mexer em `period` por fora.
 */
export function mountPeriodPicker(host, period, onChange, { modes = PERIOD_MODES.map((x) => x.id) } = {}) {
  const offered = PERIOD_MODES.filter((x) => modes.includes(x.id));
  host.classList.add('period');
  host.innerHTML = `
    ${offered.length > 1 ? `
    <div class="segmented segmented--scroll" role="group" aria-label="Período">
      ${offered.map((x) => `<button type="button" data-mode="${x.id}">${x.label}</button>`).join('')}
    </div>` : ''}
    <div class="period-nav" data-period="nav">
      <button type="button" class="btn btn--icon btn--sm" data-period="prev" aria-label="Período anterior">${icon('chevron-left')}</button>
      <span class="period-nav__label" data-period="label" aria-live="polite"></span>
      <button type="button" class="btn btn--icon btn--sm" data-period="next" aria-label="Próximo período">${icon('chevron-right')}</button>
    </div>
    <div class="period-custom hidden" data-period="custom">
      <input class="input" type="date" data-period="from" aria-label="De" />
      <span class="subtle">a</span>
      <input class="input" type="date" data-period="to" aria-label="Até" />
    </div>`;
  refreshIcons();
  const $ = (name) => host.querySelector(`[data-period="${name}"]`);

  const refresh = () => {
    host.querySelectorAll('[data-mode]').forEach((b) => {
      const active = b.dataset.mode === period.mode;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    $('nav').classList.toggle('hidden', period.mode === 'all' || period.mode === 'custom');
    $('custom').classList.toggle('hidden', period.mode !== 'custom');
    $('label').textContent = periodRange(period).label;
    $('from').value = period.from || '';
    $('to').value = period.to || '';
  };
  const changed = () => { refresh(); onChange(); };

  host.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    if (period.mode === b.dataset.mode) return;
    period.mode = b.dataset.mode;
    period.anchor = todayYmd(); // trocar o tipo de período volta para hoje
    changed();
  }));
  $('prev').addEventListener('click', () => { period.anchor = shiftAnchor(period, -1); changed(); });
  $('next').addEventListener('click', () => { period.anchor = shiftAnchor(period, +1); changed(); });
  const custom = () => { period.from = $('from').value; period.to = $('to').value; changed(); };
  $('from').addEventListener('change', custom);
  $('to').addEventListener('change', custom);

  refresh();
  return { refresh };
}
